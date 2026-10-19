const TOKEN_KEY = 'hues-token';
const NAME_KEY = 'hues-name';

function storageGet(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(store, key, value) {
  try {
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {}
}

const socket = io({ auth: { token: storageGet(sessionStorage, TOKEN_KEY) } });

const $ = (id) => document.getElementById(id);
const els = {
  join: $('join'),
  joinForm: $('join-form'),
  name: $('name'),
  joinNote: $('join-note'),
  game: $('game'),
  round: $('round'),
  conn: $('conn'),
  leave: $('leave'),
  stage: $('stage'),
  cues: $('cues'),
  controls: $('controls'),
  problem: $('problem'),
  board: $('board'),
  hoverCoord: $('hover-coord'),
  scores: $('scores')
};

let colors = [];
let cols = 30;
let cells = [];
let frames = [];
let state = null;
let selected = null;
let controlsKey = '';
let problemTimer = null;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style') Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

function coord(cell) {
  return `${String.fromCharCode(65 + cell.row)}${cell.col + 1}`;
}

function colorAt(cell) {
  return colors[cell.row * cols + cell.col];
}

function player(id) {
  return state.players.find((p) => p.id === id);
}

function names(ids) {
  const list = ids.map((id) => player(id)?.name).filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function myCone() {
  return state.cones.find((c) => c.player === state.you && c.stage === state.stage);
}

function canGuess() {
  return state.phase === 'guess' && state.you !== state.giver && !myCone();
}

function buildBoard(data) {
  colors = data.colors;
  cols = data.cols;
  cells = [];
  els.board.replaceChildren();
  els.board.style.setProperty('--cols', data.cols);
  for (let col = 0; col < data.cols; col++) {
    els.board.append(h('div', { class: 'label col-label', style: { gridRow: 1, gridColumn: col + 2 } }, col + 1));
  }
  for (let row = 0; row < data.rows; row++) {
    els.board.append(h('div', { class: 'label row-label', style: { gridRow: row + 2, gridColumn: 1 } }, String.fromCharCode(65 + row)));
    const line = [];
    for (let col = 0; col < data.cols; col++) {
      const cell = { row, col };
      const el = h('button', {
        class: 'cell',
        type: 'button',
        'aria-label': coord(cell),
        'data-row': row,
        'data-col': col,
        style: { backgroundColor: colorAt(cell), gridRow: row + 2, gridColumn: col + 2 }
      });
      line.push(el);
      els.board.append(el);
    }
    cells.push(line);
  }
  frames = [h('div', { class: 'frame frame-outer', hidden: true }), h('div', { class: 'frame frame-inner', hidden: true })];
  els.board.append(...frames);
  render();
}

function placeFrame(el, target, radius) {
  const rows = cells.length;
  const top = Math.max(0, target.row - radius);
  const bottom = Math.min(rows - 1, target.row + radius);
  const left = Math.max(0, target.col - radius);
  const right = Math.min(cols - 1, target.col + radius);
  el.style.gridRow = `${top + 2} / ${bottom + 3}`;
  el.style.gridColumn = `${left + 2} / ${right + 3}`;
  el.hidden = false;
}

function renderBoard() {
  if (!cells.length) return;
  for (const line of cells) {
    for (const el of line) {
      el.className = 'cell';
      el.replaceChildren();
    }
  }
  els.board.classList.toggle('guessing', canGuess());

  if (state.options) {
    state.options.forEach((cell, i) => {
      const el = cells[cell.row][cell.col];
      el.classList.add('is-option');
      el.append(h('span', { class: 'option-tag' }, i + 1));
    });
  }
  if (state.target) cells[state.target.row][state.target.col].classList.add('is-target');
  if (selected && canGuess()) cells[selected.row][selected.col].classList.add('is-selected');

  for (const cone of state.cones) {
    const p = player(cone.player);
    const el = cells[cone.row][cone.col];
    el.classList.add('has-cone');
    el.append(h('span', {
      class: `cone cone-${cone.stage}`,
      title: `${p?.name ?? ''} · guess ${cone.stage + 1}`
    }, (p?.name ?? '?').slice(0, 1).toUpperCase()));
  }

  const reveal = state.phase === 'reveal' && state.target;
  frames[0].hidden = true;
  frames[1].hidden = true;
  if (reveal) {
    placeFrame(frames[0], state.target, 2);
    placeFrame(frames[1], state.target, 1);
  }
}

function renderRound() {
  if (state.phase === 'lobby') {
    els.round.textContent = 'Lobby';
    return;
  }
  const num = String(state.round).padStart(2, '0');
  els.round.textContent = state.roundsTotal ? `Round ${num} / ${String(state.roundsTotal).padStart(2, '0')}` : `Round ${num} · Endless`;
}

function stageCopy() {
  const giver = player(state.giver);
  const giverName = giver?.name ?? 'The cue giver';
  const isGiver = state.you === state.giver;
  const round = `Round ${state.round}`;
  const giverAway = giver && !giver.connected ? `${giverName} lost connection. Waiting for them to come back.` : null;

  switch (state.phase) {
    case 'lobby': {
      const online = state.players.filter((p) => p.connected).length;
      return ['Lobby', 'Waiting to start', online < 2 ? 'Send the link to someone. You need at least two players.' : 'Everyone here? Start whenever you are ready.'];
    }
    case 'pick':
      return isGiver
        ? [`${round} · You give the cues`, 'Pick a color to describe', 'Choose one of the four numbered squares. Only you can see them.']
        : [`${round} · Guessing`, `${giverName} is picking a color`, giverAway ?? 'Hang tight.'];
    case 'cue': {
      const first = state.cues.length === 0;
      return isGiver
        ? [`${round} · You give the cues`, first ? 'Give a one-word cue' : 'Give a second cue', first ? 'No color names or board positions. Think things, places, moods.' : 'Up to two words this time. Steer them closer.']
        : [`${round} · Guessing`, `${giverName} is thinking of ${first ? 'a cue' : 'a second cue'}`, giverAway ?? (first ? 'Get ready.' : 'Your first guess is on the board.')];
    }
    case 'guess': {
      const waiting = names(state.waitingOn);
      if (isGiver) return [`${round} · You give the cues`, 'They are guessing', waiting ? `Waiting on ${waiting}.` : ''];
      if (myCone()) return [`${round} · Guessing`, 'Guess placed', waiting ? `Waiting on ${waiting}.` : ''];
      return [`${round} · Guessing`, state.stage === 0 ? 'Place your first guess' : 'Place your second guess', 'Tap the square that best matches the cue.'];
    }
    case 'reveal': {
      const mine = state.points?.[state.you] ?? 0;
      return [`${round} · Result`, `The color was ${coord(state.target)}`, `You scored ${mine} this round.`];
    }
    case 'over': {
      const top = Math.max(...state.players.map((p) => p.score));
      const winners = state.players.filter((p) => p.score === top);
      return ['Game over', winners.length > 1 ? `Tie at ${top}` : `${winners[0]?.name ?? 'Nobody'} wins`, `Final score ${top}.`];
    }
  }
  return ['', '', ''];
}

function renderStage() {
  const [eyebrow, headline, detail] = stageCopy();
  els.stage.replaceChildren(
    h('p', { class: 'eyebrow' }, eyebrow),
    h('h2', { class: 'headline' }, headline),
    detail ? h('p', { class: 'detail' }, detail) : null
  );
}

function renderCues() {
  els.cues.replaceChildren(...state.cues.map((cue, i) => h('div', { class: 'cue' },
    h('span', { class: 'eyebrow' }, `Cue ${i + 1}`),
    h('span', { class: 'cue-text' }, cue)
  )));
}

function swatch(cell, size = '') {
  return h('div', { class: `swatch ${size}`, style: { backgroundColor: colorAt(cell) } },
    h('span', { class: 'swatch-coord' }, coord(cell)));
}

function lobbyControls() {
  const online = state.players.filter((p) => p.connected).length;
  return [
    h('p', { class: 'eyebrow' }, 'Game length'),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Turns each' },
      state.turnOptions.map((turns) => h('button', {
        type: 'button',
        class: 'seg',
        'aria-pressed': String(state.settings.turns === turns),
        onclick: () => socket.emit('settings', { turns })
      }, turns === 0 ? 'Endless' : `${turns} each`))
    ),
    h('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      disabled: online < 2,
      onclick: () => socket.emit('start')
    }, 'Start game')
  ];
}

function pickControls() {
  return h('div', { class: 'options' }, state.options.map((cell, i) => h('button', {
    type: 'button',
    class: 'option',
    onclick: () => socket.emit('pick', i),
    onmouseenter: () => cells[cell.row][cell.col].classList.add('is-hot'),
    onmouseleave: () => cells[cell.row][cell.col].classList.remove('is-hot')
  }, h('span', { class: 'option-num mono' }, i + 1), swatch(cell))));
}

function cueControls() {
  const first = state.cues.length === 0;
  const input = h('input', {
    name: 'cue',
    maxlength: 40,
    autocomplete: 'off',
    placeholder: first ? 'One word' : 'Up to two words',
    'aria-label': 'Cue'
  });
  const form = h('form', {
    class: 'cue-form',
    onsubmit: (e) => {
      e.preventDefault();
      socket.emit('cue', input.value);
    }
  }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send'));
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
  return [h('div', { class: 'target-row' }, swatch(state.target, 'swatch-lg'), h('p', { class: 'detail' }, 'Your color')), form];
}

function guessControls() {
  const label = h('span', { class: 'mono', id: 'selected-label' }, selected ? coord(selected) : 'Nothing selected');
  const button = h('button', {
    type: 'button',
    id: 'place',
    class: 'btn btn-primary btn-block',
    disabled: !selected,
    onclick: () => {
      if (!selected) return;
      socket.emit('guess', selected);
      selected = null;
    }
  }, 'Place guess');
  return [h('div', { class: 'selected-row' }, h('span', { class: 'eyebrow' }, 'Selected'), label), button];
}

function giverWaitControls() {
  return h('div', { class: 'target-row' }, swatch(state.target, 'swatch-lg'), h('p', { class: 'detail' }, 'Your color'));
}

function revealControls() {
  const rows = state.players
    .map((p) => ({ ...p, gained: state.points?.[p.id] ?? 0 }))
    .sort((a, b) => b.gained - a.gained);
  return [
    h('div', { class: 'target-row' }, swatch(state.target, 'swatch-lg'), h('p', { class: 'detail' }, `${player(state.giver)?.name ?? 'Cue giver'}'s color`)),
    h('ul', { class: 'gains' }, rows.map((p) => h('li', {},
      h('span', {}, p.name, p.id === state.giver ? h('span', { class: 'tag' }, 'Cues') : null),
      h('span', { class: 'mono' }, `+${p.gained}`)
    ))),
    h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => socket.emit('next', state.round) }, 'Next round'),
    h('button', { type: 'button', class: 'link', onclick: () => socket.emit('end') }, 'End game')
  ];
}

