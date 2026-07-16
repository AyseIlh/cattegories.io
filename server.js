const path = require('path');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const http = require('http');
const { WORD_LISTS } = require('./wordlists');
const { COUNTRIES } = require('./public/countries');
const Bots = require('./bots');

const app = express();
// Railway (and most hosts) put the app behind a reverse proxy: every socket
// connects FROM the proxy, so handshake.address would be the same proxy IP
// for every player. Trusting the first hop makes Express (and, via it,
// socket.io's handshake.address) read the real client IP from
// x-forwarded-for instead — required for the per-IP connection cap to work.
app.set('trust proxy', 1);
const server = http.createServer(app);
// maxHttpBufferSize caps a single inbound message. Our largest legit message
// is an answer:update of 6 fields x 15 chars ~= 400 bytes worst case (multi-
// byte); 5 KB leaves ~12x headroom and blocks megabyte-sized junk payloads.
const io = new Server(server, { maxHttpBufferSize: 5 * 1024 });

app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

app.get('/health', (_req, res) => res.status(200).send('ok'));

const CATEGORIES = ['name', 'city', 'animal', 'plant', 'movie', 'object'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

const ANSWER_PHASE_MS = 60 * 1000;
const RESULT_PHASE_MS = 8 * 1000;
const LETTER_COOLDOWN = 15; // a drawn letter can't repeat for this many rounds

const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // excludes 0/O/1/I/L (ambiguous in the handwritten UI font)
const ROOM_CODE_LENGTH = 4;

const MAX_ANSWER_LEN = 20;      // per-category answer character cap (raised from 15 for movie titles)
const MAX_NICKNAME_LEN = 20;

// ---- Abuse limits (tunable) ----
const MAX_PRIVATE_ROOMS = 250;        // total private rooms server-wide
const MAX_PLAYERS_PER_PRIVATE = 20;   // players in one private room
const MAX_CONNS_PER_IP = 20;          // simultaneous sockets from one IP
const EVENT_RATE_LIMIT = 20;          // sustained events/sec per socket
const EVENT_RATE_BURST = 40;          // short burst allowance (bucket size)
const JOIN_ATTEMPT_LIMIT = 5;         // room-code join tries before lockout
const JOIN_LOCKOUT_MS = 60 * 1000;    // lockout duration after too many tries

// ip -> number of live sockets (per-IP connection cap)
const connectionsPerIp = new Map();

// rooms: roomId -> Room
// Room = { id, type: 'public'|'private', phase: 'waiting'|'answering'|'results', hostId,
//          players: Map<socketId, {nickname, countryCode, score, connected}>,
//          nationScores: Map<countryCode, number>, currentLetter, phaseEndsAt,
//          answers: Map<socketId, {name, city, animal, plant, movie, object}>, timer }
const rooms = new Map();

// Lifetime counters for the private /stats page. In-memory only, so they
// reset to zero on every redeploy/restart (same as everything else — no DB).
const serverStats = {
  startedAt: Date.now(),
  roundsPlayed: 0, // answering phases that finished, across all rooms
  wordsWritten: 0, // non-empty answer cells submitted by REAL players (bots excluded)
};

const VALID_COUNTRY_CODES = new Set(COUNTRIES.map(([code]) => code));

// Clients can emit anything (including no payload at all); never trust a
// value to be a string before treating it as one.
function asString(value) {
  return typeof value === 'string' ? value : '';
}

// Answer normalization. Beyond trim+lowercase this folds input quirks that
// were rejecting genuinely correct answers:
//  - Turkish keyboards: dotted İ lowercases to "i" + U+0307 (combining dot),
//    which never matches ASCII list entries; dotless ı isn't decomposable at
//    all, so it gets an explicit map to "i".
//  - Accented input (é, ü, ...) folds to plain ASCII via NFD + stripping
//    combining marks (the lists are pure lowercase ASCII).
//  - Double spaces between words ("cape  town") collapse to one.
// Built from code-point escapes (like INVISIBLE_CHARS) so the source itself
// stays free of invisible characters.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
const DOTLESS_I = new RegExp('\\u0131', 'g');
function normalize(str) {
  return asString(str)
    .toLowerCase()
    .replace(DOTLESS_I, 'i')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Formatting-only characters a player easily drops or varies ("san francisco"
// vs "sanfrancisco", "st-tropez" vs "st tropez"). Stripping them for lookup
// lets those count as the same answer without touching the stored spelling
// or what's shown back to players.
function compactify(str) {
  return str.replace(/['\s-]+/g, '');
}

// category -> Map<compact form, canonical list word>. Built once at startup
// (WORD_LISTS entries are already normalized, lowercase ASCII) so a lookup
// miss on the exact spelling can fall back to a space/hyphen-insensitive
// match without re-scanning the whole list per answer. First entry wins on a
// collision — vanishingly rare and not worth a tie-break rule.
const COMPACT_WORD_LISTS = {};
for (const category of CATEGORIES) {
  const map = new Map();
  for (const word of WORD_LISTS[category]) {
    const key = compactify(word);
    if (!map.has(key)) map.set(key, word);
  }
  COMPACT_WORD_LISTS[category] = map;
}

// Leading articles a player naturally drops ("Shawshank Redemption" for
// "The Shawshank Redemption") — only movie titles carry these in practice,
// but trying them for every category is harmless (no other list has "the "-
// prefixed entries, so the lookups just miss).
const LEADING_ARTICLES = ['the ', 'a ', 'an '];

// Resolves a normalized answer to its canonical list word, trying exact
// spelling, then space/hyphen-insensitive, then (for either of those) with
// a leading article restored. Returns null if nothing matches.
function resolveCanonical(category, norm) {
  if (WORD_LISTS[category].has(norm)) return norm;
  const compactMatch = COMPACT_WORD_LISTS[category].get(compactify(norm));
  if (compactMatch) return compactMatch;
  for (const article of LEADING_ARTICLES) {
    const withArticle = article + norm;
    if (WORD_LISTS[category].has(withArticle)) return withArticle;
    const articleCompactMatch = COMPACT_WORD_LISTS[category].get(compactify(withArticle));
    if (articleCompactMatch) return articleCompactMatch;
  }
  return null;
}

// Strip control chars, zero-width/invisible chars, and bidi overrides — the
// last let someone reshape a nickname to impersonate another player's name.
// This is NOT profanity filtering (that's a separate, planned task); it only
// removes characters that are invisible or actively deceptive. Built from
// code-point ranges so the source itself stays free of invisible characters.
const INVISIBLE_CHARS = new RegExp(
  '[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]',
  'g',
);
function sanitizeNickname(str) {
  return asString(str)
    .replace(INVISIBLE_CHARS, '')
    .trim()
    .slice(0, MAX_NICKNAME_LEN);
}

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom({ id, type, hostId = null }) {
  const room = {
    id,
    type,
    phase: type === 'public' ? 'answering' : 'waiting',
    hostId,
    players: new Map(),
    nationScores: new Map(),
    currentLetter: null,
    recentLetters: [], // last LETTER_COOLDOWN drawn letters, oldest first
    phaseEndsAt: 0,
    answers: new Map(),
    timer: null,
  };
  rooms.set(id, room);
  return room;
}

function destroyRoom(room) {
  if (room.timer) clearTimeout(room.timer);
  rooms.delete(room.id);
}

function getRoomForSocket(socket) {
  return rooms.get(socket.data.roomId);
}

function privateRoomCount() {
  let n = 0;
  for (const room of rooms.values()) {
    if (room.type === 'private') n++;
  }
  return n;
}

// Private rooms are capped; the public room is uncapped for now (its own cap
// is a separate decision). A socket already in the room isn't double-counted,
// so a reconnect to a full room the player already holds a seat in still works.
function isRoomFull(room, socket) {
  if (room.type !== 'private') return false;
  if (room.players.has(socket.id)) return false;
  return room.players.size >= MAX_PLAYERS_PER_PRIVATE;
}

// Sliding-window limiter on room-code join tries: at most JOIN_ATTEMPT_LIMIT
// within JOIN_LOCKOUT_MS. This is what makes brute-forcing the ~923k 4-char
// codes hopeless; combined with the per-IP connection cap, opening fresh
// sockets to dodge it doesn't help either.
function isJoinLockedOut(socket) {
  const now = Date.now();
  const attempts = (socket.data.joinAttempts || []).filter((t) => now - t < JOIN_LOCKOUT_MS);
  if (attempts.length >= JOIN_ATTEMPT_LIMIT) {
    socket.data.joinAttempts = attempts; // keep the window fresh so it unlocks on time
    return true;
  }
  attempts.push(now);
  socket.data.joinAttempts = attempts;
  return false;
}

// Token bucket: capacity EVENT_RATE_BURST, refills EVENT_RATE_LIMIT tokens/sec.
// Every inbound event costs one token; running dry means the socket is flooding
// and gets dropped. Legit play (~7 events/sec while typing) never comes close.
function allowEvent(socket) {
  const now = Date.now();
  const b = socket.data.bucket;
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(EVENT_RATE_BURST, b.tokens + elapsed * EVENT_RATE_LIMIT);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function pickNextLetter(room) {
  // LETTER_COOLDOWN (15) < LETTERS.length (26), so this pool is never empty.
  const banned = new Set(room.recentLetters);
  const pool = LETTERS.filter((l) => !banned.has(l));
  const letter = pool[Math.floor(Math.random() * pool.length)];

  room.recentLetters.push(letter);
  if (room.recentLetters.length > LETTER_COOLDOWN) room.recentLetters.shift();

  return letter;
}

// Full sorted lists (not just a top 10): the client shows ranks 1-9 plus the
// viewer's own row with its true rank, so it needs everyone's position. At
// the current scale (dozens of players) the payload is a few KB; if the
// public room ever grows to hundreds, switch to top-10 + a per-socket rank.
function topPlayers(room) {
  return [...room.players.entries()]
    .filter(([, p]) => p.connected)
    .map(([id, p]) => ({ id, nickname: p.nickname, countryCode: p.countryCode, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function topNations(room) {
  return [...room.nationScores.entries()]
    .map(([countryCode, score]) => ({ countryCode, score }))
    .sort((a, b) => b.score - a.score);
}

function broadcastLeaderboards(room) {
  io.to(room.id).emit('leaderboard:update', { players: topPlayers(room), nations: topNations(room) });
}

function publicState(room) {
  return {
    phase: room.phase,
    letter: room.currentLetter,
    categories: CATEGORIES,
    phaseEndsAt: room.phaseEndsAt,
    // The client derives "time left" from serverNow instead of its own
    // clock, so a skewed local clock can't break the countdown.
    serverNow: Date.now(),
    roomId: room.id,
    type: room.type,
    hostId: room.hostId,
  };
}

// Evidence trail for "was this word wrongly rejected, or is it just missing
// from the list?" — logs every rejected answer from a REAL player with the
// reason. Bots are excluded (they make mistakes on purpose and would drown
// the signal). raw/nickname go through JSON.stringify so stray whitespace or
// invisible characters show up in the log instead of hiding.
function logRejected(room, id, category, raw, norm, reason) {
  if (Bots.isBot(id)) return;
  const player = room.players.get(id);
  const truncated = asString(raw).length >= MAX_ANSWER_LEN ? 'yes' : 'no';
  console.log(
    `[rejected] letter=${room.currentLetter} cat=${category} raw=${JSON.stringify(raw)} ` +
    `norm=${JSON.stringify(norm)} reason=${reason} player=${JSON.stringify(player?.nickname || '?')} truncated=${truncated}`,
  );
}

function scoreRound(room) {
  // For each category, group valid answers (correct starting letter) by normalized text.
  const results = new Map(); // socketId -> { name: pts, city: pts, animal: pts, plant: pts, movie: pts, object: pts, total }
  for (const id of room.answers.keys()) {
    const entry = { total: 0 };
    for (const category of CATEGORIES) entry[category] = 0;
    results.set(id, entry);
  }

  const normLetter = normalize(room.currentLetter);

  // Display summary for the magnifier popup: EVERYTHING typed (invalid too),
  // grouped and counted. Bounded to top 10 per category regardless of player count.
  const summary = {};

  for (const category of CATEGORIES) {
    const groups = new Map(); // canonical list word -> [socketIds] (space/hyphen variants merge here)
    const counts = new Map(); // normalized answer, as typed -> occurrences
    const validNorms = new Set(); // typed norms that resolved to a valid canonical word
    for (const [id, ans] of room.answers.entries()) {
      const raw = ans[category];
      const norm = normalize(raw);
      if (!norm) continue;
      counts.set(norm, (counts.get(norm) || 0) + 1);
      if (norm[0] !== normLetter) {
        logRejected(room, id, category, raw, norm, 'wrong-letter');
        continue;
      }
      // Exact spelling first, then space/hyphen-insensitive, then with a
      // leading article restored ("Shawshank Redemption" -> "the shawshank
      // redemption"). Every variant groups under the same canonical word
      // below, so two spellings of the same answer split points as
      // duplicates instead of one silently losing free points.
      const canonical = resolveCanonical(category, norm);
      if (!canonical) {
        logRejected(room, id, category, raw, norm, 'not-in-list');
        continue;
      }
      validNorms.add(norm);
      if (!groups.has(canonical)) groups.set(canonical, []);
      groups.get(canonical).push(id);
    }
    for (const ids of groups.values()) {
      const pts = ids.length === 1 ? 10 : 5;
      for (const id of ids) {
        const r = results.get(id);
        r[category] = pts;
        r.total += pts;
      }
    }
    summary[category] = [...counts.entries()]
      .map(([word, count]) => ({ word, count, valid: validNorms.has(word) }))
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
      .slice(0, 10);
  }

  // Apply to player + nation totals
  for (const [id, r] of results.entries()) {
    const player = room.players.get(id);
    if (!player) continue;
    player.score += r.total;
    if (player.countryCode) {
      room.nationScores.set(player.countryCode, (room.nationScores.get(player.countryCode) || 0) + r.total);
    }
  }

  // Stats: count non-empty cells written by real players this round (bots excluded).
  for (const [id, ans] of room.answers.entries()) {
    if (Bots.isBot(id)) continue;
    for (const category of CATEGORIES) {
      if (normalize(ans[category])) serverStats.wordsWritten += 1;
    }
  }

  return { results, summary };
}

function startAnswerPhase(room) {
  room.currentLetter = pickNextLetter(room);
  room.phase = 'answering';
  room.answers = new Map();
  room.phaseEndsAt = Date.now() + ANSWER_PHASE_MS;
  io.to(room.id).emit('round:start', publicState(room));
  broadcastLeaderboards(room);
  room.timer = setTimeout(() => endAnswerPhase(room), ANSWER_PHASE_MS);
  Bots.onRoundStart(room); // no-op for private rooms
}

function endAnswerPhase(room) {
  const { results, summary } = scoreRound(room);
  serverStats.roundsPlayed += 1;
  room.phase = 'results';
  room.phaseEndsAt = Date.now() + RESULT_PHASE_MS;
  io.to(room.id).emit('round:results', {
    letter: room.currentLetter,
    results: Object.fromEntries(results),
    summary,
    phaseEndsAt: room.phaseEndsAt,
    serverNow: Date.now(),
  });
  broadcastLeaderboards(room);
  room.timer = setTimeout(() => startAnswerPhase(room), RESULT_PHASE_MS);
}

function buildPlayer(nickname, countryCode) {
  const code = asString(countryCode).slice(0, 2).toUpperCase();
  return {
    nickname: sanitizeNickname(nickname) || 'Player',
    countryCode: VALID_COUNTRY_CODES.has(code) ? code : '',
    score: 0,
    connected: true,
  };
}

// Removes the socket from whatever room it is currently in, with all the
// side effects that implies (host migration, empty-room teardown, pausing
// an emptied public room). Used by both disconnect and re-join, so a
// socket can never linger in two rooms at once.
function leaveCurrentRoom(socket) {
  const room = getRoomForSocket(socket);
  if (!room) return;

  socket.leave(room.id);
  socket.data.roomId = null;
  room.players.delete(socket.id);
  room.answers.delete(socket.id);

  if (room.phase === 'waiting' && room.hostId === socket.id) {
    const next = room.players.keys().next();
    room.hostId = next.done ? null : next.value;
  }

  if (room.players.size === 0) {
    if (room.type === 'private') {
      destroyRoom(room);
    } else {
      // Public room idles when empty: stop the round loop, resume on next join.
      if (room.timer) clearTimeout(room.timer);
      room.timer = null;
      room.currentLetter = null;
    }
    return;
  }

  broadcastLeaderboards(room);
  if (room.phase === 'waiting') {
    io.to(room.id).emit('state:sync', publicState(room));
  }
}

function joinRoom(socket, room, nickname, countryCode) {
  leaveCurrentRoom(socket);
  room.players.set(socket.id, buildPlayer(nickname, countryCode));
  socket.join(room.id);
  socket.data.roomId = room.id;
  // Wake an idle public room now that it has a player again.
  if (room.type === 'public' && !room.timer) {
    startAnswerPhase(room);
  }
}

// ---- Private stats page ----
// Counts live players/rooms right now (bots vs. real people kept separate) and
// pairs them with the lifetime counters. Reset on every restart (no DB).
function liveStats() {
  let realPlayers = 0;
  let bots = 0;
  let privateRooms = 0;
  for (const room of rooms.values()) {
    if (room.type === 'private') privateRooms += 1;
    for (const [id, p] of room.players) {
      if (!p.connected) continue;
      if (Bots.isBot(id)) bots += 1;
      else realPlayers += 1;
    }
  }
  return { realPlayers, bots, privateRooms };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function statsPage() {
  const s = liveStats();
  const uptimeMin = Math.floor((Date.now() - serverStats.startedAt) / 60000);
  const card = (label, value) =>
    `<div class="card"><div class="num">${escapeHtml(value)}</div><div class="lbl">${escapeHtml(label)}</div></div>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Cattegories · İstatistik</title>
<style>
  body { margin:0; font-family:-apple-system,system-ui,sans-serif; background:#111; color:#eee; padding:24px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
  p.sub { color:#888; font-size:13px; margin:0 0 20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .card { background:#1c1c1c; border:1px solid #2a2a2a; border-radius:10px; padding:18px; }
  .num { font-size:32px; font-weight:700; color:#7ad; }
  .lbl { font-size:13px; color:#999; margin-top:4px; }
</style></head><body>
<h1>Cattegories.io — Canlı İstatistik</h1>
<p class="sub">5 saniyede bir yenilenir · sunucu açılışından beri · her yeniden başlatmada sıfırlanır</p>
<div class="grid">
  ${card('Anlık gerçek oyuncu', s.realPlayers)}
  ${card('Anlık bot', s.bots)}
  ${card('Aktif özel oda', s.privateRooms)}
  ${card('Oynanan tur', serverStats.roundsPlayed)}
  ${card('Yazılan kelime (gerçek)', serverStats.wordsWritten)}
  ${card('Çalışma süresi (dk)', uptimeMin)}
</div>
</body></html>`;
}

// Secret is read from the STATS_TOKEN env var (set in Railway), NOT committed —
// the repo is public. Unknown/missing key returns 404 to hide that the page
// even exists. Disabled entirely if STATS_TOKEN is unset.
app.get('/stats', (req, res) => {
  // trim() both sides: env var values pasted into dashboards often pick up an
  // invisible trailing newline/space, which would silently 404 forever.
  const token = (process.env.STATS_TOKEN || '').trim();
  const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  if (!token || key !== token) {
    return res.status(404).send('Not found');
  }
  res.status(200).send(statsPage());
});

// Behind a reverse proxy (Railway, etc.) every socket connects FROM the
// proxy, so handshake.address is always the proxy's own IP — useless for a
// per-player cap. x-forwarded-for carries the real chain, client first; take
// that first entry. Locally (no proxy) the header is absent and we fall back
// to handshake.address, so this also works unchanged in dev.
function getClientIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || 'unknown';
}

io.on('connection', (socket) => {
  // Per-IP connection cap: refuse a socket once this IP already holds
  // MAX_CONNS_PER_IP live sockets, killing the "open 5000 sockets from one
  // box" attack.
  const ip = getClientIp(socket);
  const ipCount = (connectionsPerIp.get(ip) || 0) + 1;
  connectionsPerIp.set(ip, ipCount);
  if (ipCount > MAX_CONNS_PER_IP) {
    connectionsPerIp.set(ip, ipCount - 1);
    socket.disconnect(true);
    return;
  }

  // Per-socket flood guard: every inbound event costs a token; a socket that
  // drains its bucket is spamming and gets dropped.
  socket.data.bucket = { tokens: EVENT_RATE_BURST, last: Date.now() };
  socket.use((_event, next) => {
    if (allowEvent(socket)) return next();
    socket.disconnect(true);
  });

  socket.on('player:join', (payload) => {
    const { nickname, countryCode, roomId } = payload || {};
    const room = rooms.get(asString(roomId));
    if (!room) {
      socket.emit('room:error', { message: 'Room not found.' });
      return;
    }
    if (isRoomFull(room, socket)) {
      socket.emit('room:error', { message: 'That room is full.' });
      return;
    }
    joinRoom(socket, room, nickname, countryCode);
    socket.emit('state:sync', publicState(room));
    broadcastLeaderboards(room);
  });

  socket.on('room:create', (payload) => {
    const { nickname, countryCode } = payload || {};
    if (privateRoomCount() >= MAX_PRIVATE_ROOMS) {
      socket.emit('room:error', { message: 'The server is full right now. Please try again in a bit.' });
      return;
    }
    const room = createRoom({ id: generateRoomCode(), type: 'private', hostId: socket.id });
    joinRoom(socket, room, nickname, countryCode);
    socket.emit('room:created', publicState(room));
    broadcastLeaderboards(room);
  });

  socket.on('room:join', (payload) => {
    if (isJoinLockedOut(socket)) {
      socket.emit('room:error', { message: 'Too many attempts. Please wait a minute and try again.' });
      return;
    }
    const { roomId, nickname, countryCode } = payload || {};
    const normalizedId = asString(roomId).trim().toUpperCase();
    const room = rooms.get(normalizedId);
    if (!room) {
      socket.emit('room:error', { message: 'Room not found. It may have expired or the code is wrong.' });
      return;
    }
    if (isRoomFull(room, socket)) {
      socket.emit('room:error', { message: 'That room is full.' });
      return;
    }
    joinRoom(socket, room, nickname, countryCode);
    socket.emit('state:sync', publicState(room));
    broadcastLeaderboards(room);
  });

  socket.on('room:leave', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('room:start', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    if (room.type !== 'private' || room.phase !== 'waiting') return;
    if (room.hostId !== socket.id) return;
    startAnswerPhase(room);
  });

  socket.on('answer:update', (payload) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    if (room.phase !== 'answering') return;
    if (!room.players.has(socket.id)) return;
    const prev = room.answers.get(socket.id) || {};
    const next = { ...prev };
    for (const category of CATEGORIES) {
      if (typeof payload?.[category] === 'string') {
        next[category] = payload[category].slice(0, MAX_ANSWER_LEN);
      }
    }
    room.answers.set(socket.id, next);
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    const remaining = (connectionsPerIp.get(ip) || 1) - 1;
    if (remaining <= 0) connectionsPerIp.delete(ip);
    else connectionsPerIp.set(ip, remaining);
  });
});

// Surface crashes in the logs instead of the process dying silently — a
// deploy host restarts the process either way, but this leaves a trail.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

// On every redeploy the host sends SIGTERM to the old instance before
// killing it. Closing the server lets in-flight requests/sockets finish
// instead of being cut off mid-response.
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref(); // force-exit if close hangs
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(process.env.PORT ? `Server running on port ${PORT}` : `Server running: http://localhost:${PORT}`);
  // Diagnostic only — never logs the token itself.
  console.log(`stats page: ${process.env.STATS_TOKEN ? 'enabled' : 'DISABLED (STATS_TOKEN not set)'}`);
  createRoom({ id: 'public', type: 'public' });
  // Bots seat themselves in the public room and wake its round loop; with
  // them churning between BOT_MIN and BOT_MAX the room never idles again.
  Bots.init({
    getPublicRoom: () => rooms.get('public'),
    buildPlayer,
    broadcastLeaderboards,
    startAnswerPhase,
    WORD_LISTS,
    CATEGORIES,
    MAX_ANSWER_LEN,
  });
});
