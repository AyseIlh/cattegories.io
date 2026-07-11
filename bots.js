// Server-side bot players for the public room. Bots live only inside this
// process — no sockets, no connections — but from a client's point of view
// they are indistinguishable from real players: they appear on the player
// and nation leaderboards, their answers show up in the round-summary
// magnifier, and they keep the public round loop alive 24/7.
//
// The module owns nothing about rooms; server.js hands over what it needs
// via init(deps) so there's no circular require.

// ---- Tunables ----
const BOT_ID_PREFIX = 'bot:';
const BOT_MIN = 10;                     // population range
const BOT_MAX = 40;
const CHURN_TICK_MS = 45 * 1000;        // how often the population drifts toward the target
const CHURN_STEP_MAX = 2;               // max bots joining/leaving per tick
const TARGET_RESHUFFLE_MIN_MS = 10 * 60 * 1000; // target re-randomizes every 10-30 min
const TARGET_RESHUFFLE_MAX_MS = 30 * 60 * 1000;
const ANSWER_DELAY_MIN_MS = 4 * 1000;   // earliest a bot "finishes typing" into a round
const ANSWER_END_MARGIN_MS = 5 * 1000;  // finish at least this long before the round ends
const MIN_TIME_TO_ANSWER_MS = 8 * 1000; // a bot joining mid-round only answers if this much is left
const SKILL_MIN = 0.25;                 // per-bot lifetime skill: chance a filled cell is correct
const SKILL_MAX = 0.9;

// Nickname ingredients. Three styles mixed: capitalized first name (40%),
// name + digits (35%), lowercase handle (25%).
const FIRST_NAMES = [
  'Emma', 'Liam', 'Noah', 'Olivia', 'Lucas', 'Mia', 'Leon', 'Hannah', 'Marco',
  'Giulia', 'Pablo', 'Diego', 'Ana', 'Yuki', 'Ivan', 'Katya', 'Omar', 'Layla',
  'Felix', 'Nina', 'Jonas', 'Clara', 'Hugo', 'Alice', 'Oscar', 'Maja', 'Erik',
  'David', 'Sara', 'Adam', 'Julia', 'Tom', 'Jack', 'Amelia', 'Sam', 'Leo',
  'Max', 'Anna', 'Lena', 'Mateus', 'Larissa', 'Zeynep', 'Elif', 'Emre',
  'Mert', 'Deniz', 'Kaan', 'Selin', 'Berk', 'Yusuf', 'Ege', 'Aylin',
];
const HANDLES = [
  'wordwizard', 'letterhero', 'quickpen', 'nightowl', 'pixelcat', 'lazyfox',
  'sneakyturtle', 'mango', 'blitz', 'kraken', 'noodle', 'biscuit', 'pepper',
  'smokey', 'ghostwriter', 'inkspill', 'papercut', 'doodler', 'scribbles',
  'wordsmith', 'turbo', 'comet', 'zigzag', 'raven', 'willow',
];

// [countryCode, weight] — heavier where the game expects real traffic.
// Every code must exist in public/countries.js (buildPlayer validates anyway).
const COUNTRY_WEIGHTS = [
  ['TR', 7], ['US', 16], ['DE', 10], ['GB', 8], ['BR', 8], ['FR', 6],
  ['ES', 5], ['IT', 5], ['NL', 4], ['PL', 4], ['RU', 4], ['IN', 3],
  ['MX', 2], ['CA', 2], ['AU', 2], ['SE', 2], ['JP', 2], ['KR', 2],
  ['UA', 2], ['RO', 2], ['GR', 1], ['PT', 1], ['CZ', 1], ['HU', 1],
  ['ID', 1], ['PH', 1], ['ZA', 1], ['EG', 1], ['MA', 1], ['AZ', 1],
];
const COUNTRY_TOTAL_WEIGHT = COUNTRY_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

// ---- Module state ----
let deps = null;       // injected by init()
let letterIndex = null; // category -> Map<letter, word[]> (only typeable words)
let botSeq = 0;
const bots = new Map(); // botId -> { skill, answerTimer }
let targetCount = 0;

function isBot(id) {
  return typeof id === 'string' && id.startsWith(BOT_ID_PREFIX);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickCountry() {
  let roll = Math.random() * COUNTRY_TOTAL_WEIGHT;
  for (const [code, weight] of COUNTRY_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return code;
  }
  return 'TR';
}

function makeNickname() {
  const style = Math.random();
  if (style < 0.4) return pick(FIRST_NAMES);
  if (style < 0.75) return pick(FIRST_NAMES) + randInt(1, 999);
  return pick(HANDLES);
}

function buildLetterIndex() {
  letterIndex = {};
  for (const category of deps.CATEGORIES) {
    const byLetter = new Map();
    for (const word of deps.WORD_LISTS[category]) {
      if (word.length > deps.MAX_ANSWER_LEN) continue; // untypeable, skip
      const letter = word[0];
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter).push(word);
    }
    letterIndex[category] = byLetter;
  }
}

// Human-looking misspelling of a real word: swap/drop/double one character,
// never the first (the wrong-letter mistake is a separate, rarer case).
// Returns null if it can't produce something that isn't itself a valid word.
function typoMutate(word, category) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let mutated = word;
    const i = 1 + Math.floor(Math.random() * (word.length - 1));
    const op = Math.random();
    if (op < 0.34 && i < word.length - 1) {
      mutated = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
    } else if (op < 0.67 && word.length > 3) {
      mutated = word.slice(0, i) + word.slice(i + 1);
    } else {
      mutated = (word.slice(0, i) + word[i] + word.slice(i)).slice(0, deps.MAX_ANSWER_LEN);
    }
    if (mutated !== word && !deps.WORD_LISTS[category].has(mutated)) return mutated;
  }
  return null;
}

