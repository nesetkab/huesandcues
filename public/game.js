const socket = io();

// DOM elements
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');
const waitingText = document.getElementById('waiting-text');
const roundDisplay = document.getElementById('round-display');
const player1Info = document.getElementById('player1-info');
const player2Info = document.getElementById('player2-info');
const gameStatus = document.getElementById('game-status');
const targetDisplay = document.getElementById('target-display');
const targetColorBox = document.getElementById('target-color-box');
const cueGivenBtn = document.getElementById('cue-given-btn');
const colorGrid = document.getElementById('color-grid');
const resultsPanel = document.getElementById('results-panel');
const resultTarget = document.getElementById('result-target');
const resultGuess = document.getElementById('result-guess');
const resultScore = document.getElementById('result-score');
const nextRoundBtn = document.getElementById('next-round-btn');

// Game state
let myPlayer = null;
let players = [];
let colorGridData = [];
let currentCueGiver = null;
let isCueGiver = false;
let canGuess = false;
let targetColor = null;

// Join game
joinBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Anonymous';
  socket.emit('join', name);
});

playerNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    joinBtn.click();
  }
});

// Socket events
socket.on('joined', (data) => {
  myPlayer = data.player;
  colorGridData = data.colorGrid;
  players = data.players;

  waitingText.textContent = 'Waiting for another player to join...';

  renderColorGrid();
  updatePlayersDisplay();
});

socket.on('playerJoined', (data) => {
  players = data.players;
  updatePlayersDisplay();

  if (players.length === 2) {
    joinScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameStatus.textContent = 'Game starting...';
  } else {
    waitingText.textContent = `${players.length}/2 players. Waiting for another player...`;
  }
});

socket.on('yourTurn', (data) => {
  targetColor = data.targetColor;
  isCueGiver = true;
  canGuess = false;

  roundDisplay.textContent = `Round ${data.round}`;
  gameStatus.textContent = 'You are the Cue Giver! Look at your target color and give a verbal hint.';

  targetDisplay.classList.remove('hidden');
  resultsPanel.classList.add('hidden');
  targetColorBox.style.backgroundColor = targetColor.hsl;

  updateGridState(false);
  highlightCueGiver();
});

socket.on('waitingForCue', (data) => {
  isCueGiver = false;
  canGuess = false;

  roundDisplay.textContent = `Round ${data.round}`;
  gameStatus.textContent = `${data.cueGiver} is thinking of a color... Listen for their hint!`;
  targetDisplay.classList.add('hidden');
  resultsPanel.classList.add('hidden');

  updateGridState(false);
  highlightCueGiver();
});

socket.on('gameState', (data) => {
  currentCueGiver = data.currentCueGiver;
  roundDisplay.textContent = `Round ${data.round}`;
  updateScores(data.scores);
  highlightCueGiver();
});

socket.on('startGuessing', (data) => {
  if (!isCueGiver) {
    canGuess = true;
    gameStatus.textContent = 'Make your guess! Click on the color you think matches the hint.';
    updateGridState(true);
  } else {
    gameStatus.textContent = 'Waiting for your partner to guess...';
  }
});

socket.on('roundResults', (data) => {
  targetColor = data.targetColor;

  // Show results in inline panel
  resultTarget.style.backgroundColor = data.targetColor.hsl;

  // Find guess color
  const guessCoord = Object.values(data.guesses)[0];
  const guessColor = colorGridData.find(c => c.coord === guessCoord);
  if (guessColor) {
    resultGuess.style.backgroundColor = guessColor.hsl;
  }

  // Show score
  const scoreText = data.guessScore === 3 ? 'Perfect! +3 each' :
                    data.guessScore === 2 ? 'Very close! +2 each' :
                    data.guessScore === 1 ? 'Close! +1 each' :
                    'Too far! +0';
  resultScore.textContent = scoreText;

  updateScores(data.scores);

  // Mark target and guess on grid
  markResultsOnGrid(data.targetCoord, guessCoord);

  // Show inline results panel, hide target display
  resultsPanel.classList.remove('hidden');
  targetDisplay.classList.add('hidden');
  gameStatus.textContent = 'Round complete! Check the grid to see target and guess.';
  canGuess = false;
});

