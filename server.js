const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Create the Express app
const app = express();
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the images directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// Store player information and their WebSocket connections
const players = new Map();

// WebSocket connection handling
wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substr(2, 9);
    console.log('A user connected:', playerId);
    
    // Store the WebSocket connection
    ws.playerId = playerId;
  
  // Send the player their ID
    ws.send(JSON.stringify({
        type: 'playerID',
        data: { id: playerId }
    }));
    
    // Handle messages from clients
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'player_info':
    // Store player info
                    players.set(playerId, {
                        id: playerId,
                        username: data.data.username,
                        x: data.data.x || 400,
                        y: data.data.y || 300,
      health: 10,
      direction: 'down',
                        state: 'idle',
                        ws: ws
                    });
                    
                    // Send existing players to new player
                    const existingPlayers = Array.from(players.entries())
                        .filter(([id]) => id !== playerId)
                        .map(([_, player]) => ({
                            id: player.id,
                            username: player.username,
                            x: player.x,
                            y: player.y,
                            health: player.health,
                            direction: player.direction,
                            state: player.state
                        }));
                    
                    ws.send(JSON.stringify({
                        type: 'syncPlayers',
                        data: { players: existingPlayers }
                    }));
                    
                    // Broadcast new player to others
                    const playerData = players.get(playerId);
                    broadcast({
                        type: 'playerJoined',
                        data: {
                            id: playerData.id,
                            username: playerData.username,
                            x: playerData.x,
                            y: playerData.y,
                            health: playerData.health,
                            direction: playerData.direction,
                            state: playerData.state
                        }
                    }, ws);
                    break;
                
                case 'getAllPlayers':
                    const currentPlayers = Array.from(players.entries())
                        .filter(([id]) => id !== playerId)
                        .map(([_, player]) => ({
                            id: player.id,
                            username: player.username,
                            x: player.x,
                            y: player.y,
                            health: player.health,
                            direction: player.direction,
                            state: player.state
                        }));
                    
                    ws.send(JSON.stringify({
                        type: 'syncPlayers',
                        data: { players: currentPlayers }
                    }));
                    break;
                
                case 'playerMove':
                    const player = players.get(playerId);
                    if (player) {
                        player.x = data.data.x;
                        player.y = data.data.y;
                        player.direction = data.data.direction;
                        player.state = data.data.state;
                        
                        broadcastToAll({
                            type: 'playerMoved',
                            data: {
                                id: playerId,
                                x: data.data.x,
                                y: data.data.y,
                                direction: data.data.direction,
                                state: data.data.state
                            }
                        });
                    }
                    break;
                
                case 'playerShoot':
                    broadcast({
                        type: 'bulletCreated',
                        data: {
                            id: playerId,
                            x: data.data.x,
                            y: data.data.y,
                            direction: data.data.direction,
                            bulletId: data.data.bulletId
                        }
                    }, ws);
                    break;
                
                case 'bulletHit':
                    const targetPlayer = players.get(data.data.targetId);
    if (targetPlayer) {
      targetPlayer.health = Math.max(0, targetPlayer.health - 1);
      
                        broadcastToAll({
                            type: 'playerHit',
                            data: {
                                id: data.data.targetId,
        health: targetPlayer.health,
                                bulletId: data.data.bulletId
                            }
      });
      
      if (targetPlayer.health <= 0) {
        targetPlayer.health = 10;
                            broadcastToAll({
                                type: 'playerDied',
                                data: { id: data.data.targetId }
                            });
                        }
                    }
                    break;
                
                case 'playerStateUpdate':
                    const playerState = players.get(playerId);
                    if (playerState) {
                        playerState.state = data.data.state;
                        broadcast({
                            type: 'playerStateUpdated',
                            data: {
                                id: playerId,
                                state: data.data.state
                            }
                        }, ws);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
    }
  });
  
  // Handle disconnection
    ws.on('close', () => {
        console.log('User disconnected:', playerId);
        
        // Remove player from players map
        players.delete(playerId);
        
        // Notify other players
        broadcast({
            type: 'playerDisconnected',
            data: { id: playerId }
        }, ws);
  });
});

// Broadcast to all clients except sender
function broadcast(message, sender) {
    wss.clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Broadcast to all clients including sender
function broadcastToAll(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 