function overControls() {
  return [
    h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => socket.emit('start') }, 'Play again'),
    h('button', { type: 'button', class: 'link', onclick: () => socket.emit('lobby') }, 'Back to lobby')
  ];
}

function renderControls() {
  const isGiver = state.you === state.giver;
  const key = JSON.stringify([
    state.phase,
    state.round,
    state.stage,
    isGiver,
    Boolean(myCone()),
    state.phase === 'lobby' ? [state.settings, state.players.filter((p) => p.connected).length] : null
  ]);
  if (key === controlsKey) return;
  controlsKey = key;

  let content = null;
  if (state.phase === 'lobby') content = lobbyControls();
  else if (state.phase === 'pick' && isGiver) content = pickControls();
  else if (state.phase === 'cue' && isGiver) content = cueControls();
  else if (state.phase === 'guess' && isGiver) content = giverWaitControls();
  else if (state.phase === 'guess' && !myCone()) content = guessControls();
  else if (state.phase === 'reveal') content = revealControls();
  else if (state.phase === 'over') content = overControls();
  els.controls.replaceChildren(...[content].flat().filter(Boolean));
}

function renderScores() {
  const list = state.phase === 'over' ? [...state.players].sort((a, b) => b.score - a.score) : state.players;
  els.scores.replaceChildren(...list.map((p) => h('li', { class: p.connected ? '' : 'offline' },
    h('span', { class: 'score-name' },
      p.name,
      p.id === state.you ? h('span', { class: 'tag' }, 'You') : null,
      p.id === state.giver && state.phase !== 'lobby' && state.phase !== 'over' ? h('span', { class: 'tag tag-strong' }, 'Cues') : null,
      p.connected ? null : h('span', { class: 'tag' }, 'Offline')
    ),
    h('span', { class: 'score mono' }, p.score)
  )));
}

