const socket = window.CATTEGORIES_SERVER_URL ? io(window.CATTEGORIES_SERVER_URL) : io();

const CATEGORIES = ['name', 'city', 'animal', 'plant', 'movie', 'object'];
const MAX_HISTORY = 100;
const SCROLL_UNLOCK_ROW = 17; // from this row on, the page's clean side opens up below

const screens = {
  landing: document.getElementById('landing-screen'),
  join: document.getElementById('join-screen'),
  mode: document.getElementById('mode-screen'),
  waiting: document.getElementById('waiting-screen'),
  game: document.getElementById('game-screen'),
};

let currentScreen = 'landing';

function showScreen(name) {
  // round:start calls showScreen('game') every round; when the screen is
  // already visible this must be a no-op — resetting the window scroll here
  // would yank the player's parked scroll position back to the top each turn.
  const alreadyVisible = !screens[name].classList.contains('hidden');
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
  currentScreen = name;
  if (alreadyVisible) return;
  // A focus() during an entry animation can scroll the container sideways;
  // always land on a fresh screen with its scroll reset.
  screens[name].scrollLeft = 0;
  screens[name].scrollTop = 0;
  window.scrollTo(0, 0);
}

const nicknameInput = document.getElementById('nickname-input');
const countrySelect = document.getElementById('country-select');
const continueButton = document.getElementById('continue-button');
const joinSubtitle = document.getElementById('join-subtitle');
const roomErrorEl = document.getElementById('room-error');
const roomErrorFallbacks = document.getElementById('room-error-fallbacks');
const fallbackPublicButton = document.getElementById('fallback-public-button');
const fallbackCreateButton = document.getElementById('fallback-create-button');

const playPublicButton = document.getElementById('play-public-button');
const playPrivateButton = document.getElementById('play-private-button');
const joinCodeButton = document.getElementById('join-code-button');
const joinCodeArea = document.getElementById('join-code-area');
const modeErrorEl = document.getElementById('mode-error');
const roomCodeInput = document.getElementById('room-code-input');
const waitingBackButton = document.getElementById('waiting-back-button');
const codeErrorEl = document.getElementById('code-error');
const joinCodeSubmit = document.getElementById('join-code-submit');

const roomCodeDisplay = document.getElementById('room-code-display');
const roomLinkDisplay = document.getElementById('room-link-display');
const copyLinkButton = document.getElementById('copy-link-button');
const waitingPlayerList = document.getElementById('waiting-player-list');
const startButton = document.getElementById('start-button');
const waitingHint = document.getElementById('waiting-hint');

const currentLetterEl = document.getElementById('current-letter');
const headerLetterEl = document.getElementById('header-letter');
const activeMagnifier = document.getElementById('active-magnifier');

// The active row's letter cell is the source of truth (history snapshots
// read it), but on mobile the sheet scrolls sideways and that cell can be
// off-screen — so the sticky header mirrors the letter (visible ≤640px).
function setCurrentLetter(letter) {
  currentLetterEl.textContent = letter;
  headerLetterEl.textContent = letter;
}
const summaryPopup = document.getElementById('summary-popup');
const summaryBackdrop = document.getElementById('summary-backdrop');
const summaryLetterEl = document.getElementById('summary-letter');
const summaryGrid = document.getElementById('summary-grid');
const summaryClose = document.getElementById('summary-close');
const summaryContinue = document.getElementById('summary-continue');
const timerEl = document.getElementById('timer');
const historyEl = document.getElementById('history');
const activeRow = document.getElementById('active-row');
const activeScore = document.getElementById('active-score');
const playerLeaderboardEl = document.getElementById('player-leaderboard');
const nationLeaderboardEl = document.getElementById('nation-leaderboard');

const categoryInputs = {};
const categoryTexts = {};
CATEGORIES.forEach((category, i) => {
  const cell = activeRow.querySelectorAll('.cell')[i];
  categoryInputs[category] = cell.querySelector('input');
  categoryTexts[category] = cell.querySelector('.cell-text');
});

