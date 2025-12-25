const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game state
let gameState = {
  players: [],
  currentCueGiver: null,
  targetColor: null,
  targetCoord: null,
  phase: 'waiting', // waiting, giving-cue, guessing, results
  guesses: {},
  scores: {},
  round: 0
};

// Generate the 480 colors (30 columns x 16 rows)
function generateColorGrid() {
  const colors = [];
  const cols = 30;
  const rows = 16;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Create a spectrum similar to the real Hues and Cues board
      // Hue goes from 0-360 across columns (red -> orange -> yellow -> green -> blue -> purple -> red)
      const hue = (col / cols) * 360;

      // Create variations in saturation and lightness across rows
      // Top rows: lighter/pastel colors (high lightness, varying saturation)
      // Middle rows: vivid colors (high saturation, medium lightness)
      // Bottom rows: darker/muted colors (lower lightness, varying saturation)

      let saturation, lightness;

      if (row < 4) {
        // Pastel/light colors (rows 0-3)
        saturation = 40 + (row * 10); // 40-70%
        lightness = 85 - (row * 5);   // 85-70%
      } else if (row < 8) {
        // Light to medium colors (rows 4-7)
        saturation = 60 + ((row - 4) * 10); // 60-90%
        lightness = 70 - ((row - 4) * 5);   // 70-55%
      } else if (row < 12) {
        // Vivid colors (rows 8-11)
        saturation = 85 + ((row - 8) * 3);  // 85-94%
        lightness = 50 - ((row - 8) * 3);   // 50-41%
      } else {
        // Dark/muted colors (rows 12-15)
        saturation = 70 - ((row - 12) * 10); // 70-40%
        lightness = 35 - ((row - 12) * 5);   // 35-20%
      }

      colors.push({
        row,
        col,
        hsl: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
        coord: `${String.fromCharCode(65 + row)}${col + 1}`
      });
    }
  }
  return colors;
}

const colorGrid = generateColorGrid();

function getRandomColor() {
  const index = Math.floor(Math.random() * colorGrid.length);
  return colorGrid[index];
}

function calculateScore(guessCoord, targetCoord) {
  const guessRow = guessCoord.charCodeAt(0) - 65;
  const guessCol = parseInt(guessCoord.slice(1)) - 1;
  const targetRow = targetCoord.charCodeAt(0) - 65;
  const targetCol = parseInt(targetCoord.slice(1)) - 1;

  const distance = Math.max(Math.abs(guessRow - targetRow), Math.abs(guessCol - targetCol));

  if (distance === 0) return 3;
  if (distance === 1) return 2;
  if (distance === 2) return 1;
  return 0;
}

function resetRound() {
  gameState.targetColor = null;
  gameState.targetCoord = null;
  gameState.guesses = {};
  gameState.phase = 'waiting';
}

function resetGame() {
  gameState.scores = {};
  gameState.players.forEach(p => {
    gameState.scores[p.id] = 0;
  });
  gameState.round = 0;
  gameState.currentCueGiver = null;
  resetRound();
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Handle player joining
  socket.on('join', (playerName) => {
    if (gameState.players.length >= 2) {
      socket.emit('error', 'Game is full');
      return;
    }

    const player = {
      id: socket.id,
      name: playerName || `Player ${gameState.players.length + 1}`
    };

    gameState.players.push(player);
    gameState.scores[socket.id] = 0;

    socket.emit('joined', {
      player,
      colorGrid,
      players: gameState.players
    });

    io.emit('playerJoined', {
      players: gameState.players,
      scores: gameState.scores
    });

    // Start game if 2 players
    if (gameState.players.length === 2) {
      gameState.currentCueGiver = gameState.players[0].id;
      gameState.round = 1;
      startNewRound();
    }
  });

  function startNewRound() {
    const targetColor = getRandomColor();
    gameState.targetColor = targetColor;
    gameState.targetCoord = targetColor.coord;
    gameState.phase = 'giving-cue';
    gameState.guesses = {};

    // Send target only to cue giver
    io.to(gameState.currentCueGiver).emit('yourTurn', {
      targetColor: targetColor,
      round: gameState.round
    });

    // Notify guesser
    const guesserId = gameState.players.find(p => p.id !== gameState.currentCueGiver)?.id;
    if (guesserId) {
      io.to(guesserId).emit('waitingForCue', {
        cueGiver: gameState.players.find(p => p.id === gameState.currentCueGiver)?.name,
        round: gameState.round
      });
    }

    io.emit('gameState', {
      phase: gameState.phase,
      currentCueGiver: gameState.currentCueGiver,
      round: gameState.round,
      scores: gameState.scores
    });
  }

  // Cue giver signals they've given their verbal cue
  socket.on('cueGiven', () => {
    if (socket.id !== gameState.currentCueGiver) return;

    gameState.phase = 'guessing';
    io.emit('startGuessing', {
      phase: gameState.phase
    });
  });

  // Handle guess
  socket.on('guess', (coord) => {
    if (socket.id === gameState.currentCueGiver) return;
    if (gameState.phase !== 'guessing') return;

    gameState.guesses[socket.id] = coord;

    // Calculate scores
    const score = calculateScore(coord, gameState.targetCoord);
    const cueGiverScore = score; // Cue giver gets same points

    gameState.scores[socket.id] += score;
    gameState.scores[gameState.currentCueGiver] += cueGiverScore;

    gameState.phase = 'results';

    io.emit('roundResults', {
      targetColor: gameState.targetColor,
      targetCoord: gameState.targetCoord,
      guesses: gameState.guesses,
      guessScore: score,
      scores: gameState.scores,
      round: gameState.round
    });
  });

  // Start next round (infinite rounds)
  socket.on('nextRound', () => {
    // Switch cue giver
    gameState.currentCueGiver = gameState.players.find(
      p => p.id !== gameState.currentCueGiver
    )?.id;
    gameState.round++;

    resetRound();
    startNewRound();
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    delete gameState.scores[socket.id];

    if (gameState.players.length < 2) {
      resetGame();
    }

    io.emit('playerLeft', {
      players: gameState.players,
      scores: gameState.scores
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hues and Cues server running on http://localhost:${PORT}`);
});