function renderJoin() {
  const count = state.players.length;
  let note = count === 0 ? 'Nobody here yet. You will be first.' : `${count} ${count === 1 ? 'player' : 'players'} here: ${state.players.map((p) => p.name).join(', ')}.`;
  if (count >= state.maxPlayers) note = 'This game is full.';
  else if (state.phase !== 'lobby' && state.phase !== 'over') note += ' A game is running. You will jump in as a guesser.';
  els.joinNote.textContent = note;
}

function render() {
  if (!state) return;
  const joined = Boolean(state.you);
  els.join.hidden = joined;
  els.game.hidden = !joined;
  if (!joined) {
    renderJoin();
    return;
  }
  if (!canGuess()) selected = null;
  renderRound();
  renderStage();
  renderCues();
  renderControls();
  renderScores();
  renderBoard();
}

function showProblem(message) {
  els.problem.textContent = message;
  clearTimeout(problemTimer);
  problemTimer = setTimeout(() => {
    els.problem.textContent = '';
  }, 5000);
}

els.board.addEventListener('click', (e) => {
  const el = e.target.closest('.cell');
  if (!el || !state || !canGuess()) return;
  selected = { row: Number(el.dataset.row), col: Number(el.dataset.col) };
  renderBoard();
  const label = document.getElementById('selected-label');
  const place = document.getElementById('place');
  if (label) label.textContent = coord(selected);
  if (place) place.disabled = false;
});

