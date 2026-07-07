const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const { WORD_LISTS } = require('./wordlists');
const { COUNTRIES } = require('./public/countries');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const CATEGORIES = ['name', 'city', 'animal', 'plant', 'food', 'object'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

const ANSWER_PHASE_MS = 60 * 1000;
const RESULT_PHASE_MS = 8 * 1000;

const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // excludes 0/O/1/I/L (ambiguous in the handwritten UI font)
const ROOM_CODE_LENGTH = 4;

// rooms: roomId -> Room
// Room = { id, type: 'public'|'private', phase: 'waiting'|'answering'|'results', hostId,
//          players: Map<socketId, {nickname, countryCode, score, connected}>,
//          nationScores: Map<countryCode, number>, currentLetter, phaseEndsAt,
//          answers: Map<socketId, {name, city, animal, plant, food, object}>, timer }
const rooms = new Map();

const VALID_COUNTRY_CODES = new Set(COUNTRIES.map(([code]) => code));

// Clients can emit anything (including no payload at all); never trust a
// value to be a string before treating it as one.
function asString(value) {
  return typeof value === 'string' ? value : '';
}

function normalize(str) {
  return asString(str).trim().toLowerCase();
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

function pickNextLetter(room) {
  let letter;
  do {
    letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
  } while (letter === room.currentLetter && LETTERS.length > 1);
  return letter;
}

function topPlayers(room, limit = 10) {
  return [...room.players.entries()]
    .filter(([, p]) => p.connected)
    .map(([id, p]) => ({ id, nickname: p.nickname, countryCode: p.countryCode, score: p.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function topNations(room, limit = 10) {
  return [...room.nationScores.entries()]
    .map(([countryCode, score]) => ({ countryCode, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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

function scoreRound(room) {
  // For each category, group valid answers (correct starting letter) by normalized text.
  const results = new Map(); // socketId -> { name: pts, city: pts, animal: pts, plant: pts, food: pts, object: pts, total }
  for (const id of room.answers.keys()) {
    const entry = { total: 0 };
    for (const category of CATEGORIES) entry[category] = 0;
    results.set(id, entry);
  }

  const normLetter = normalize(room.currentLetter);

  for (const category of CATEGORIES) {
    const groups = new Map(); // normalized answer -> [socketIds]
    for (const [id, ans] of room.answers.entries()) {
      const raw = ans[category];
      const norm = normalize(raw);
      if (!norm || norm[0] !== normLetter) continue;
      if (!WORD_LISTS[category].has(norm)) continue;
      if (!groups.has(norm)) groups.set(norm, []);
      groups.get(norm).push(id);
    }
    for (const ids of groups.values()) {
      const pts = ids.length === 1 ? 10 : 5;
      for (const id of ids) {
        const r = results.get(id);
        r[category] = pts;
        r.total += pts;
      }
    }
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

  return results;
}

function startAnswerPhase(room) {
  room.currentLetter = pickNextLetter(room);
  room.phase = 'answering';
  room.answers = new Map();
  room.phaseEndsAt = Date.now() + ANSWER_PHASE_MS;
  io.to(room.id).emit('round:start', publicState(room));
  broadcastLeaderboards(room);
  room.timer = setTimeout(() => endAnswerPhase(room), ANSWER_PHASE_MS);
}

function endAnswerPhase(room) {
  const results = scoreRound(room);
  room.phase = 'results';
  room.phaseEndsAt = Date.now() + RESULT_PHASE_MS;
  io.to(room.id).emit('round:results', {
    letter: room.currentLetter,
    results: Object.fromEntries(results),
    phaseEndsAt: room.phaseEndsAt,
    serverNow: Date.now(),
  });
  broadcastLeaderboards(room);
  room.timer = setTimeout(() => startAnswerPhase(room), RESULT_PHASE_MS);
}

function buildPlayer(nickname, countryCode) {
  const code = asString(countryCode).slice(0, 2).toUpperCase();
  return {
    nickname: asString(nickname).trim().slice(0, 20) || 'Player',
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

io.on('connection', (socket) => {
  socket.on('player:join', (payload) => {
    const { nickname, countryCode, roomId } = payload || {};
    const room = rooms.get(asString(roomId));
    if (!room) {
      socket.emit('room:error', { message: 'Room not found.' });
      return;
    }
    joinRoom(socket, room, nickname, countryCode);
    socket.emit('state:sync', publicState(room));
    broadcastLeaderboards(room);
  });

  socket.on('room:create', (payload) => {
    const { nickname, countryCode } = payload || {};
    const room = createRoom({ id: generateRoomCode(), type: 'private', hostId: socket.id });
    joinRoom(socket, room, nickname, countryCode);
    socket.emit('room:created', publicState(room));
    broadcastLeaderboards(room);
  });

  socket.on('room:join', (payload) => {
    const { roomId, nickname, countryCode } = payload || {};
    const normalizedId = asString(roomId).trim().toUpperCase();
    const room = rooms.get(normalizedId);
    if (!room) {
      socket.emit('room:error', { message: 'Room not found. It may have expired or the code is wrong.' });
      return;
    }
    joinRoom(socket, room, nickname, countryCode);
    socket.emit('state:sync', publicState(room));
    broadcastLeaderboards(room);
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
        next[category] = payload[category].slice(0, 40);
      }
    }
    room.answers.set(socket.id, next);
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
  // The public room starts idle; its round loop wakes when the first player joins.
  createRoom({ id: 'public', type: 'public' });
});
