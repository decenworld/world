const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Create the Express app
const app = express();
const server = http.createServer(app);

// Configure port for Railway compatibility
const PORT = process.env.PORT || 3000;

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the images directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// Setup CORS for cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Add a basic health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'ok', players: players.size });
});

// Store player information and their WebSocket connections
const players = new Map();
const INVULNERABILITY_DURATION = 5000; // 5 seconds invulnerability after respawn

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
                        ws: ws,
                        isInvulnerable: false,
                        invulnerableUntil: 0
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
                            state: player.state,
                            isInvulnerable: player.isInvulnerable
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
                            state: playerData.state,
                            isInvulnerable: playerData.isInvulnerable
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
                            state: player.state,
                            isInvulnerable: player.isInvulnerable
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
                    // Check if player is in invulnerability period
                    const shootingPlayer = players.get(playerId);
                    if (shootingPlayer && !shootingPlayer.isInvulnerable) {
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
                    }
                    break;
                
                case 'bulletHit':
                    const targetPlayer = players.get(data.data.targetId);
                    if (targetPlayer && !targetPlayer.isInvulnerable) {
                        // Reduce target player's health
                        targetPlayer.health = Math.max(0, targetPlayer.health - 1);
                        
                        // Broadcast hit to all players with current health
                        broadcastToAll({
                            type: 'playerHit',
                            data: {
                                id: data.data.targetId,
                                health: targetPlayer.health,
                                bulletId: data.data.bulletId,
                                shooterId: playerId
                            }
                        });
                        
                        // Handle player death if health is zero
                        if (targetPlayer.health <= 0) {
                            // Reset health to full
                            targetPlayer.health = 10;
                            
                            // Set player as invulnerable for 5 seconds
                            targetPlayer.isInvulnerable = true;
                            targetPlayer.invulnerableUntil = Date.now() + INVULNERABILITY_DURATION;
                            
                            // First send death event
                            broadcastToAll({
                                type: 'playerDied',
                                data: { 
                                    id: data.data.targetId,
                                    invulnerableDuration: INVULNERABILITY_DURATION
                                }
                            });
                            
                            // Then send health update to ensure health bar is updated
                            broadcastToAll({
                                type: 'playerHit',
                                data: {
                                    id: data.data.targetId,
                                    health: targetPlayer.health,
                                    bulletId: data.data.bulletId,
                                    shooterId: playerId,
                                    isInvulnerable: true
                                }
                            });
                            
                            // Set a timeout to remove invulnerability
                            setTimeout(() => {
                                // Make sure player still exists
                                if (players.has(data.data.targetId)) {
                                    const player = players.get(data.data.targetId);
                                    player.isInvulnerable = false;
                                    
                                    // Notify all clients that player is no longer invulnerable
                                    broadcastToAll({
                                        type: 'playerVulnerable',
                                        data: { 
                                            id: data.data.targetId
                                        }
                                    });
                                }
                            }, INVULNERABILITY_DURATION);
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
                
                case 'player_disconnect':
                    console.log('Received manual disconnect from player:', playerId);
                    
                    // Make sure the player exists in our players map before removing them
                    if (players.has(playerId)) {
                        // Remove player from players map
                        players.delete(playerId);
                        
                        // Notify other players
                        broadcast({
                            type: 'playerDisconnected',
                            data: { id: playerId }
                        }, ws);
                        
                        console.log(`Player ${playerId} has been manually disconnected. Current player count: ${players.size}`);
                    } else {
                        console.log(`Player ${playerId} was already removed or did not exist`);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
    
    // Handle WebSocket disconnection
    ws.on('close', () => {
        console.log('Player disconnected:', playerId);
        
        // Remove player from players map
        if (players.has(playerId)) {
            players.delete(playerId);
            
            // Notify other players about this disconnection
            broadcast({
                type: 'playerDisconnected',
                data: { id: playerId }
            }, ws);
        }
    });
});

// Helper function to broadcast message to all clients except the sender
function broadcast(message, senderWs) {
    const messageString = JSON.stringify(message);
    
    wss.clients.forEach((client) => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
}

// Helper function to broadcast to all clients including sender
function broadcastToAll(message) {
    const messageString = JSON.stringify(message);
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
}

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server ready at ws://localhost:${PORT}`);
}); 