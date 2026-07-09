const socket = io();

const CATEGORIES = ['name', 'city', 'animal', 'plant', 'food', 'object'];
const MAX_HISTORY = 100;
const SCROLL_UNLOCK_ROW = 17; // from this row on, the page's clean side opens up below

const screens = {
  landing: document.getElementById('landing-screen'),
  join: document.getElementById('join-screen'),
  mode: document.getElementById('mode-screen'),
  waiting: document.getElementById('waiting-screen'),
  game: document.getElementById('game-screen'),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
  // A focus() during an entry animation can scroll the container sideways;
  // always land on a screen with its scroll reset.
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
const roomCodeInput = document.getElementById('room-code-input');
const codeErrorEl = document.getElementById('code-error');
const joinCodeSubmit = document.getElementById('join-code-submit');

const roomCodeDisplay = document.getElementById('room-code-display');
const roomLinkDisplay = document.getElementById('room-link-display');
const copyLinkButton = document.getElementById('copy-link-button');
const waitingPlayerList = document.getElementById('waiting-player-list');
const startButton = document.getElementById('start-button');
const waitingHint = document.getElementById('waiting-hint');

const currentLetterEl = document.getElementById('current-letter');
const activeMagnifier = document.getElementById('active-magnifier');
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
  if (hasJoinedOnce && myNickname && myRoomId) {
    socket.emit('player:join', { nickname: myNickname, countryCode: myCountry, roomId: myRoomId });
  }
});

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

playPublicButton.addEventListener('click', () => {
  socket.emit('player:join', { nickname: myNickname, countryCode: myCountry, roomId: 'public' });
});

playPrivateButton.addEventListener('click', () => {
  socket.emit('room:create', { nickname: myNickname, countryCode: myCountry });
});

joinCodeButton.addEventListener('click', () => {
  joinCodeArea.classList.toggle('hidden');
  if (!joinCodeArea.classList.contains('hidden')) {
    roomCodeInput.focus({ preventScroll: true });
  }
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
  socket.emit('room:join', { roomId: code, nickname: myNickname, countryCode: myCountry });
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
  socket.emit('player:join', { nickname: myNickname, countryCode: myCountry, roomId: 'public' });
});

fallbackCreateButton.addEventListener('click', () => {
  pendingRoomId = null;
  socket.emit('room:create', { nickname: myNickname, countryCode: myCountry });
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
  currentLetterEl.textContent = state.letter;
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
  // preventScroll: the player parks the page wherever they like; a new
  // round must never move their scroll position.
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
  currentLetterEl.textContent = state.letter || '-';

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

socket.on('leaderboard:update', ({ players, nations }) => {
  playerLeaderboardEl.innerHTML = '';
  waitingPlayerList.innerHTML = '';
  for (const p of players) {
    playerLeaderboardEl.appendChild(leaderboardRow(`${flagEmoji(p.countryCode)} ${p.nickname}`, p.score));
    waitingPlayerList.appendChild(leaderboardRow(`${flagEmoji(p.countryCode)} ${p.nickname}`, p.score));
  }

  nationLeaderboardEl.innerHTML = '';
  for (const n of nations) {
    const countryEntry = COUNTRIES.find(([code]) => code === n.countryCode);
    const name = countryEntry ? countryEntry[1] : n.countryCode;
    nationLeaderboardEl.appendChild(leaderboardRow(`${flagEmoji(n.countryCode)} ${name}`, n.score));
  }
});