els.board.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.cell');
  if (el) els.hoverCoord.textContent = coord({ row: Number(el.dataset.row), col: Number(el.dataset.col) });
});

els.board.addEventListener('mouseleave', () => {
  els.hoverCoord.innerHTML = '&nbsp;';
});

els.name.value = storageGet(localStorage, NAME_KEY) ?? '';

els.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = els.name.value.trim();
  storageSet(localStorage, NAME_KEY, name);
  socket.emit('join', name);
});

els.leave.addEventListener('click', () => {
  socket.emit('leave');
  storageSet(sessionStorage, TOKEN_KEY, null);
  socket.auth.token = null;
});

socket.on('board', buildBoard);

socket.on('state', (next) => {
  state = next;
  render();
});

socket.on('token', (token) => {
  storageSet(sessionStorage, TOKEN_KEY, token);
  socket.auth.token = token;
});

socket.on('problem', showProblem);

socket.on('replaced', () => {
  storageSet(sessionStorage, TOKEN_KEY, null);
  els.game.hidden = true;
  els.join.hidden = false;
  els.joinNote.textContent = 'You opened the game in another tab. Keep playing there.';
});

socket.on('connect', () => {
  els.conn.hidden = true;
});

socket.on('disconnect', () => {
  els.conn.hidden = false;
});