socket.on('playerLeft', (data) => {
  players = data.players;
  updatePlayersDisplay();

  if (players.length < 2) {
    gameScreen.classList.remove('active');
    joinScreen.classList.add('active');
    waitingText.textContent = 'Other player left. Waiting for a new player...';
    resultsPanel.classList.add('hidden');
  }
});

socket.on('error', (message) => {
  alert(message);
});

// Button handlers
cueGivenBtn.addEventListener('click', () => {
  socket.emit('cueGiven');
  gameStatus.textContent = 'Waiting for your partner to guess...';
  cueGivenBtn.disabled = true;
  cueGivenBtn.textContent = 'Waiting for guess...';
});

nextRoundBtn.addEventListener('click', () => {
  resultsPanel.classList.add('hidden');
  clearGridMarkers();
  socket.emit('nextRound');
});

// Helper functions
function renderColorGrid() {
  colorGrid.innerHTML = '';

  colorGridData.forEach((color) => {
    const cell = document.createElement('div');
    cell.className = 'color-cell disabled';
    cell.style.backgroundColor = color.hsl;
    cell.dataset.coord = color.coord;
    cell.dataset.row = color.row;
    cell.dataset.col = color.col;

    cell.addEventListener('click', () => {
      if (canGuess && !isCueGiver) {
        socket.emit('guess', color.coord);
        canGuess = false;
        gameStatus.textContent = 'Guess submitted!';
        updateGridState(false);
      }
    });

    colorGrid.appendChild(cell);
  });
}

function updateGridState(enabled) {
  const cells = colorGrid.querySelectorAll('.color-cell');
  cells.forEach(cell => {
    if (enabled && !isCueGiver) {
      cell.classList.remove('disabled');
    } else {
      cell.classList.add('disabled');
    }
  });
}

function markResultsOnGrid(targetCoord, guessCoord) {
  clearGridMarkers();

  const cells = colorGrid.querySelectorAll('.color-cell');
  cells.forEach(cell => {
    if (cell.dataset.coord === targetCoord) {
      cell.classList.add('target');
    }
    if (cell.dataset.coord === guessCoord) {
      cell.classList.add('guess');
    }
  });
}

function clearGridMarkers() {
  const cells = colorGrid.querySelectorAll('.color-cell');
  cells.forEach(cell => {
    cell.classList.remove('target', 'guess', 'selected');
  });

  // Reset cue button
  cueGivenBtn.disabled = false;
  cueGivenBtn.textContent = "I've Given My Hint";
}

function updatePlayersDisplay() {
  if (players.length >= 1) {
    player1Info.querySelector('.player-name').textContent = players[0].name;
  }
  if (players.length >= 2) {
    player2Info.querySelector('.player-name').textContent = players[1].name;
  }
}

function updateScores(scores) {
  if (players.length >= 1 && scores[players[0].id] !== undefined) {
    player1Info.querySelector('.player-score').textContent = scores[players[0].id];
  }
  if (players.length >= 2 && scores[players[1].id] !== undefined) {
    player2Info.querySelector('.player-score').textContent = scores[players[1].id];
  }
}

function highlightCueGiver() {
  player1Info.classList.remove('cue-giver', 'guesser');
  player2Info.classList.remove('cue-giver', 'guesser');

  if (players.length >= 2) {
    if (currentCueGiver === players[0].id) {
      player1Info.classList.add('cue-giver');
      player2Info.classList.add('guesser');
    } else {
      player2Info.classList.add('cue-giver');
      player1Info.classList.add('guesser');
    }
  }
}
