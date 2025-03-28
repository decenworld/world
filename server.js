const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fetch = require('node-fetch');

// Create the Express app
const app = express();
const server = http.createServer(app);

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// Configure port for Railway compatibility
const PORT = process.env.PORT || 3000;

// Get Cloudflare Turnstile Secret Key from env - handle possible malformed value
let TURNSTILE_SECRET_KEY = '';
try {
  // First, try to get the raw environment variable
  const rawSecretKey = process.env.TURNSTILE_SECRET_KEY || '';
  
  // Clean up the value in case it has strange formatting
  TURNSTILE_SECRET_KEY = rawSecretKey.trim()
    .replace(/^=+/, '')  // Remove leading equals signs
    .replace(/=+$/, '')  // Remove trailing equals signs
    .replace(/^["']+/, '') // Remove leading quotes
    .replace(/["']+$/, ''); // Remove trailing quotes
  
  // If still empty and in development, use a testing key
  if (!TURNSTILE_SECRET_KEY && isDevelopment) {
    TURNSTILE_SECRET_KEY = 'testing_mock_secret_key_for_development_only';
  }
} catch (e) {
  console.error('Error parsing TURNSTILE_SECRET_KEY:', e);
  if (isDevelopment) {
    TURNSTILE_SECRET_KEY = 'testing_mock_secret_key_for_development_only';
  }
}

// Log environment settings at startup
console.log(`Environment: ${isDevelopment ? 'Development' : 'Production'}`);
if (isDevelopment && !process.env.TURNSTILE_SECRET_KEY) {
  console.log('Using development mode mock secret key for Turnstile');
}

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

// Parse JSON and URL-encoded form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add a basic health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'ok', players: players.size });
});

// Endpoint to verify Cloudflare Turnstile
app.post('/verify-turnstile', async (req, res) => {
  try {
    console.log('Received verify-turnstile request:', req.body);
    const { token } = req.body;
    
    if (!token) {
      console.log('Token is missing in request');
      return res.status(400).json({ success: false, message: 'Token is missing' });
    }
    
    // Development mode bypass for testing
    if (isDevelopment && TURNSTILE_SECRET_KEY === 'testing_mock_secret_key_for_development_only') {
      console.log('DEVELOPMENT MODE: Bypassing Turnstile verification');
      return res.json({ 
        success: true, 
        message: 'Development mode: verification bypassed' 
      });
    }
    
    // Check for secret key
    if (!TURNSTILE_SECRET_KEY) {
      console.error('TURNSTILE_SECRET_KEY is not properly set in environment variables');
      // Instead of returning 500, return a more specific error
      return res.status(400).json({ 
        success: false, 
        message: 'Server configuration error: TURNSTILE_SECRET_KEY is not set or is malformed',
        errors: ['missing-input-secret']
      });
    }
    
    // Add client IP (Cloudflare may use this for additional verification)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`Client IP for verification: ${ip}`);
    
    // Create form data for Cloudflare verification
    const formData = new URLSearchParams();
    formData.append('secret', TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    
    // Only add IP if it's available and valid
    if (ip && ip !== '::1' && !ip.includes('127.0.0.1')) {
      formData.append('remoteip', ip);
    }
    
    console.log('Sending verification request to Cloudflare');
    console.log(`Using secret key of length: ${TURNSTILE_SECRET_KEY.length} characters`);
    
    // More complete error handling for the fetch request
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        // Add timeout to prevent hanging requests
        timeout: 5000
      });
      
      if (!response.ok) {
        console.error(`Cloudflare responded with status: ${response.status}`);
        return res.status(400).json({ 
          success: false, 
          message: `Cloudflare verification failed with status: ${response.status}`,
          errors: ['verification-failed']
        });
      }
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('Error parsing Cloudflare response:', jsonError);
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid response from Cloudflare', 
          errors: ['invalid-response']
        });
      }
      
      console.log('Cloudflare verification response:', data);
      
      if (data.success) {
        console.log('Captcha verification successful');
        return res.json({ success: true });
      } else {
        console.error('Captcha verification failed:', data['error-codes']);
        return res.status(400).json({ 
          success: false, 
          message: 'Captcha verification failed', 
          errors: data['error-codes'] || ['unknown-error']
        });
      }
    } catch (fetchError) {
      console.error('Error fetching from Cloudflare:', fetchError);
      return res.status(400).json({ 
        success: false, 
        message: 'Error contacting Cloudflare: ' + fetchError.message,
        errors: ['network-error'] 
      });
    }
  } catch (error) {
    console.error('Error verifying turnstile:', error.message, error.stack);
    return res.status(400).json({ 
      success: false, 
      message: 'Server error: ' + error.message,
      errors: ['server-error']
    });
  }
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
    console.log(`Server is running on port ${PORT}`);
    console.log(`WebSocket server ready at ws://localhost:${PORT}`);
    
    // Log Turnstile configuration
    console.log('=== TURNSTILE CONFIGURATION ===');
    if (TURNSTILE_SECRET_KEY === 'testing_mock_secret_key_for_development_only') {
      console.log('Running in development mode with mock secret key');
      console.log('Captcha verification will be bypassed for testing purposes');
    } else if (!TURNSTILE_SECRET_KEY) {
      console.warn('WARNING: TURNSTILE_SECRET_KEY is not properly set');
      console.warn('Environment variable value:', process.env.TURNSTILE_SECRET_KEY);
      console.warn('Parsed value:', TURNSTILE_SECRET_KEY);
      if (isDevelopment) {
        console.log('Running in development mode, but verification will likely fail');
      } else {
        console.warn('In production mode: Cloudflare Turnstile verification will fail');
      }
      console.warn('Please set the TURNSTILE_SECRET_KEY environment variable correctly in your Railway environment variables.');
      console.log('Format should be: TURNSTILE_SECRET_KEY=your_secret_key_here');
    } else {
      console.log('Cloudflare Turnstile is configured and ready');
      console.log(`Secret key length: ${TURNSTILE_SECRET_KEY.length} characters`);
    }
    
    console.log('======================================');
    console.log('Access the test page at: http://localhost:' + PORT + '/turnstile-test.html');
    console.log('======================================');
}); 