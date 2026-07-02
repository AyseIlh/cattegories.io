const socket = io();

const CATEGORIES = ['name', 'city', 'animal', 'plant', 'food', 'object'];
const MAX_HISTORY = 30;

const screens = {
  join: document.getElementById('join-screen'),
  mode: document.getElementById('mode-screen'),
  waiting: document.getElementById('waiting-screen'),
  game: document.getElementById('game-screen'),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
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
const timerEl = document.getElementById('timer');
const historyEl = document.getElementById('history');
const activeRow = document.getElementById('active-row');
const activeScore = document.getElementById('active-score');
const meLine = document.getElementById('me-line');
const phaseHint = document.getElementById('phase-hint');
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

function clearRoomError() {
  roomErrorEl.classList.add('hidden');
  roomErrorFallbacks.classList.add('hidden');
}

continueButton.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    nicknameInput.focus();
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
    roomCodeInput.focus();
  }
});

function submitRoomCode() {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    codeErrorEl.textContent = 'The room code is 4 characters long.';
    codeErrorEl.classList.remove('hidden');
    roomCodeInput.focus();
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

for (const category of CATEGORIES) {
  categoryInputs[category].addEventListener('input', sendAnswers);
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

function pushHistoryRow() {
  const row = document.createElement('div');
  row.className = 'row round-row';

  const letterDiv = document.createElement('div');
  letterDiv.className = 'letter-cell';
  letterDiv.textContent = currentLetterEl.textContent;
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
  currentLetterEl.textContent = state.letter;
  activeRow.classList.add('answering');
  for (const category of CATEGORIES) {
    categoryInputs[category].value = '';
    categoryInputs[category].disabled = false;
    categoryInputs[category].classList.remove('hidden');
    categoryTexts[category].classList.add('hidden');
    categoryTexts[category].classList.remove('invalid', 'empty');
  }
  activeScore.textContent = '?';
  activeScore.classList.add('pending');
  phaseHint.textContent = '';
  categoryInputs.name.focus();
  activeRow.scrollIntoView({ block: 'nearest' });
  startCountdown(state.phaseEndsAt);
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
      if (points === 0) span.classList.add('invalid');
    }
    categoryInputs[category].classList.add('hidden');
    categoryInputs[category].disabled = true;
    span.classList.remove('hidden');
  }

  const total = myResult ? myResult.total : 0;
  activeScore.textContent = `+${total}`;
  activeScore.classList.remove('pending');
  phaseHint.textContent = 'Next letter coming up...';
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
  renderWaitingScreen(state);
  showScreen('waiting');
});

socket.on('room:error', ({ message }) => {
  pendingRoomId = null;
  if (!screens.mode.classList.contains('hidden')) {
    // Error came from the "join with a code" path — show it inline next to the code input.
    codeErrorEl.textContent = message;
    codeErrorEl.classList.remove('hidden');
    roomCodeInput.focus();
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
    phaseHint.textContent = 'Next letter coming up...';
    startCountdown(state.phaseEndsAt);
    showScreen('game');
  }
});

socket.on('round:start', (state) => {
  enterAnsweringPhase(state);
  showScreen('game');
});

socket.on('round:results', ({ results, phaseEndsAt }) => {
  showResults(results);
  startCountdown(phaseEndsAt);
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

  const me = players.find((p) => p.id === socket.id);
  if (me) {
    meLine.textContent = `${flagEmoji(me.countryCode)} ${me.nickname} — total ${me.score}`;
  } else if (myNickname) {
    meLine.textContent = `${flagEmoji(myCountry)} ${myNickname} — total 0`;
  }

  nationLeaderboardEl.innerHTML = '';
  for (const n of nations) {
    const countryEntry = COUNTRIES.find(([code]) => code === n.countryCode);
    const name = countryEntry ? countryEntry[1] : n.countryCode;
    nationLeaderboardEl.appendChild(leaderboardRow(`${flagEmoji(n.countryCode)} ${name}`, n.score));
  }
});
