const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { buildBoard, COLS, ROWS } = require('./board');

const MAX_PLAYERS = 10;
const RECONNECT_GRACE_MS = 3 * 60 * 1000;
const TURN_OPTIONS = [0, 1, 2, 3, 5];
const COLOR_WORDS = new Set([
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'violet', 'indigo', 'pink',
  'brown', 'black', 'white', 'gray', 'grey', 'cyan', 'magenta', 'teal', 'turquoise',
  'lime', 'maroon', 'navy', 'beige', 'tan', 'gold', 'silver', 'reddish', 'orangey',
  'yellowish', 'greenish', 'bluish', 'purplish', 'pinkish', 'brownish', 'grayish', 'greyish'
]);

const board = buildBoard();
const players = new Map();
let order = [];
let settings = { turns: 0 };
let game = freshGame();

function freshGame() {
  return {
    phase: 'lobby',
    round: 0,
    giver: null,
    options: [],
    target: null,
    cues: [],
    cones: [],
    points: null,
    recent: []
  };
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function connectedPlayers() {
  return order.map(id => players.get(id)).filter(p => p && p.connected);
}

function playerByToken(token) {
  for (const p of players.values()) {
    if (p.token === token) return p;
  }
  return null;
}

function stage() {
  return game.cues.length - 1;
}

function guessers() {
  return connectedPlayers().filter(p => p.id !== game.giver);
}

function waitingOn() {
  if (game.phase !== 'guess') return [];
  return guessers()
    .filter(p => !game.cones.some(c => c.player === p.id && c.stage === stage()))
    .map(p => p.id);
}

function roundsTotal() {
  if (settings.turns === 0) return null;
  const remaining = order.reduce((sum, id) => sum + Math.max(0, settings.turns - players.get(id).given), 0);
  return game.round + remaining;
}

function randomCells(count) {
  const picks = [];
  while (picks.length < count) {
    const cell = { row: crypto.randomInt(ROWS), col: crypto.randomInt(COLS) };
    const tooClose = [...picks, ...game.recent].some(p => Math.abs(p.row - cell.row) + Math.abs(p.col - cell.col) < 4);
    if (!tooClose || picks.length + game.recent.length > 40) picks.push(cell);
  }
  return picks;
}

function nextGiver() {
  const start = order.indexOf(game.giver);
  for (let i = 1; i <= order.length; i++) {
    const p = players.get(order[(start + i + order.length) % order.length]);
    if (p.connected && (settings.turns === 0 || p.given < settings.turns)) return p;
  }
  return null;
}

function startGame() {
  if (connectedPlayers().length < 2) return;
  for (const p of players.values()) {
    p.score = 0;
    p.given = 0;
  }
  game = freshGame();
  game.giver = order[order.length - 1];
  startRound();
}

function startRound() {
  const giver = nextGiver();
  if (!giver) {
    game.phase = 'over';
    return;
  }
  giver.given += 1;
  game.round += 1;
  game.giver = giver.id;
  game.options = randomCells(4);
  game.target = null;
  game.cues = [];
  game.cones = [];
  game.points = null;
  game.phase = 'pick';
}

function maybeAdvance() {
  if (game.phase !== 'guess') return;
  if (guessers().length === 0 || waitingOn().length > 0) return;
  game.phase = game.cues.length < 2 ? 'cue' : 'reveal';
  if (game.phase === 'reveal') scoreRound();
}

function scoreRound() {
  const points = {};
  for (const id of order) points[id] = 0;
  for (const cone of game.cones) {
    const d = Math.max(Math.abs(cone.row - game.target.row), Math.abs(cone.col - game.target.col));
    const gained = [3, 2, 1][d] || 0;
    cone.points = gained;
    points[cone.player] = (points[cone.player] || 0) + gained;
    if (d <= 1) points[game.giver] += 1;
  }
  for (const [id, gained] of Object.entries(points)) {
    const p = players.get(id);
    if (p) p.score += gained;
  }
  game.points = points;
  game.recent = [game.target, ...game.recent].slice(0, 12);
}

function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  clearTimeout(p.leaveTimer);
  const index = order.indexOf(id);
  players.delete(id);
  order = order.filter(other => other !== id);
  game.cones = game.cones.filter(c => c.player !== id);

  if (game.phase === 'lobby' || game.phase === 'over') return;
  if (order.length < 2) {
    game = freshGame();
    return;
  }
  if (game.giver === id && game.phase !== 'reveal') {
    game.giver = order[(index - 1 + order.length) % order.length];
    startRound();
    return;
  }
  maybeAdvance();
}

function canSee(cone, viewer) {
  return game.phase === 'reveal' || cone.stage < stage() || cone.player === viewer || viewer === game.giver;
}

