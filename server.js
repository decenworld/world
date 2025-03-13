const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

// Create the Express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the images directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// Store player information
const players = {};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // Debug: Log all current players in the players object
  console.log('Current players in players object at connection time:', Object.keys(players));
  console.log('Active socket connections:', Array.from(io.sockets.sockets.keys()));
  
  // Send the player their ID
  socket.emit('playerID', { id: socket.id });
  
  // Handle player information
  socket.on('player_info', (data) => {
    console.log('Received player info:', data);
    
    // Store player info
    players[socket.id] = {
      id: socket.id,
      username: data.username,
      x: data.x || 400,
      y: data.y || 300,
      health: 10,
      direction: 'down',
      state: 'idle'
    };
    
    console.log(`Player ${socket.id} registered with username ${data.username}`);
    
    // First, send all existing players to the new player
    const existingPlayers = Object.values(players).filter(player => player.id !== socket.id);
    
    if (existingPlayers.length > 0) {
      console.log(`Sending ${existingPlayers.length} existing players to new player ${socket.id}`);
      
      // Send all existing players at once
      socket.emit('syncPlayers', {
        players: existingPlayers
      });
    }
    
    // Then, after a short delay, broadcast the new player to all other clients
    setTimeout(() => {
      console.log(`Broadcasting new player ${socket.id} to all clients`);
      io.emit('playerJoined', players[socket.id]);
    }, 100);
  });
  
  // Handle request for all players
  socket.on('getAllPlayers', () => {
    console.log(`Player ${socket.id} requested all players`);
    
    // Send all current players to the requesting client
    const currentPlayers = Object.values(players).filter(player => 
      player.id !== socket.id && io.sockets.sockets.get(player.id)
    );
    
    socket.emit('syncPlayers', {
      players: currentPlayers
    });
  });
  
  // Handle requests for player info
  socket.on('request_player_info', (data) => {
    const requestedPlayer = players[data.id];
    if (requestedPlayer) {
      // Send the requested player's info to the requesting client
      socket.emit('player_info', {
        id: requestedPlayer.id,
        username: requestedPlayer.username
      });
    }
  });
  
  // Handle player movement
  socket.on('playerMove', (data) => {
    // Make sure the data includes the player's ID
    const moveData = {
      id: data.id || socket.id,
      x: data.x,
      y: data.y,
      direction: data.direction,
      state: data.state
    };
    
    // Update player position in the server's player object
    if (players[socket.id]) {
      players[socket.id].x = moveData.x;
      players[socket.id].y = moveData.y;
      players[socket.id].direction = moveData.direction;
      players[socket.id].state = moveData.state;
      
      // Log position updates occasionally (every ~5 seconds)
      if (Math.random() < 0.01) {
        console.log(`Player ${socket.id} moved to (${moveData.x}, ${moveData.y})`);
      }
    }
    
    // Broadcast the movement to ALL clients (including the sender)
    // This ensures everyone sees the exact same positions
    io.emit('playerMoved', moveData);
  });
  
  // Handle player shooting
  socket.on('playerShoot', (data) => {
    // Add the shooter's ID to the bullet data
    const bulletData = {
      id: socket.id,
      x: data.x,
      y: data.y,
      direction: data.direction,
      bulletId: data.bulletId
    };
    
    console.log(`Player ${socket.id} fired bullet ${data.bulletId}`);
    
    // Broadcast the bullet to all other players
    socket.broadcast.emit('bulletCreated', bulletData);
  });
  
  // Handle bullet hit
  socket.on('bulletHit', (data) => {
    console.log('Bullet hit received:', data);
    
    // Make sure we have the target ID
    if (!data.targetId) {
      console.error('Missing targetId in bulletHit event');
      return;
    }
    
    // Make sure we have the bullet ID
    if (!data.bulletId) {
      console.error('Missing bulletId in bulletHit event');
      return;
    }
    
    const targetPlayer = players[data.targetId];
    if (targetPlayer) {
      // Reduce health
      targetPlayer.health = Math.max(0, targetPlayer.health - 1);
      
      console.log(`Player ${data.targetId} health reduced to ${targetPlayer.health}`);
      
      // Broadcast the hit to all players
      io.emit('playerHit', {
        id: data.targetId,
        health: targetPlayer.health,
        bulletId: data.bulletId
      });
      
      // Check if player died
      if (targetPlayer.health <= 0) {
        // Reset health
        targetPlayer.health = 10;
        
        console.log(`Player ${data.targetId} died and respawned`);
        
        // Broadcast player death
        io.emit('playerDied', {
          id: data.targetId
        });
      }
    } else {
      console.log(`Target player ${data.targetId} not found`);
      
      // Try to find the player by iterating through all players
      // This is a fallback in case the player ID is not matching correctly
      const allPlayerIds = Object.keys(players);
      console.log('Available players:', allPlayerIds);
      
      if (allPlayerIds.length > 0) {
        console.log('Player IDs might not be matching correctly. Check client-side code.');
      }
    }
  });
  
  // Handle player state update (for collisions, etc.)
  socket.on('playerStateUpdate', (data) => {
    if (players[socket.id]) {
      players[socket.id].state = data.state;
      
      // Broadcast the state update to all other players
      socket.broadcast.emit('playerStateUpdated', {
        id: socket.id,
        state: data.state
      });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove player from players object
    delete players[socket.id];
    
    // Notify other players about the disconnection
    socket.broadcast.emit('playerDisconnected', { id: socket.id });
    
    // Log remaining players
    console.log('Remaining players:', Object.keys(players));
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 