let countdownInterval = null;
let myNickname = '';
let myCountry = '';
let resultsShown = false; // true while the active row displays a finished round
let myRoomId = null;
let amIHost = false;
let pendingRoomId = null;
let hasJoinedOnce = false; // set after the first successful room entry

// Convert a server-stamped deadline to this device's clock, so a skewed
// local clock can't break the countdown. serverNow is sampled when the
// server built the message, so the small network delay cancels out of
// (phaseEndsAt - serverNow).
function localPhaseEnd({ phaseEndsAt, serverNow }) {
  if (!serverNow) return phaseEndsAt;
  return Date.now() + (phaseEndsAt - serverNow);
}

// If the connection drops (wifi hiccup, server restart), socket.io
// reconnects with a fresh identity — rejoin the same room automatically
// instead of leaving the player typing into the void.
socket.on('connect', () => {
  modeErrorEl.classList.add('hidden');
  if (hasJoinedOnce && myNickname && myRoomId) {
    socket.emit('player:join', { nickname: myNickname, countryCode: myCountry, roomId: myRoomId });
  }
});

socket.on('connect_error', (err) => {
  modeErrorEl.textContent = `Connection error: ${err.message}`;
  modeErrorEl.classList.remove('hidden');
});

socket.on('disconnect', (reason) => {
  modeErrorEl.textContent = `Disconnected: ${reason}. Reconnecting…`;
  modeErrorEl.classList.remove('hidden');
});

const defaultJoinSubtitle = joinSubtitle.textContent;
const roomParam = new URLSearchParams(window.location.search).get('room');
if (roomParam) {
  pendingRoomId = roomParam.trim().toUpperCase();
  joinSubtitle.textContent = `You're joining room ${pendingRoomId}. Enter a nickname to continue.`;
}

for (const [code, name] of COUNTRIES) {
  const option = document.createElement('option');
  option.value = code;
  option.textContent = `${flagEmoji(code)} ${name}`;
  countrySelect.appendChild(option);
}
countrySelect.value = 'TR';

let landingErasing = false;
const landingPlayButton = document.getElementById('landing-play-button');
landingPlayButton.addEventListener('click', () => {
  if (landingErasing) return;
  landingErasing = true;

  // Measure where the title and note actually are, so the eraser's sweep
  // passes exactly over them on any screen size.
  const eraserRect = landingPlayButton.getBoundingClientRect();
  const titleRect = document.querySelector('.landing-title').getBoundingClientRect();
  const noteRect = document.querySelector('.landing-note').getBoundingClientRect();
  const ex = eraserRect.left + eraserRect.width / 2;
  const ey = eraserRect.top + eraserRect.height / 2;
  const margin = Math.min(120, window.innerWidth * 0.18);
  const s = screens.landing.style;
  s.setProperty('--sw-left', `${-(ex - margin)}px`);
  s.setProperty('--sw-right', `${window.innerWidth - ex - margin}px`);
  s.setProperty('--ty-title', `${titleRect.top + titleRect.height / 2 - ey}px`);
  s.setProperty('--ty-note1', `${noteRect.top + noteRect.height * 0.15 - ey}px`);
  s.setProperty('--ty-note2', `${noteRect.top + noteRect.height * 0.45 - ey}px`);
  s.setProperty('--ty-note3', `${noteRect.top + noteRect.height * 0.75 - ey}px`);
  s.setProperty('--ty-note4', `${noteRect.bottom - ey}px`);

  screens.landing.classList.add('erasing');
  setTimeout(() => {
    screens.landing.classList.remove('erasing');
    landingErasing = false;
    showScreen('join');
    // preventScroll: the note is still flying in; a normal focus() would
    // scroll the screen toward its mid-flight position and leave it stuck there.
    nicknameInput.focus({ preventScroll: true });
  }, 1450);
});

function clearRoomError() {
  roomErrorEl.classList.add('hidden');
  roomErrorFallbacks.classList.add('hidden');
}