function viewFor(viewer) {
  const isGiver = viewer && viewer === game.giver;
  return {
    you: viewer || null,
    maxPlayers: MAX_PLAYERS,
    turnOptions: TURN_OPTIONS,
    settings,
    phase: game.phase,
    round: game.round,
    roundsTotal: roundsTotal(),
    giver: game.giver,
    players: order.map(id => {
      const p = players.get(id);
      return { id: p.id, name: p.name, score: p.score, connected: p.connected };
    }),
    options: isGiver && game.phase === 'pick' ? game.options : null,
    target: isGiver || game.phase === 'reveal' ? game.target : null,
    cues: game.cues,
    stage: stage(),
    cones: game.cones.filter(c => canSee(c, viewer)).map(c => ({
      player: c.player,
      stage: c.stage,
      row: c.row,
      col: c.col,
      points: game.phase === 'reveal' ? c.points : undefined
    })),
    waitingOn: waitingOn(),
    points: game.phase === 'reveal' ? game.points : null
  };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

function broadcast() {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('state', viewFor(socket.data.playerId));
  }
}

function action(socket, handler) {
  return (payload) => {
    const p = players.get(socket.data.playerId);
    const problem = handler(p, payload);
    if (typeof problem === 'string') socket.emit('problem', problem);
    broadcast();
  };
}

function attach(socket, p) {
  if (p.socketId && p.socketId !== socket.id) {
    const old = io.sockets.sockets.get(p.socketId);
    if (old) {
      old.data.playerId = null;
      old.emit('replaced');
      old.disconnect(true);
    }
  }
  clearTimeout(p.leaveTimer);
  p.socketId = socket.id;
  p.connected = true;
  socket.data.playerId = p.id;
}

io.on('connection', (socket) => {
  const returning = playerByToken(socket.handshake.auth && socket.handshake.auth.token);
  if (returning) attach(socket, returning);

  socket.emit('board', { cols: COLS, rows: ROWS, colors: board });

  socket.on('join', action(socket, (p, name) => {
    if (p) return;
    if (players.size >= MAX_PLAYERS) return 'This game is full.';
    let clean = cleanText(name, 20) || `Player ${players.size + 1}`;
    const taken = new Set([...players.values()].map(other => other.name.toLowerCase()));
    for (let n = 2; taken.has(clean.toLowerCase()); n++) clean = `${cleanText(name, 17)} ${n}`;
    const player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomUUID(),
      name: clean,
      score: 0,
      given: 0,
      connected: false,
      socketId: null,
      leaveTimer: null
    };
    players.set(player.id, player);
    order.push(player.id);
    attach(socket, player);
    socket.emit('token', player.token);
  }));

  socket.on('leave', action(socket, (p) => {
    if (!p) return;
    socket.data.playerId = null;
    removePlayer(p.id);
  }));

  socket.on('settings', action(socket, (p, next) => {
    if (!p || game.phase !== 'lobby' && game.phase !== 'over') return;
    const turns = Number(next && next.turns);
    if (TURN_OPTIONS.includes(turns)) settings = { ...settings, turns };
  }));

  socket.on('start', action(socket, (p) => {
    if (!p || game.phase !== 'lobby' && game.phase !== 'over') return;
    if (connectedPlayers().length < 2) return 'You need at least two players.';
    startGame();
  }));

  socket.on('pick', action(socket, (p, index) => {
    if (!p || p.id !== game.giver || game.phase !== 'pick') return;
    if (!Number.isInteger(index)) return;
    const choice = game.options[index];
    if (!choice) return;
    game.target = choice;
    game.phase = 'cue';
  }));

  socket.on('cue', action(socket, (p, text) => {
    if (!p || p.id !== game.giver || game.phase !== 'cue') return;
    const cue = cleanText(text, 40);
    const words = cue.split(' ').filter(Boolean);
    const limit = game.cues.length === 0 ? 1 : 2;
    if (words.length === 0) return 'Type a cue first.';
    if (words.length > limit) return limit === 1 ? 'First cue is one word.' : 'Second cue is up to two words.';
    const banned = words.find(w => COLOR_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));
    if (banned) return `"${banned}" is a color name. Try something it reminds you of.`;
    if (words.some(w => /^[a-p]\d{1,2}$/i.test(w))) return 'No board coordinates.';
    game.cues.push(cue);
    game.phase = 'guess';
  }));

  socket.on('guess', action(socket, (p, cell) => {
    if (!p || p.id === game.giver || game.phase !== 'guess') return;
    const row = Number(cell && cell.row);
    const col = Number(cell && cell.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    if (game.cones.some(c => c.player === p.id && c.stage === stage())) return;
    game.cones.push({ player: p.id, stage: stage(), row, col });
    maybeAdvance();
  }));

  socket.on('next', action(socket, (p, round) => {
    if (!p || game.phase !== 'reveal' || round !== game.round) return;
    startRound();
  }));

  socket.on('end', action(socket, (p) => {
    if (!p || game.phase === 'lobby' || game.phase === 'over') return;
    game.phase = 'over';
  }));

  socket.on('lobby', action(socket, (p) => {
    if (!p || game.phase !== 'over') return;
    game = freshGame();
  }));

  socket.on('disconnect', () => {
    const p = players.get(socket.data.playerId);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    p.leaveTimer = setTimeout(() => {
      removePlayer(p.id);
      broadcast();
    }, RECONNECT_GRACE_MS);
    maybeAdvance();
    broadcast();
  });

  broadcast();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hues and Cues running on http://localhost:${PORT}`);
});