// A valid word that starts with the WRONG letter — the "didn't read the
// letter properly" kind of human mistake.
function wrongLetterWord(category, letter) {
  const byLetter = letterIndex[category];
  const others = [...byLetter.keys()].filter((l) => l !== letter);
  if (!others.length) return null;
  return pick(byLetter.get(pick(others)));
}

// One round's worth of answers for one bot. Per category: maybe blank
// (weak bots blank more), else correct with probability = skill, else a
// plausible mistake (70% typo, 30% wrong starting letter).
function generateAnswers(bot, currentLetter) {
  const letter = String(currentLetter || '').toLowerCase();
  const answers = {};
  for (const category of deps.CATEGORIES) {
    const blankChance = 0.12 + 0.28 * (1 - bot.skill);
    if (Math.random() < blankChance) continue;
    const pool = letterIndex[category].get(letter) || [];
    if (!pool.length) continue;
    const correct = pick(pool);
    if (Math.random() < bot.skill) {
      answers[category] = correct;
    } else if (Math.random() < 0.7) {
      answers[category] = typoMutate(correct, category) || correct;
    } else {
      answers[category] = wrongLetterWord(category, letter) || correct;
    }
  }
  return answers;
}

// One timeout per bot per round: at a random moment inside the answering
// window the bot writes its full answer object into room.answers — exactly
// what a real client's answer:update stream converges to. Answers are never
// broadcast mid-round, so a single delayed write is indistinguishable from
// live typing. The captured room.answers Map identifies the round; if the
// round rolled over (or the bot left) before the timer fires, the write is
// skipped.
function scheduleBotAnswer(room, botId) {
  const bot = bots.get(botId);
  if (!bot) return;
  if (bot.answerTimer) clearTimeout(bot.answerTimer);
  const now = Date.now();
  const earliest = now + ANSWER_DELAY_MIN_MS;
  const latest = room.phaseEndsAt - ANSWER_END_MARGIN_MS;
  if (latest <= earliest) return; // not enough round left, sit this one out
  const roundAnswers = room.answers;
  bot.answerTimer = setTimeout(() => {
    bot.answerTimer = null;
    if (room.phase !== 'answering') return;
    if (room.answers !== roundAnswers) return;
    if (!room.players.has(botId)) return;
    room.answers.set(botId, generateAnswers(bot, room.currentLetter));
  }, rand(earliest, latest) - now);
}

function spawnBot(room) {
  botSeq += 1;
  const botId = BOT_ID_PREFIX + botSeq;
  room.players.set(botId, deps.buildPlayer(makeNickname(), pickCountry()));
  bots.set(botId, { skill: rand(SKILL_MIN, SKILL_MAX), answerTimer: null });
  deps.broadcastLeaderboards(room);
  // Joined mid-round with enough time left? Play this round too.
  if (room.phase === 'answering' && room.phaseEndsAt - Date.now() > MIN_TIME_TO_ANSWER_MS) {
    scheduleBotAnswer(room, botId);
  }
}

// Deliberately NOT leaveCurrentRoom: that function is socket-shaped (leave,
// socket.data) and bots have no socket. This replicates just the room-side
// effects. Bots are never the last to "leave" (the churn floor is BOT_MIN),
// so the empty-room idle path can't be triggered from here.
function removeBot(room, botId) {
  const bot = bots.get(botId);
  if (bot && bot.answerTimer) clearTimeout(bot.answerTimer);
  bots.delete(botId);
  room.players.delete(botId);
  room.answers.delete(botId);
  deps.broadcastLeaderboards(room);
}

// Every tick, drift the population 1-2 bots toward the current target so
// joins/leaves trickle in like real traffic instead of jumping.
function churnTick() {
  const room = deps.getPublicRoom();
  if (!room) return;
  const diff = targetCount - bots.size;
  if (diff === 0) return;
  const step = Math.min(Math.abs(diff), randInt(1, CHURN_STEP_MAX));
  for (let i = 0; i < step; i++) {
    if (diff > 0) spawnBot(room);
    else removeBot(room, pick([...bots.keys()]));
  }
}

function scheduleTargetReshuffle() {
  setTimeout(() => {
    targetCount = randInt(BOT_MIN, BOT_MAX);
    scheduleTargetReshuffle();
  }, rand(TARGET_RESHUFFLE_MIN_MS, TARGET_RESHUFFLE_MAX_MS));
}

// Called by server.js at the top of every answering phase (public room only).
function onRoundStart(room) {
  if (!deps || room.type !== 'public') return;
  for (const botId of bots.keys()) {
    scheduleBotAnswer(room, botId);
  }
}

// Called once at server startup, after the public room exists.
function init(injectedDeps) {
  deps = injectedDeps;
  buildLetterIndex();
  targetCount = randInt(BOT_MIN, BOT_MAX);
  const room = deps.getPublicRoom();
  for (let i = 0; i < targetCount; i++) spawnBot(room);
  setInterval(churnTick, CHURN_TICK_MS);
  scheduleTargetReshuffle();
  // The public room boots idle (no timer). With bots seated it should run
  // around the clock, so wake it now; from here on it never empties.
  if (!room.timer) deps.startAnswerPhase(room);
}

module.exports = { isBot, init, onRoundStart };