continueButton.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    nicknameInput.focus({ preventScroll: true });
    return;
  }
  myNickname = nickname;
  myCountry = countrySelect.value;
  clearRoomError();

  if (pendingRoomId) {
    socket.emit('room:join', { roomId: pendingRoomId, nickname: myNickname, countryCode: myCountry });
  } else {
    showScreen('mode');
  }
});

function requireConnection(action) {
  if (!socket.connected) {
    modeErrorEl.textContent = 'Connecting to server… Please wait.';
    modeErrorEl.classList.remove('hidden');
    return false;
  }
  modeErrorEl.classList.add('hidden');
  action();
  return true;
}

playPublicButton.addEventListener('click', () => {
  requireConnection(() => {
    socket.emit('player:join', { nickname: myNickname, countryCode: myCountry, roomId: 'public' });
  });
});

playPrivateButton.addEventListener('click', () => {
  requireConnection(() => {
    socket.emit('room:create', { nickname: myNickname, countryCode: myCountry });
  });
});

joinCodeButton.addEventListener('click', () => {
  joinCodeArea.classList.toggle('hidden');
  if (!joinCodeArea.classList.contains('hidden')) {
    roomCodeInput.focus({ preventScroll: true });
  }
});

waitingBackButton.addEventListener('click', () => {
  // Leave the room server-side but keep the socket alive — disconnect()
  // here would be permanent (socket.io never auto-reconnects after a
  // manual disconnect), leaving every later join click dead in the water.
  socket.emit('room:leave');
  myRoomId = null;
  amIHost = false;
  hasJoinedOnce = false;
  pendingRoomId = null;
  joinSubtitle.textContent = defaultJoinSubtitle;
  showScreen('landing');
});

function submitRoomCode() {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    codeErrorEl.textContent = 'The room code is 4 characters long.';
    codeErrorEl.classList.remove('hidden');
    roomCodeInput.focus({ preventScroll: true });
    return;
  }
  codeErrorEl.classList.add('hidden');
  requireConnection(() => {
    socket.emit('room:join', { roomId: code, nickname: myNickname, countryCode: myCountry });
  });
}

joinCodeSubmit.addEventListener('click', submitRoomCode);
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitRoomCode();
});
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

fallbackPublicButton.addEventListener('click', () => {
  pendingRoomId = null;
  requireConnection(() => {
    socket.emit('player:join', { nickname: myNickname, countryCode: myCountry, roomId: 'public' });
  });
});

fallbackCreateButton.addEventListener('click', () => {
  pendingRoomId = null;
  requireConnection(() => {
    socket.emit('room:create', { nickname: myNickname, countryCode: myCountry });
  });
});

copyLinkButton.addEventListener('click', () => {
  navigator.clipboard.writeText(roomLinkDisplay.value).then(() => {
    const original = copyLinkButton.textContent;
    copyLinkButton.textContent = 'Copied!';
    setTimeout(() => {
      copyLinkButton.textContent = original;
    }, 1500);
  });
});

startButton.addEventListener('click', () => {
  socket.emit('room:start');
});

function sendAnswers() {
  const payload = {};
  for (const category of CATEGORIES) {
    payload[category] = categoryInputs[category].value;
  }
  socket.emit('answer:update', payload);
}

// Sending on every keystroke is wasteful; batch bursts of typing into one
// message. 150ms is well under the end-of-round race that network latency
// already imposes.
let answerSendTimer = null;
function queueSendAnswers() {
  clearTimeout(answerSendTimer);
  answerSendTimer = setTimeout(sendAnswers, 150);
}

for (const category of CATEGORIES) {
  categoryInputs[category].addEventListener('input', queueSendAnswers);
}

// Enter jumps to the next category column (the browser scrolls the focused
// cell into view — fine here, it's a direct response to the player's key).
// On the last column Enter does nothing.
CATEGORIES.forEach((category, i) => {
  categoryInputs[category].addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = CATEGORIES[i + 1];
    if (next) categoryInputs[next].focus();
  });
});

function startCountdown(endsAt) {
  clearInterval(countdownInterval);
  function tick() {
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    timerEl.textContent = remaining;
    if (remaining <= 0) clearInterval(countdownInterval);
  }
  tick();
  countdownInterval = setInterval(tick, 250);
}

// ---------- Round-summary magnifier popup ----------

let lastRoundSummary = null; // summary of the round currently shown in the active row

function displayWord(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function openSummaryPopup(letter, summary) {
  summaryLetterEl.textContent = `Letter ${letter}`;
  summaryGrid.innerHTML = '';
  for (const category of CATEGORIES) {
    const col = document.createElement('div');
    col.className = 'summary-col';
    const title = document.createElement('h4');
    title.textContent = displayWord(category);
    col.appendChild(title);

    const list = document.createElement('ol');
    const entries = (summary && summary[category]) || [];
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'summary-empty';
      li.textContent = '—';
      list.appendChild(li);
    }
    for (const entry of entries) {
      const li = document.createElement('li');
      const wordSpan = document.createElement('span');
      // Other players' raw text — always textContent, never innerHTML.
      wordSpan.className = `summary-word ${entry.valid ? 'valid' : 'invalid'}`;
      wordSpan.textContent = displayWord(entry.word);
      const countSpan = document.createElement('span');
      countSpan.className = 'summary-count';
      countSpan.textContent = `x${entry.count}`;
      li.appendChild(wordSpan);
      li.appendChild(countSpan);
      list.appendChild(li);
    }
    col.appendChild(list);
    summaryGrid.appendChild(col);
  }
  summaryPopup.classList.remove('hidden');
}

function closeSummaryPopup() {
  summaryPopup.classList.add('hidden');
}

summaryClose.addEventListener('click', closeSummaryPopup);
summaryContinue.addEventListener('click', closeSummaryPopup);
summaryBackdrop.addEventListener('click', closeSummaryPopup);

activeMagnifier.addEventListener('click', () => {
  if (lastRoundSummary) openSummaryPopup(currentLetterEl.textContent, lastRoundSummary);
});

function makeMagnifierButton(letter, summary) {
  const button = document.createElement('button');
  button.className = 'magnifier-button';
  button.setAttribute('aria-label', 'Round summary');
  button.textContent = '🔍';
  button.addEventListener('click', () => openSummaryPopup(letter, summary));
  return button;
}

function pushHistoryRow() {
  const row = document.createElement('div');
  row.className = 'row round-row';

  const letterDiv = document.createElement('div');
  letterDiv.className = 'letter-cell';
  const letterSpan = document.createElement('span');
  letterSpan.textContent = currentLetterEl.textContent;
  letterDiv.appendChild(letterSpan);
  if (lastRoundSummary) {
    // Each history row keeps its own snapshot, openable any time.
    letterDiv.appendChild(makeMagnifierButton(currentLetterEl.textContent, lastRoundSummary));
  }
  row.appendChild(letterDiv);

  for (const category of CATEGORIES) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const span = document.createElement('span');
    span.className = categoryTexts[category].className.replace('hidden', '').trim();
    span.textContent = categoryTexts[category].textContent;
    cell.appendChild(span);
    row.appendChild(cell);
  }

  const scoreDiv = document.createElement('div');
  scoreDiv.className = 'score-cell';
  scoreDiv.textContent = activeScore.textContent;
  row.appendChild(scoreDiv);

  historyEl.appendChild(row);
  while (historyEl.children.length > MAX_HISTORY) {
    historyEl.removeChild(historyEl.firstChild);
  }
}

function enterAnsweringPhase(state) {
  if (resultsShown) {
    pushHistoryRow();
    resultsShown = false;
  }
  lastRoundSummary = null;
  activeMagnifier.classList.add('hidden');
  // history rows + the active row = current row number on the page
  const gamePaper = screens.game.querySelector('.paper');
  gamePaper.classList.toggle('page-extended', historyEl.children.length + 1 >= SCROLL_UNLOCK_ROW);
  setCurrentLetter(state.letter);
  activeRow.classList.add('answering');
  for (const category of CATEGORIES) {
    categoryInputs[category].value = '';
    categoryInputs[category].disabled = false;
    categoryInputs[category].classList.remove('hidden');
    categoryTexts[category].classList.add('hidden');
    categoryTexts[category].classList.remove('invalid', 'correct', 'empty');
  }
  activeScore.textContent = '?';
  activeScore.classList.add('pending');
  // preventScroll: the player parks the page wherever they like — vertically
  // AND horizontally (mobile sideways scroll). A new round must never move
  // their scroll position; they come back to the Name column on their own.
  categoryInputs.name.focus({ preventScroll: true });
  startCountdown(localPhaseEnd(state));
}

function showResults(results) {
  const myResult = results ? results[socket.id] : null;
  activeRow.classList.remove('answering');

  for (const category of CATEGORIES) {
    const raw = categoryInputs[category].value.trim();
    const points = myResult ? myResult[category] : 0;
    const span = categoryTexts[category];

    if (!raw) {
      span.textContent = '—';
      span.classList.add('empty');
    } else {
      span.textContent = raw;
      span.classList.add(points === 0 ? 'invalid' : 'correct');
    }
    categoryInputs[category].classList.add('hidden');
    categoryInputs[category].disabled = true;
    span.classList.remove('hidden');
  }

  const total = myResult ? myResult.total : 0;
  activeScore.textContent = `+${total}`;
  activeScore.classList.remove('pending');
  resultsShown = true;
}

function renderWaitingScreen(state) {
  roomCodeDisplay.textContent = state.roomId;
  roomLinkDisplay.value = `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;
  startButton.classList.toggle('hidden', !amIHost);
  waitingHint.classList.toggle('hidden', amIHost);
}

socket.on('room:created', (state) => {
  myRoomId = state.roomId;
  amIHost = true;
  hasJoinedOnce = true;
  renderWaitingScreen(state);
  showScreen('waiting');
});

socket.on('room:error', ({ message }) => {
  pendingRoomId = null;
  if (!screens.mode.classList.contains('hidden')) {
    // Error came from the "join with a code" path — show it inline next to the code input.
    codeErrorEl.textContent = message;
    codeErrorEl.classList.remove('hidden');
    roomCodeInput.focus({ preventScroll: true });
    return;
  }
  roomErrorEl.textContent = message;
  roomErrorEl.classList.remove('hidden');
  roomErrorFallbacks.classList.remove('hidden');
  showScreen('join');
});

socket.on('state:sync', (state) => {
  myRoomId = state.roomId;
  amIHost = state.hostId === socket.id;
  hasJoinedOnce = true;
  setCurrentLetter(state.letter || '-');

  if (state.phase === 'waiting') {
    renderWaitingScreen(state);
    showScreen('waiting');
    return;
  }

  if (state.phase === 'answering') {
    enterAnsweringPhase(state);
    showScreen('game');
  } else {
    for (const category of CATEGORIES) {
      categoryInputs[category].disabled = true;
    }
    activeRow.classList.remove('answering');
    startCountdown(localPhaseEnd(state));
    showScreen('game');
  }
});

socket.on('round:start', (state) => {
  enterAnsweringPhase(state);
  showScreen('game');
});

socket.on('round:results', ({ results, summary, phaseEndsAt, serverNow }) => {
  showResults(results);
  if (summary) {
    lastRoundSummary = summary;
    activeMagnifier.classList.remove('hidden');
  }
  startCountdown(localPhaseEnd({ phaseEndsAt, serverNow }));
});

function leaderboardRow(nameText, score) {
  const li = document.createElement('li');
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = nameText;
  const scoreSpan = document.createElement('span');
  scoreSpan.className = 'score';
  scoreSpan.textContent = score;
  li.appendChild(nameSpan);
  li.appendChild(scoreSpan);
  return li;
}

// One ranked row: explicit rank number + flag/name + score. The rank is a
// styled span (not the native <ol> marker) because the viewer's own row can
// carry a large true rank like "441" when they're outside the top 10.
function rankedRow(rank, nameText, score, isMe) {
  const li = leaderboardRow(nameText, score);
  const rankSpan = document.createElement('span');
  rankSpan.className = 'rank';
  rankSpan.textContent = rank;
  li.insertBefore(rankSpan, li.firstChild);
  if (isMe) li.classList.add('me-row');
  return li;
}

// Renders a full sorted list as the top `limit` entries, plus my own row
// with its true rank when I'm outside that top. Two modes for the "outside"
// case, since the expanded and collapsed views want different behavior:
//  - appendOwnRow=false (expanded/top-10): my row REPLACES the last slot,
//    so the list always stays exactly `limit` rows (1..9 + me at 10).
//  - appendOwnRow=true (collapsed/top-3): the top `limit` stays intact and
//    my row is APPENDED after it, so the list grows to `limit + 1` rows
//    (1..3 always shown, plus me as a 4th row if I'm not already in it).
function renderRankedList(ol, entries, isMe, label, limit = 10, appendOwnRow = false) {
  ol.innerHTML = '';
  const myIndex = entries.findIndex(isMe);
  const outsideTop = myIndex >= limit;
  const topCount = outsideTop && !appendOwnRow ? limit - 1 : limit;
  const top = entries.slice(0, topCount);
  top.forEach((entry, i) => {
    ol.appendChild(rankedRow(i + 1, label(entry), entry.score, i === myIndex));
  });
  if (outsideTop) {
    const me = entries[myIndex];
    ol.appendChild(rankedRow(myIndex + 1, label(me), me.score, true));
  }
}

const playerLabel = (p) => `${flagEmoji(p.countryCode)} ${p.nickname}`;
const nationLabel = (n) => {
  const countryEntry = COUNTRIES.find(([code]) => code === n.countryCode);
  return `${flagEmoji(n.countryCode)} ${countryEntry ? countryEntry[1] : n.countryCode}`;
};

// Kept for tab/window switches: re-render without waiting for the next broadcast.
let lastLeaderboard = { players1h: [], players24h: [], nations1h: [], nations24h: [] };
// Collapsed = top 3 always shown, +1 appended row if I'm outside it (up to
// 4 rows); expanded = top 10, replacing the last slot with my row if I'm
// outside it (always exactly 10 rows) — the original behavior. Shared by
// both tabs, toggled by lb-collapse-toggle. Phones start collapsed: the
// post-it floats over the sheet and screen space is scarce.
let leaderboardCollapsed = window.matchMedia('(max-width: 640px)').matches;
// Which time window the leaderboard shows: the current UTC hour or the
// current UTC day. Defaults to 1h so a new player competes on equal footing.
let leaderboardWindow = '1h';

function renderLeaderboards() {
  const players = leaderboardWindow === '24h' ? lastLeaderboard.players24h : lastLeaderboard.players1h;
  const nations = leaderboardWindow === '24h' ? lastLeaderboard.nations24h : lastLeaderboard.nations1h;
  const limit = leaderboardCollapsed ? 3 : 10;
  renderRankedList(playerLeaderboardEl, players, (p) => p.id === socket.id, playerLabel, limit, leaderboardCollapsed);

  // My nation always shows, even before it scores its first point.
  const myNationListed = nations.some((n) => n.countryCode === myCountry);
  const nationEntries = (!myNationListed && myCountry)
    ? [...nations, { countryCode: myCountry, score: 0 }]
    : nations;
  renderRankedList(nationLeaderboardEl, nationEntries, (n) => n.countryCode === myCountry, nationLabel, limit, leaderboardCollapsed);
}

socket.on('leaderboard:update', ({ players1h, players24h, nations1h, nations24h }) => {
  lastLeaderboard = { players1h, players24h, nations1h, nations24h };
  renderLeaderboards();

  // The waiting-room roster keeps the simple unranked format, showing the
  // daily (24h) scores.
  waitingPlayerList.innerHTML = '';
  for (const p of players24h) {
    waitingPlayerList.appendChild(leaderboardRow(playerLabel(p), p.score));
  }
});

// Players / Nations tab switch: swap which list is visible and recolor the
// post-it (yellow = players, green = nations — the old two-note colors).
const leaderboardNote = document.getElementById('leaderboard-note');
const lbTabPlayers = document.getElementById('lb-tab-players');
const lbTabNations = document.getElementById('lb-tab-nations');

function selectLeaderboardTab(showNations) {
  lbTabPlayers.classList.toggle('active', !showNations);
  lbTabNations.classList.toggle('active', showNations);
  playerLeaderboardEl.classList.toggle('hidden', showNations);
  nationLeaderboardEl.classList.toggle('hidden', !showNations);
  leaderboardNote.classList.toggle('nations-view', showNations);
}

lbTabPlayers.addEventListener('click', () => selectLeaderboardTab(false));
lbTabNations.addEventListener('click', () => selectLeaderboardTab(true));

// 1h/24h window toggle: same visual language as the Players/Nations tabs.
const lbWindow1h = document.getElementById('lb-window-1h');
const lbWindow24h = document.getElementById('lb-window-24h');
const lbWindowReset = document.getElementById('lb-window-reset');

// Subtle live countdown to the selected window's reset: next UTC hour for
// 1h, next UTC midnight for 24h. Same epoch math the server uses, so the
// label flips at the exact moment the leaderboard resets.
function renderWindowReset() {
  const now = Date.now();
  const windowMs = leaderboardWindow === '24h' ? 24 * 3600 * 1000 : 3600 * 1000;
  const msLeft = (Math.floor(now / windowMs) + 1) * windowMs - now;
  const totalSec = Math.floor(msLeft / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  lbWindowReset.textContent = h > 0 ? `resets in ${h}:${m}:${s}` : `resets in ${m}:${s}`;
}

setInterval(renderWindowReset, 1000);
renderWindowReset();

function selectLeaderboardWindow(timeWindow) {
  leaderboardWindow = timeWindow;
  lbWindow1h.classList.toggle('active', timeWindow === '1h');
  lbWindow24h.classList.toggle('active', timeWindow === '24h');
  renderWindowReset();
  renderLeaderboards();
}

lbWindow1h.addEventListener('click', () => selectLeaderboardWindow('1h'));
lbWindow24h.addEventListener('click', () => selectLeaderboardWindow('24h'));

// Collapse/expand toggle: top 3 vs top 10, shared across both tabs.
const lbCollapseToggle = document.getElementById('lb-collapse-toggle');
lbCollapseToggle.addEventListener('click', () => {
  leaderboardCollapsed = !leaderboardCollapsed;
  leaderboardNote.classList.toggle('collapsed', leaderboardCollapsed);
  lbCollapseToggle.setAttribute('aria-label', leaderboardCollapsed ? 'Expand leaderboard' : 'Collapse leaderboard');
  renderLeaderboards();
});

// Sync the note class + arrow with the mobile-collapsed initial state.
if (leaderboardCollapsed) {
  leaderboardNote.classList.add('collapsed');
  lbCollapseToggle.setAttribute('aria-label', 'Expand leaderboard');
}

// Android back button: walk back through the app's screens instead of
// immediately killing the app. iOS has no hardware back button, so this
// listener is ignored there.
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener('backButton', () => {
    if (currentScreen === 'game') {
      // Leave the room server-side but keep the socket alive, then go back
      // to the mode screen so the player can choose again.
      socket.emit('room:leave');
      myRoomId = null;
      amIHost = false;
      hasJoinedOnce = false;
      pendingRoomId = null;
      showScreen('mode');
      return;
    }
    if (currentScreen === 'waiting') {
      waitingBackButton.click();
      return;
    }
    if (currentScreen === 'mode') {
      showScreen('join');
      return;
    }
    if (currentScreen === 'join') {
      showScreen('landing');
      return;
    }
    // Landing screen: fall through and let Android close the app.
  });
}
