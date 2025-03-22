/**
 * Character Movement Game
 * A game where you can move a character around with mouse clicks on a map
 */

// Global variables and state
var playerUsername = ''; // Using var instead of let to avoid temporal dead zone issues
let isMobile = !window.matchMedia('(min-width: 768px)').matches;
let socket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 3000;
let reconnectTimeout = null;
let isSocketInitialized = false;
let connectionStatus = null;
let player = null;
let playerText = null;
let playerHealth = 10;
let playerHealthBar = null;
let map = null;
let targetPosition = null;
let cursors = null;
let otherPlayers = {};
let playerDirection = 'down';
let playerState = 'idle';
let playerID = null;
let playerCreated = false;
let mobileControls = { left: null, right: null };
let joystick = null;
let shootButton = null;
let lastUpdateTime = 0;
let lastNetworkUpdateTime = 0;
let networkUpdateThrottleMs = 50;
let updateThrottleMs = 50; // Add missing updateThrottleMs variable
let lastMemoryCleanupTime = 0;
let bullets = null;
let lastFired = 0;
let fireDelay = 500;
let bulletSpeed = 3000;
let obstacles = null;
let isEditorMode = false;
let editorGraphics = null;
let currentObstacle = null;
let obstacleStartPoint = null;
const SPEED = 150;
const memoryCleanupIntervalMs = 30000;

// Add window unload handler to properly disconnect WebSocket when page is refreshed or closed
window.addEventListener('beforeunload', () => {
    // Disconnect WebSocket
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log('Page unloading, closing WebSocket connection for player:', playerID);
        // Send a disconnect message to the server
        sendWebSocketMessage('player_disconnect', { id: playerID });
        // Close the socket connection
        socket.close();
    }
});

// Add visibility change handler to handle tab switching
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // User switched away from the page (tab change, minimizing, etc.)
        console.log('Page hidden, marking player as inactive:', playerID);
        // Only send if we have an active connection
        if (socket && socket.readyState === WebSocket.OPEN && playerID) {
            sendWebSocketMessage('playerStateUpdate', { state: 'inactive' });
        }
    } else if (document.visibilityState === 'visible') {
        // User returned to the page
        console.log('Page visible again, verifying connection for player:', playerID);
        // If socket is not in OPEN state, reconnect
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.log('Connection lost while page was hidden, reconnecting...');
            connectWebSocket();
        } else if (playerID) {
            // Otherwise, just update our state to active
            sendWebSocketMessage('playerStateUpdate', { state: 'idle' });
            // Force a position update to ensure sync
            if (player) {
                sendWebSocketMessage('playerMove', {
                    id: playerID,
                    x: player.x,
                    y: player.y,
                    direction: playerDirection,
                    state: 'idle'
                });
            }
        }
    }
});

/**
 * Update connection status display
 * @param {string} status - The status message to display
 * @param {string} color - The color to use for the status background
 */
function updateConnectionStatus(status, color) {
    if (connectionStatus) {
        connectionStatus.textContent = `WebSocket: ${status}`;
        connectionStatus.style.backgroundColor = color;
        connectionStatus.style.color = '#fff';
    }
}

/**
 * Send a message via WebSocket
 * @param {string} type - The message type
 * @param {Object} data - The message data
 */
function sendWebSocketMessage(type, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, data }));
    } else {
        console.warn('Cannot send message, WebSocket is not open:', type, data);
    }
}

/**
 * Update health bar graphics
 * @param {Phaser.GameObjects.Graphics} graphics - The graphics object
 * @param {number} x - The x position
 * @param {number} y - The y position
 * @param {number} health - The health value (0-10)
 */
function updateHealthBar(graphics, x, y, health) {
    if (!graphics || !graphics.active) {
        return;
    }
    
    // Clear previous graphics
    graphics.clear();
    
    // Draw background
    graphics.fillStyle(0x000000, 0.8);
    graphics.fillRect(x - 25, y - 5, 50, 10);
    
    // Calculate health percentage
    const healthPercent = Math.max(0, Math.min(1, health / 10));
    
    // Choose color based on health
    let color;
    if (healthPercent > 0.6) {
        color = 0x00ff00; // Green
    } else if (healthPercent > 0.3) {
        color = 0xffff00; // Yellow
    } else {
        color = 0xff0000; // Red
    }
    
    // Draw health bar
    graphics.fillStyle(color, 1);
    graphics.fillRect(x - 25, y - 5, 50 * healthPercent, 10);
    
    // Ensure the healthbar has high depth to be visible
    graphics.setDepth(999);
}

/**
 * Update other player's texture based on direction and state
 * @param {Object} otherPlayer - The other player object
 */
function updateOtherPlayerTexture(otherPlayer) {
    try {
        let animKey = '';
        
        // Log the current state
        console.log(`Updating texture for player ${otherPlayer.id}:`, {
            direction: otherPlayer.direction,
            state: otherPlayer.state,
            currentAnim: otherPlayer.sprite.anims.currentAnim ? otherPlayer.sprite.anims.currentAnim.key : 'none'
        });
        
        if (otherPlayer.state === 'idle') {
            // Map idle directions to corresponding animations
            switch (otherPlayer.direction) {
                case 'up':
                    animKey = 'idle_back';
                    break;
                case 'down':
                    animKey = 'idle_front';
                    break;
                case 'left':
                    animKey = 'idle_left';
                    break;
                case 'right':
                    animKey = 'idle_right';
                    break;
                case 'left_up':
                    animKey = 'idle_leftback';
                    break;
                case 'left_down':
                    animKey = 'idle_leftfront';
                    break;
                case 'right_up':
                    animKey = 'idle_rightback';
                    break;
                case 'right_down':
                    animKey = 'idle_rightfront';
                    break;
                default:
                    animKey = 'idle_front';
            }
        } else { // otherPlayer.state === 'run' or anything else, default to run animations
            // Map run directions to corresponding animations
            switch (otherPlayer.direction) {
                case 'up':
                    animKey = 'run_up';
                    break;
                case 'down':
                    animKey = 'run_down';
                    break;
                case 'left':
                    animKey = 'run_left';
                    break;
                case 'right':
                    animKey = 'run_right';
                    break;
                case 'left_up':
                    animKey = 'run_leftup';
                    break;
                case 'left_down':
                    animKey = 'run_leftdown';
                    break;
                case 'right_up':
                    animKey = 'run_rightup';
                    break;
                case 'right_down':
                    animKey = 'run_rightdown';
                    break;
                default:
                    animKey = 'run_down';
            }
        }
        
        // Log the animation we're trying to play
        console.log(`Attempting to play animation '${animKey}' for player ${otherPlayer.id}`);
        
        // Check if the animation exists in the scene
        if (!otherPlayer.sprite.scene.anims.exists(animKey)) {
            console.warn(`Animation '${animKey}' doesn't exist in the scene for player ${otherPlayer.id}`);
            console.log('Available animations:', Object.keys(otherPlayer.sprite.scene.anims.anims.entries));
        }
        
        // Only change animation if it's different from current
        if (otherPlayer.sprite.anims.currentAnim === null || otherPlayer.sprite.anims.currentAnim.key !== animKey) {
            // Check if animation exists before trying to play it
            if (otherPlayer.sprite.scene.anims.exists(animKey)) {
                console.log(`Playing animation '${animKey}' for player ${otherPlayer.id}`);
                otherPlayer.sprite.play(animKey, true);
            } else {
                console.warn(`Animation '${animKey}' doesn't exist for player ${otherPlayer.id}. Fallback to static texture.`);
                
                // Fallback to a static texture
                const textureKey = otherPlayer.state === 'idle' ? 'player_idle_front' : 'player_run_down';
                if (otherPlayer.sprite.scene.textures.exists(textureKey)) {
                    console.log(`Using fallback texture '${textureKey}' for player ${otherPlayer.id}`);
                    otherPlayer.sprite.setTexture(textureKey, 0);
                } else {
                    console.warn(`Fallback texture '${textureKey}' doesn't exist for player ${otherPlayer.id}. Using character_fallback.`);
                    otherPlayer.sprite.setTexture('character_fallback');
                }
            }
        }
    } catch (error) {
        console.error('Error in updateOtherPlayerTexture:', error);
    }
}

/**
 * Update bullet collision detection for a player
 * @param {Phaser.Scene} scene - The current scene
 * @param {Object} otherPlayer - The other player object
 */
function updateBulletCollisionForPlayer(scene, otherPlayer) {
    try {
        if (!scene || !scene.physics || !otherPlayer || !otherPlayer.sprite || !bullets) {
            console.error('Invalid parameters for updateBulletCollisionForPlayer:', { scene, otherPlayer, bullets });
            return;
        }
        
        console.log('Updating bullet collision for player:', otherPlayer.id);
        
        // Create a single collider for all bullets with this player if it doesn't exist
        if (!otherPlayer.bulletCollider) {
            otherPlayer.bulletCollider = scene.physics.add.overlap(bullets, otherPlayer.sprite, (sprite, bullet) => {
                // Only process if this bullet is from the local player
                if (bullet.active && bullet.shooterId === playerID) {
                    console.log('Bullet hit other player:', otherPlayer.id, bullet.bulletId);
                    
                    // Emit bullet hit event with health information
                    sendWebSocketMessage('bulletHit', {
                        targetId: otherPlayer.id,
                        bulletId: bullet.bulletId,
                        health: (otherPlayer.health || 10) - 1 // Send current health - 1
                    });
                    
                    // Client-side immediate feedback - update health locally
                    // This will be overridden by server response but gives immediate feedback
                    otherPlayer.health = Math.max(0, (otherPlayer.health || 10) - 1);
                    if (otherPlayer.healthBar) {
                        updateHealthBar(otherPlayer.healthBar, otherPlayer.sprite.x, otherPlayer.sprite.y - 30, otherPlayer.health);
                    }
                    
                    // Create blood splatter effect
                    const blood = scene.add.circle(bullet.x, bullet.y, 8, 0xbb0000, 0.8);
                    blood.setDepth(101);
                    
                    // Fade out and destroy the blood
                    scene.tweens.add({
                        targets: blood,
                        alpha: 0,
                        scale: 3,
                        duration: 300,
                        onComplete: () => {
                            blood.destroy();
                        }
                    });
                    
                    // Flash player red to indicate damage
                    sprite.setTint(0xff0000);
                    scene.time.delayedCall(200, () => {
                        if (sprite.active) {
                            sprite.clearTint();
                        }
                    });
                    
                    // Disable the bullet
                    disableBullet(bullet);
                }
            });
        }
    } catch (error) {
        console.error('Error in updateBulletCollisionForPlayer:', error);
    }
}

/**
 * Update information for another player
 * @param {Object} otherPlayer - The other player object to update
 * @param {Object} data - The updated data
 */
function updateOtherPlayer(otherPlayer, data) {
    try {
        if (!otherPlayer || !otherPlayer.sprite) {
            console.error('Invalid otherPlayer object in updateOtherPlayer:', otherPlayer);
            return;
        }
        
        // Update position
        if (data.x !== undefined && data.y !== undefined) {
            otherPlayer.x = data.x;
            otherPlayer.y = data.y;
            otherPlayer.sprite.x = data.x;
            otherPlayer.sprite.y = data.y;
        }
        
        // Update direction and state
        if (data.direction) {
            otherPlayer.direction = data.direction;
        }
        
        if (data.state) {
            otherPlayer.state = data.state;
        }
        
        // Update health
        if (data.health !== undefined) {
            otherPlayer.health = data.health;
            if (otherPlayer.healthBar) {
                updateHealthBar(otherPlayer.healthBar, otherPlayer.x, otherPlayer.y - 30, otherPlayer.health);
            }
        }
        
        // Update username if provided
        if (data.username && otherPlayer.usernameText) {
            otherPlayer.username = data.username;
            otherPlayer.usernameText.setText(data.username);
        }
        
        // Update position of username text and health bar
        if (otherPlayer.usernameText) {
            otherPlayer.usernameText.setPosition(otherPlayer.x, otherPlayer.y - 20);
        }
        
        // Update texture based on direction
        updateOtherPlayerTexture(otherPlayer);
    } catch (error) {
        console.error('Error in updateOtherPlayer:', error);
    }
}

/**
 * Clean up a player and all associated resources
 * @param {Object} playerObj - The player object to clean up
 */
function cleanupPlayer(playerObj) {
    try {
        if (!playerObj) {
            console.error('Attempted to clean up invalid player object:', playerObj);
            return;
        }
        
        console.log('Cleaning up player:', playerObj.id);
        
        // Destroy sprite
        if (playerObj.sprite && playerObj.sprite.destroy) {
            playerObj.sprite.destroy();
        }
        
        // Destroy username text
        if (playerObj.usernameText && playerObj.usernameText.destroy) {
            playerObj.usernameText.destroy();
        }
        
        // Destroy health bar
        if (playerObj.healthBar && playerObj.healthBar.destroy) {
            playerObj.healthBar.destroy();
        }
        
        // Remove bullet collider
        if (playerObj.bulletCollider && playerObj.bulletCollider.destroy) {
            playerObj.bulletCollider.destroy();
        }
        
        console.log('Successfully cleaned up player:', playerObj.id);
    } catch (error) {
        console.error('Error cleaning up player:', error);
    }
}

/**
 * Handle player hit event
 * @param {Object} data - The hit data
 */
function handlePlayerHit(data) {
    try {
        // Get the current scene from the game instance
        let currentScene = null;
        if (window.game && window.game.scene && window.game.scene.scenes) {
            currentScene = window.game.scene.scenes[0]; // Get the first scene
        }
        
        if (data.id === playerID) {
            // Local player was hit
            playerHealth = Math.max(0, data.health);
            if (playerHealthBar && player) {
                updateHealthBar(playerHealthBar, player.x, player.y - 30, playerHealth);
                playerHealthBar.setDepth(999); // Ensure high depth
            }
            
            // Flash player red to indicate damage
            if (player) {
                player.setTint(0xff0000);
                setTimeout(() => {
                    if (player.active) {
                        player.clearTint();
                    }
                }, 200);
            }
            
            // Create blood effect if we have a scene
            if (currentScene) {
                const blood = currentScene.add.circle(player.x, player.y, 8, 0xbb0000, 0.8);
                blood.setDepth(101);
                
                // Animate blood effect
                currentScene.tweens.add({
                    targets: blood,
                    alpha: 0,
                    scale: 3,
                    duration: 300,
                    onComplete: () => blood.destroy()
                });
                
                // Add damage text
                const damageText = currentScene.add.text(player.x, player.y - 40, '-1', {
                    font: '16px Arial',
                    fill: '#ff0000',
                    stroke: '#000000',
                    strokeThickness: 3
                }).setOrigin(0.5);
                
                // Animate damage text
                currentScene.tweens.add({
                    targets: damageText,
                    y: damageText.y - 30,
                    alpha: 0,
                    duration: 800,
                    onComplete: () => damageText.destroy()
                });
            }
            
            if (playerHealth <= 0 && player) {
                // Player died
                player.setTint(0xff0000);
                setTimeout(() => {
                    playerHealth = 10;
                    if (playerHealthBar && player) {
                        updateHealthBar(playerHealthBar, player.x, player.y - 30, playerHealth);
                    }
                    player.clearTint();
                    player.setPosition(Math.random() * 800, Math.random() * 600);
                }, 2000);
            }
        } else if (data.id && otherPlayers[data.id]) {
            // Other player was hit
            const otherPlayer = otherPlayers[data.id];
            otherPlayer.health = Math.max(0, data.health);
            
            // Make sure we use the sprite position for the health bar
            if (otherPlayer.healthBar && otherPlayer.sprite) {
                updateHealthBar(otherPlayer.healthBar, otherPlayer.sprite.x, otherPlayer.sprite.y - 30, otherPlayer.health);
                otherPlayer.healthBar.setDepth(999); // Ensure high depth
            }
            
            // Flash the player red
            if (otherPlayer.sprite) {
                otherPlayer.sprite.setTint(0xff0000);
                setTimeout(() => {
                    if (otherPlayer.sprite && otherPlayer.sprite.active) {
                        otherPlayer.sprite.clearTint();
                    }
                }, 200);
            }
            
            // Create blood effect if we have a scene
            if (currentScene && otherPlayer.sprite) {
                const blood = currentScene.add.circle(otherPlayer.sprite.x, otherPlayer.sprite.y, 8, 0xbb0000, 0.8);
                blood.setDepth(101);
                
                // Animate blood effect
                currentScene.tweens.add({
                    targets: blood,
                    alpha: 0,
                    scale: 3,
                    duration: 300,
                    onComplete: () => blood.destroy()
                });
                
                // Add damage text
                const damageText = currentScene.add.text(otherPlayer.sprite.x, otherPlayer.sprite.y - 40, '-1', {
                    font: '16px Arial',
                    fill: '#ff0000',
                    stroke: '#000000',
                    strokeThickness: 3
                }).setOrigin(0.5);
                
                // Animate damage text
                currentScene.tweens.add({
                    targets: damageText,
                    y: damageText.y - 30,
                    alpha: 0,
                    duration: 800,
                    onComplete: () => damageText.destroy()
                });
            }
            
            if (otherPlayer.health <= 0 && otherPlayer.sprite) {
                otherPlayer.sprite.setTint(0xff0000);
                setTimeout(() => {
                    otherPlayer.health = 10;
                    if (otherPlayer.healthBar && otherPlayer.sprite) {
                        updateHealthBar(otherPlayer.healthBar, otherPlayer.sprite.x, otherPlayer.sprite.y - 30, otherPlayer.health);
                    }
                    otherPlayer.sprite.clearTint();
                }, 2000);
            }
        }
    } catch (error) {
        console.error('Error in handlePlayerHit:', error);
    }
}

/**
 * Disable a bullet - called when bullet hits something
 * @param {Phaser.GameObjects.Sprite} bullet - The bullet to disable
 */
function disableBullet(bullet) {
    if (bullet && bullet.active) {
        bullet.setActive(false);
        bullet.setVisible(false);
        bullet.body.enable = false;
    }
}

/**
 * Create another player
 * @param {Phaser.Scene} scene - The current scene
 * @param {Object} data - The player data
 */
function createOtherPlayer(scene, data) {
    try {
        // Skip if the scene is not valid
        if (!scene || !scene.physics) {
            console.error('Invalid scene for createOtherPlayer:', scene);
            return;
        }
        
        // Skip if the player already exists
        if (otherPlayers[data.id]) {
            console.log('Player already exists, updating instead:', data.id);
            updateOtherPlayer(otherPlayers[data.id], data);
            return;
        }
        
        // Skip if this is our own player
        if (data.id === playerID) {
            console.log('Skipping creation of our own player:', data.id);
            return;
        }
        
        console.log('Creating other player:', data.id, data);
        
        // Make sure all animations are created first
        if (!scene.anims.exists('run_left')) {
            console.log('Creating animations for players');
            createPlayerAnimations(scene);
            
            // Verify animations were created
            const animKeys = ['run_left', 'run_right', 'run_up', 'run_down', 'run_leftup', 'run_leftdown', 'run_rightup', 'run_rightdown',
                            'idle_front', 'idle_back', 'idle_left', 'idle_right'];
            const missingAnims = animKeys.filter(key => !scene.anims.exists(key));
            if (missingAnims.length > 0) {
                console.error('Failed to create some animations:', missingAnims);
            } else {
                console.log('All animations created successfully');
            }
        }
        
        // Create a container for this player's objects
        otherPlayers[data.id] = {
            id: data.id,
            username: data.username || 'Player',
            direction: data.direction || 'down',
            state: data.state || 'idle',
            health: data.health || 10,
            x: data.x || 400,
            y: data.y || 300
        };
        
        // Create the player sprite with animation
        otherPlayers[data.id].sprite = scene.physics.add.sprite(data.x, data.y, 'player_idle_front', 0);
        
        // If the texture failed to load, use the fallback
        if (!otherPlayers[data.id].sprite.texture.key || otherPlayers[data.id].sprite.texture.key === '__MISSING') {
            console.warn(`Texture 'player_idle_front' failed to load for player ${data.id}, using fallback`);
            otherPlayers[data.id].sprite.setTexture('character_fallback');
        }
        
        // Set player properties
        otherPlayers[data.id].sprite.id = data.id;
        otherPlayers[data.id].sprite.setScale(2.1);
        otherPlayers[data.id].sprite.setTint(0xff0000); // Tint other players red to distinguish them
        
        // Force visibility
        otherPlayers[data.id].sprite.setVisible(true);
        otherPlayers[data.id].sprite.setActive(true);
        
        // Add username text above player
        otherPlayers[data.id].usernameText = scene.add.text(data.x, data.y - 20, data.username || 'Player', {
            font: '14px Arial',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
            align: 'center'
        }).setOrigin(0.5);
        
        // Add health bar
        otherPlayers[data.id].healthBar = scene.add.graphics();
        otherPlayers[data.id].healthBar.setDepth(999); // Set high depth
        updateHealthBar(otherPlayers[data.id].healthBar, data.x, data.y - 30, otherPlayers[data.id].health);
        
        // Add collision with obstacles
        if (obstacles) {
            scene.physics.add.collider(otherPlayers[data.id].sprite, obstacles);
        }
        
        // Add collision with bullets
        updateBulletCollisionForPlayer(scene, otherPlayers[data.id]);
        
        // Update texture based on direction
        updateOtherPlayerTexture(otherPlayers[data.id]);
        
        // Request player info if username is not provided
        if (!data.username) {
            socket.emit('request_player_info', { id: data.id });
        }
        
        console.log('Successfully created other player:', data.id);
        return otherPlayers[data.id];
    } catch (error) {
        console.error('Error creating other player:', error);
        return null;
    }
}

/**
 * Handle WebSocket messages
 * @param {Object} message - The message received from the WebSocket server
 */
function handleWebSocketMessage(message) {
    try {
        console.log('Received message:', message);
        
        if (!message || !message.type) {
            console.error('Invalid message format:', message);
            return;
        }
        
        // Get the current scene from the game instance
        let currentScene = null;
        if (window.game && window.game.scene && window.game.scene.scenes) {
            currentScene = window.game.scene.scenes[0]; // Get the first scene, assuming it's our main scene
        }
        
        if (!currentScene) {
            console.error('No valid scene found for handling message:', message);
            return;
        }
        
        switch (message.type) {
            case 'playerID':
                playerID = message.data.id;
                console.log('Received player ID:', playerID);
                
                // Send player info
                if (player) {
                    sendWebSocketMessage('player_info', {
                        id: playerID,
                        username: playerUsername,
                        x: player.x,
                        y: player.y
                    });
                }
                break;
                
            case 'syncPlayers':
                console.log('Received player sync:', message.data);
                if (message.data.players && Array.isArray(message.data.players)) {
                    message.data.players.forEach(playerData => {
                        if (playerData.id && playerData.id !== playerID && !otherPlayers[playerData.id]) {
                            console.log('Creating other player from sync:', playerData);
                            createOtherPlayer(currentScene, playerData);
                        }
                    });
                }
                break;
                
            case 'playerJoined':
            case 'player_joined':
                console.log('Player joined:', message.data);
                if (message.data.id && message.data.id !== playerID) {
                    createOtherPlayer(currentScene, message.data);
                }
                break;
                
            case 'playerLeft':
            case 'player_left':
                console.log('Player left:', message.data);
                if (message.data.id && otherPlayers[message.data.id]) {
                    cleanupPlayer(otherPlayers[message.data.id]);
                    delete otherPlayers[message.data.id];
                }
                break;
                
            case 'playerDisconnected':
                console.log('Player disconnected:', message.data);
                if (message.data.id && otherPlayers[message.data.id]) {
                    cleanupPlayer(otherPlayers[message.data.id]);
                    delete otherPlayers[message.data.id];
                }
                break;
                
            case 'playerMoved':
            case 'player_moved':
                if (message.data.id && message.data.id !== playerID) {
                    if (otherPlayers[message.data.id]) {
                        updateOtherPlayer(otherPlayers[message.data.id], message.data);
                    } else {
                        console.log('Creating player from movement data:', message.data);
                        createOtherPlayer(currentScene, message.data);
                    }
                }
                break;
                
            case 'playerStateUpdated':
                if (message.data.id && message.data.id !== playerID && otherPlayers[message.data.id]) {
                    otherPlayers[message.data.id].state = message.data.state;
                    updateOtherPlayerTexture(otherPlayers[message.data.id]);
                }
                break;
                
            case 'bulletFired':
            case 'bullet_fired':
                if (message.data.shooterId && message.data.shooterId !== playerID) {
                    createBullet(currentScene, message.data.x, message.data.y, message.data.direction, message.data.shooterId, message.data.bulletId);
                }
                break;
                
            case 'playerHit':
            case 'player_hit':
                handlePlayerHit(message.data);
                break;
                
            default:
                console.log('Unknown message type:', message.type);
        }
    } catch (error) {
        console.error('Error in handleWebSocketMessage:', error, message);
    }
}

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    const storedUsername = localStorage.getItem('username');
    
    // If not logged in, show login screen
    if (!storedUsername) {
        showLoginScreen();
        return;
    }
    
    // Set the username and start the game
    playerUsername = storedUsername;
    startGame(storedUsername);
});

/**
 * Initialize and connect WebSocket
 */
function connectWebSocket() {
    if (socket) {
        // If a socket exists, make sure to close it cleanly before creating a new one
        if (socket.readyState === WebSocket.OPEN) {
            // If we have a player ID, send a disconnect message before closing
            if (playerID) {
                sendWebSocketMessage('player_disconnect', { id: playerID });
            }
        }
        socket.close();
        socket = null;
    }

    // Clear existing players on reconnect to prevent duplicates
    Object.keys(otherPlayers).forEach(id => {
        if (otherPlayers[id]) {
            cleanupPlayer(otherPlayers[id]);
            delete otherPlayers[id];
        }
    });

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = window.location.hostname === 'localhost'
        ? `ws://localhost:3000/.netlify/functions/websocket`
        : `${wsProtocol}//${window.location.host}/.netlify/functions/websocket`;

    console.log('Attempting WebSocket connection to:', wsUrl);
    updateConnectionStatus('Connecting...', '#FF9800');

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connected successfully');
        updateConnectionStatus('Connected', '#4CAF50');
        reconnectAttempts = 0;
        isSocketInitialized = true;

        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }

        // Reset player ID on new connection to ensure we get a fresh one
        playerID = null;

        // The server will send us a new player ID, then we'll send our player info
    };

    socket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        updateConnectionStatus('Disconnected', '#f44336');
        isSocketInitialized = false;
        socket = null;

        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            updateConnectionStatus(`Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`, '#FF9800');

            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }

            reconnectTimeout = setTimeout(() => {
                console.log(`Attempting reconnection ${reconnectAttempts}/${maxReconnectAttempts}`);
                connectWebSocket();
            }, reconnectDelay);
        } else {
            updateConnectionStatus('Failed to connect - Please refresh', '#f44336');
        }
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('Error', '#f44336');
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (typeof handleWebSocketMessage === 'function') {
                handleWebSocketMessage(message);
            } else {
                console.error('Error: handleWebSocketMessage function is not defined');
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
}

/**
 * Show the login screen
 */
function showLoginScreen() {
    // Create login container
    const loginContainer = document.createElement('div');
    loginContainer.id = 'login-container';
    loginContainer.style.position = 'absolute';
    loginContainer.style.top = '0';
    loginContainer.style.left = '0';
    loginContainer.style.width = '100%';
    loginContainer.style.height = '100%';
    loginContainer.style.display = 'flex';
    loginContainer.style.justifyContent = 'center';
    loginContainer.style.alignItems = 'center';
    loginContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    loginContainer.style.zIndex = '2000';
    
    // Create login form
    const loginForm = document.createElement('div');
    loginForm.style.backgroundColor = '#fff';
    loginForm.style.padding = '20px';
    loginForm.style.borderRadius = '10px';
    loginForm.style.textAlign = 'center';
    loginForm.style.maxWidth = '400px';
    loginForm.style.width = '80%';
    
    // Create title
    const title = document.createElement('h2');
    title.textContent = 'Enter Your Username';
    title.style.marginBottom = '20px';
    
    // Create input field
    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.placeholder = 'Username';
    usernameInput.style.width = '100%';
    usernameInput.style.padding = '10px';
    usernameInput.style.marginBottom = '20px';
    usernameInput.style.boxSizing = 'border-box';
    usernameInput.style.border = '1px solid #ccc';
    usernameInput.style.borderRadius = '5px';
    
    // Create login button
    const loginButton = document.createElement('button');
    loginButton.textContent = 'Start Game';
    loginButton.style.padding = '10px 20px';
    loginButton.style.backgroundColor = '#4CAF50';
    loginButton.style.color = 'white';
    loginButton.style.border = 'none';
    loginButton.style.borderRadius = '5px';
    loginButton.style.cursor = 'pointer';
    
    // Add click event to login button
    loginButton.addEventListener('click', () => {
        const username = usernameInput.value.trim();
        if (username) {
            // Save username to localStorage
            localStorage.setItem('username', username);
            
            // Remove login container
            document.body.removeChild(loginContainer);
            
            // Start the game
            startGame(username);
        } else {
            alert('Please enter a username');
        }
    });
    
    // Add keypress event to input field
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loginButton.click();
        }
    });
    
    // Add elements to form
    loginForm.appendChild(title);
    loginForm.appendChild(usernameInput);
    loginForm.appendChild(loginButton);
    
    // Add form to container
    loginContainer.appendChild(loginForm);
    
    // Add container to document
    document.body.appendChild(loginContainer);
    
    // Focus on input field
    usernameInput.focus();
}

/**
 * Start the game with the given username
 * @param {string} username - The player's username
 */
function startGame(username) {
    // Make sure username is defined
    if (!username) {
        username = 'Player' + Math.floor(Math.random() * 1000);
    }
    
    // Store the username
    playerUsername = username;

    // Create connection status element if it doesn't exist
    if (!connectionStatus) {
        connectionStatus = document.createElement('div');
        connectionStatus.id = 'connection-status';
        connectionStatus.style.position = 'fixed';
        connectionStatus.style.top = '10px';
        connectionStatus.style.left = '10px';
        connectionStatus.style.padding = '5px 10px';
        connectionStatus.style.borderRadius = '5px';
        connectionStatus.style.fontSize = '12px';
        connectionStatus.style.zIndex = '9999';
        document.body.appendChild(connectionStatus);
    }

    // Initialize WebSocket connection
    connectWebSocket();

    // Game configuration
    const config = {
        type: Phaser.AUTO,
        parent: 'game-container',
        width: window.innerWidth,
        height: window.innerHeight,
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { y: 0 },
                debug: false
            }
        },
        scene: {
            preload: preload,
            create: create,
            update: update
        },
        render: {
            pixelArt: true,
            antialias: false,
            antialiasGL: false
        },
        audio: {
            disableWebAudio: true,
            noAudio: true
        }
    };

    // Create a new Phaser game instance and store it globally
    window.game = new Phaser.Game(config);
    
    // Initialize game variables - use the global variables instead of redeclaring
        player = null;
        playerText = null;
    playerHealth = 10;
        playerHealthBar = null;
        map = null;
        targetPosition = null;
        cursors = null;
        otherPlayers = {};
    playerDirection = 'down';
    playerState = 'idle';
    playerID = null;
    playerCreated = false;
    
    // Mobile controls
    mobileControls = { left: null, right: null };
    joystick = null;
    shootButton = null;
    
    // Throttling variables
    lastUpdateTime = 0;
    lastNetworkUpdateTime = 0;
    networkUpdateThrottleMs = isMobile ? 30 : 50; // More frequent updates on mobile
    
    // Memory management variables
    lastMemoryCleanupTime = 0;
    
    // Shooting variables
    bullets = null;
    lastFired = 0;
    fireDelay = 500;
    bulletSpeed = 3000;
    
    // Map editor variables
    obstacles = null;
    isEditorMode = false;
    editorGraphics = null;
    currentObstacle = null;
    obstacleStartPoint = null;
    
    // Movement speed - using global SPEED constant
    // const SPEED = 150;
    
    /**
     * Preload game assets
     */
    function preload() {
        console.log('Preloading assets...');
        
        // Create a loading text
        const loadingText = this.add.text(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2,
            'Loading...',
            { font: '20px Arial', fill: '#ffffff' }
        ).setOrigin(0.5);
        
        // Load map image
        this.load.image('map', '/assets/images/image.png');
        
        // Load player sprite sheets for idle animations
        this.load.spritesheet('player_idle_front', '/images/idle/IdleFront.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_idle_back', '/images/idle/IdleBack.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_idle_left', '/images/idle/IdleLeft.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_idle_right', '/images/idle/IdleRight.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        
        // Also load diagonal idle animations
        this.load.spritesheet('player_idle_leftfront', '/images/idle/IdleLeftFront.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_idle_leftback', '/images/idle/IdleLeftBack.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_idle_rightfront', '/images/idle/IdleRightFront.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_idle_rightback', '/images/idle/IdleRightBack.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        
        // Load player sprite sheets for run animations
        this.load.spritesheet('player_run_down', '/images/run/Run_Down.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_run_up', '/images/run/Run_Up.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_run_left', '/images/run/Run_Left.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_run_right', '/images/run/Run_Right.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_run_leftup', '/images/run/Run_LeftUp.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_run_leftdown', '/images/run/Run_LeftDown.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_run_rightup', '/images/run/Run_RightUp.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        this.load.spritesheet('player_run_rightdown', '/images/run/Run_RightDown.png', { 
            frameWidth: 16, 
            frameHeight: 16 
        });
        
        // Add load error handler
        this.load.on('loaderror', (fileObj) => {
            console.error('Error loading file:', fileObj.key);
        });
        
        // Add load complete handler
        this.load.on('complete', () => {
            console.log('All assets loaded successfully');
            loadingText.destroy();
            
            // Log all loaded textures
            console.log('Available textures:', this.textures.list);
        });
        
        // Create a fallback character texture
        const characterTexture = this.textures.createCanvas('character_fallback', 16, 16);
        const characterCtx = characterTexture.getContext();
        characterCtx.fillStyle = '#3498db';
        characterCtx.fillRect(0, 0, 16, 16);
        characterCtx.fillStyle = '#2980b9';
        characterCtx.fillRect(4, 4, 8, 8); // head
        characterTexture.refresh();
        
        // Create bullet texture if it doesn't exist
        if (!this.textures.exists('bullet')) {
            console.log('Creating bullet texture during initialization');
            const bulletTexture = this.textures.createCanvas('bullet', 32, 32);
            const bulletCtx = bulletTexture.getContext();
            
            // Create a more visible bullet shape
            bulletCtx.fillStyle = '#ff0000';  // Bright red
            bulletCtx.beginPath();
            bulletCtx.arc(16, 16, 8, 0, Math.PI * 2);  // Circle shape
            bulletCtx.fill();
            
            // Add a highlight for better visibility
            bulletCtx.fillStyle = '#ff6666';  // Lighter red
            bulletCtx.beginPath();
            bulletCtx.arc(13, 13, 4, 0, Math.PI * 2);
            bulletCtx.fill();
            
            bulletTexture.refresh();
        }
    }
    
    /**
     * Create game objects and set up the game
     */
    function create() {
        console.log('Creating game objects...');
        
        // Detect if running on mobile device
        isMobile = !this.sys.game.device.os.desktop;
        
        // Set network update frequency based on device type
        networkUpdateThrottleMs = isMobile ? 30 : 50;
        
        // Create obstacles group
        obstacles = this.physics.add.staticGroup();
        
        // Create bullets group with physics
        bullets = this.physics.add.group({
            classType: Phaser.Physics.Arcade.Sprite,
            defaultKey: 'bullet',
            maxSize: 30, // Limit the number of bullets for performance
            runChildUpdate: false, // We'll handle updates manually
            allowGravity: false
        });
        
        // Create multiple bullet sprites in the pool
        bullets.createMultiple({
            key: 'bullet',
            quantity: 30,
            active: false,
            visible: false
        });
        
        // Set properties for all bullets
        bullets.children.iterate(function(bullet) {
            if (bullet) {
                bullet.setScale(0.3);
                bullet.scaleY = 0.2; // Make bullets thinner
                bullet.setTint(0xff0000);
                bullet.setDepth(100);
                
                // Set bullet physics properties
                bullet.body.setAllowGravity(false);
                bullet.body.setAllowDrag(false);
                bullet.body.setBounce(0, 0);
                bullet.body.setFriction(0, 0);
                
                // IMPORTANT: Disable collision with world bounds
                bullet.body.collideWorldBounds = false;
            }
            return true;
        });
        
        // Handle bullets that go out of bounds
        this.physics.world.on('worldbounds', function(body) {
            const bullet = body.gameObject;
            if (bullet && bullet.active && bullets.contains(bullet)) {
                console.log('Bullet hit world bounds, destroying');
                bullet.setActive(false);
                bullet.setVisible(false);
            }
        }, this);
        
        // Try to load the map if it exists
        loadMap(this);
        
        // Add the map - make it larger for scrolling
        map = this.add.image(0, 0, 'map').setOrigin(0, 0);
        
        // Scale the map to be at least as large as the game window
        const scaleX = Math.max(1, this.cameras.main.width / map.width);
        const scaleY = Math.max(1, this.cameras.main.height / map.height);
        const scale = Math.max(scaleX, scaleY);
        
            map.setScale(scale);
        
        // Set world bounds based on the scaled map size - extended for bullets to travel further
        const worldWidth = map.width * scale * 10; // Increased from 3 to 10
        const worldHeight = map.height * scale * 10; // Increased from 3 to 10
        this.physics.world.setBounds(-worldWidth, -worldHeight, worldWidth * 3, worldHeight * 3);
        
        // Set camera bounds to match the map size (not the extended physics world)
        this.cameras.main.setBounds(0, 0, map.width * scale, map.height * scale);
        
        // Create animations for the player
        createPlayerAnimations(this);
        
        // Create the player character with animation
        player = this.physics.add.sprite(400, 300, 'player_idle_front', 0);
        
        // Make the player 30% smaller (3 * 0.7 = 2.1)
        player.setScale(2.1);
        
        player.setCollideWorldBounds(true);
        
        // Force player to be visible
        player.setVisible(true);
        player.setActive(true);
        
        // Start the idle animation
        player.play('idle_front');
        
        // Debug player visibility
        console.log('Player created:', player.x, player.y, player.visible, player.active, player.texture.key);
        
        // Add username text above player
        playerText = this.add.text(player.x, player.y - 20, playerUsername, {
            font: '14px Arial',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
            align: 'center'
        }).setOrigin(0.5);
        
        // Add health bar above username
        playerHealthBar = this.add.graphics();
        playerHealthBar.setDepth(999); // Ensure it's on top of everything
        updateHealthBar(playerHealthBar, player.x, player.y - 30, playerHealth);
        
        // Add collision between player and obstacles
        this.physics.add.collider(player, obstacles, handlePlayerCollision, null, this);
        
        // Add collision between bullets and obstacles - UPDATED
        this.physics.add.collider(bullets, obstacles, handleBulletObstacleCollision, (bullet, obstacle) => {
            // Only process collision if bullet is active
            return bullet.active;
        }, this);
        
        // Prevent bullets from colliding with the player who fired them
        this.physics.world.addCollider(bullets, player, (bullet, playerObj) => {
            // Only process collision if this is not the player's own bullet
            if (bullet.shooterId !== playerID) {
                console.log('Bullet hit local player:', bullet.bulletId);
                
                // Reduce player health
                playerHealth = Math.max(0, playerHealth - 1);
                updateHealthBar(playerHealthBar, player.x, player.y - 30, playerHealth);
                
                // Flash player red to indicate damage
                player.setTint(0xff0000);
                this.time.delayedCall(200, () => {
                    player.clearTint();
                });
                
                // Create blood splatter effect
                const blood = this.add.circle(bullet.x, bullet.y, 8, 0xbb0000, 0.8);
                blood.setDepth(101);
                
                // Fade out and destroy the blood
                this.tweens.add({
                    targets: blood,
                    alpha: 0,
                    scale: 3,
                    duration: 300,
                    onComplete: () => {
                        blood.destroy();
                    }
                });
                
                sendWebSocketMessage('bulletHit', {
                    targetId: playerID,
                    bulletId: bullet.bulletId,
                    health: playerHealth
                });
                
                bullet.destroy();
            }
            
            // Always return false for player's own bullets to prevent collision
            return bullet.shooterId !== playerID;
        }, null, this);
        
        // Set up camera to follow the player
        this.cameras.main.setBounds(0, 0, map.width * scale, map.height * scale);
        this.cameras.main.startFollow(player, true, 0.09, 0.09);
        this.cameras.main.setZoom(1.2); // Zoom in slightly
        
        // Set up input handling
        cursors = this.input.keyboard.createCursorKeys();
        
        // Create editor graphics for drawing obstacles
        editorGraphics = this.add.graphics();
        
        // Create mobile controls if on mobile device
        if (isMobile) {
            createMobileControls(this);
        }
        
        // Scan for existing players to ensure we can see everyone
        scanForExistingPlayers(this);
        
        // Set up periodic player sync
        this.time.addEvent({
            delay: 10000, // Check every 10 seconds
            callback: () => {
                if (playerID) {
                    console.log('Periodic player visibility check');
                    sendWebSocketMessage('getAllPlayers', {});
                }
            },
            callbackScope: this,
            loop: true
        });
        
        // Set up forced position updates to ensure sync
        this.time.addEvent({
            delay: 3000, // Send position every 3 seconds
            callback: () => {
                if (playerID) {
                    // Force a position update even when not moving
                    sendWebSocketMessage('playerMove', {
                        id: playerID,
                        x: player.x,
                        y: player.y,
                        direction: playerDirection,
                        state: playerState
                    });
                }
            },
            callbackScope: this,
            loop: true
        });
        
        // Handle orientation change for mobile
        window.addEventListener('orientationchange', () => {
            if (isMobile) {
                // Wait for orientation change to complete
                setTimeout(() => {
                    // Recreate mobile controls with new orientation
                    if (mobileControls.left) mobileControls.left.destroy();
                    if (mobileControls.right) mobileControls.right.destroy();
                    if (joystick) joystick.destroy();
                    if (shootButton) shootButton.destroy();
                    
                    createMobileControls(this);
                    
                    // Resize game
                    this.scale.resize(window.innerWidth, window.innerHeight);
                    this.cameras.main.setSize(window.innerWidth, window.innerHeight);
                }, 200);
            }
        });
        
        // Get the player's socket ID when connected
        socket.onopen = () => {
            playerID = socket.id;
            console.log('Connected with ID:', playerID);
            
            // Send player info to server
            sendWebSocketMessage('player_info', {
                id: playerID,
                username: playerUsername,
                x: player.x,
                y: player.y
            });
        };
        
        // Single WebSocket message handler - ONLY ONE message handler!
        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        // REMOVE all duplicate socket.onmessage handlers
        
        // Handle mouse clicks for movement or editor
        this.input.on('pointerdown', (pointer) => {
            // Convert screen coordinates to world coordinates
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            
            if (isEditorMode) {
                // In editor mode, start drawing an obstacle
                obstacleStartPoint = { x: worldPoint.x, y: worldPoint.y };
                
                // Preview the obstacle
                editorGraphics.clear();
                editorGraphics.lineStyle(2, 0xff0000, 1);
                editorGraphics.strokeRect(obstacleStartPoint.x, obstacleStartPoint.y, 1, 1);
            } else {
                // In game mode, move the player
                targetPosition = { x: worldPoint.x, y: worldPoint.y };
            
                // Only update state if we're not already running
                if (playerState !== 'run') {
                    playerState = 'run';
                    
                    // Update player direction
                    updatePlayerDirection(Phaser.Math.Angle.Between(
                        player.x, player.y,
                        worldPoint.x, worldPoint.y
                    ));
                    
                    // Update player animation based on direction
                    updatePlayerAnimation();
                    
                    // Emit the initial movement to the server
                sendWebSocketMessage('playerMove', {
                    id: playerID,
                    x: player.x,
                    y: player.y,
                    direction: playerDirection,
                    state: 'run'
                });
                } else {
                    // Just update direction if already running
                updatePlayerDirection(Phaser.Math.Angle.Between(
                    player.x, player.y,
                    worldPoint.x, worldPoint.y
                ));
                
                    // Update player animation based on new direction
                    updatePlayerAnimation();
                }
            }
        });
        
        // Handle mouse move for editor preview
        this.input.on('pointermove', (pointer) => {
            if (isEditorMode && obstacleStartPoint) {
                // Convert screen coordinates to world coordinates
                const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                
                // Preview the obstacle
                editorGraphics.clear();
                editorGraphics.lineStyle(2, 0xff0000, 1);
                
                const width = worldPoint.x - obstacleStartPoint.x;
                const height = worldPoint.y - obstacleStartPoint.y;
                
                editorGraphics.strokeRect(
                    obstacleStartPoint.x, 
                    obstacleStartPoint.y, 
                    width, 
                    height
                );
            }
        });
        
        // Handle mouse up for editor to create obstacle
        this.input.on('pointerup', (pointer) => {
            if (isEditorMode && obstacleStartPoint) {
                // Convert screen coordinates to world coordinates
                const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                
                // Calculate width and height
                const width = worldPoint.x - obstacleStartPoint.x;
                const height = worldPoint.y - obstacleStartPoint.y;
                
                // Only create if it has some size
                if (Math.abs(width) > 10 && Math.abs(height) > 10) {
                    // Create a new obstacle
                    createObstacle(
                        this,
                        obstacleStartPoint.x,
                        obstacleStartPoint.y,
                        width,
                        height
                    );
                }
                
                // Clear the preview
                editorGraphics.clear();
                obstacleStartPoint = null;
            }
        });
        
        // Handle other players' movements
        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        /**
         * Update an existing other player with new data
         * @param {Phaser.GameObjects.Sprite} otherPlayer - The player sprite to update
         * @param {Object} data - The new player data
         */
        function updateOtherPlayer(otherPlayer, data) {
            try {
                if (!otherPlayer || !otherPlayer.sprite) {
                    console.error('Invalid otherPlayer object in updateOtherPlayer:', otherPlayer);
                    return;
                }
                
            // Update position
                if (data.x !== undefined && data.y !== undefined) {
            otherPlayer.x = data.x;
            otherPlayer.y = data.y;
                    otherPlayer.sprite.x = data.x;
                    otherPlayer.sprite.y = data.y;
                }
            
            // Update direction and state
                if (data.direction) {
                    otherPlayer.direction = data.direction;
                }
                
                if (data.state) {
                    otherPlayer.state = data.state;
                }
            
            // Update health
            if (data.health !== undefined) {
                otherPlayer.health = data.health;
                    if (otherPlayer.healthBar) {
                        updateHealthBar(otherPlayer.healthBar, otherPlayer.x, otherPlayer.y - 30, otherPlayer.health);
                    }
            }
                
                // Update username if provided
            if (data.username && otherPlayer.usernameText) {
                    otherPlayer.username = data.username;
                otherPlayer.usernameText.setText(data.username);
            }
            
            // Update position of username text and health bar
            if (otherPlayer.usernameText) {
                    otherPlayer.usernameText.setPosition(otherPlayer.x, otherPlayer.y - 20);
                }
                
                // Update texture based on direction
            updateOtherPlayerTexture(otherPlayer);
            } catch (error) {
                console.error('Error in updateOtherPlayer:', error);
            }
            }
        
        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        /**
         * Clean up a player and all associated resources
         * @param {Phaser.GameObjects.Sprite} playerObj - The player object to clean up
         */
        function cleanupPlayer(playerObj) {
                // Remove username text
            if (playerObj.usernameText) {
                playerObj.usernameText.destroy();
                playerObj.usernameText = null;
                }
                
                // Remove health bar
            if (playerObj.healthBar) {
                playerObj.healthBar.destroy();
                playerObj.healthBar = null;
            }
            
            // Remove bullet collider
            if (playerObj.bulletCollider) {
                playerObj.bulletCollider.destroy();
                playerObj.bulletCollider = null;
            }
            
            // Disable physics body
            if (playerObj.body) {
                playerObj.body.enable = false;
            }
            
            // Clear any target positions
            playerObj.targetX = null;
            playerObj.targetY = null;
            
            // Destroy the player sprite
            playerObj.destroy();
        }
        
        // Add keyboard input for shooting - REWORKED SYSTEM
        const scene = this;
        const ctrlKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
        
        // Add Ctrl key press for shooting
        ctrlKey.on('down', function() {
            if (!isEditorMode && playerID) {
                console.log('CTRL key pressed, firing bullet');
                fireBullet(scene);
            }
        });
        
        // Remove the old shooting check system
        this.keyboardShootCheck = null;
        
        // Remove the space key shooting
        
        // Handle keyboard input for editor mode toggle
        const keyE = this.input.keyboard.addKey('E');
        keyE.on('down', () => {
            toggleEditorMode(this);
        });
        
        // Create editor UI
        createEditorUI(this);
        
        // Ensure player doesn't spawn inside obstacles
        // Move player to a safe position after map is loaded
        this.time.delayedCall(100, () => {
            // Move player to a safe position (center of the map with offset)
            player.setPosition(
                map.width * scale / 2 + 200, 
                map.height * scale / 2 + 200
            );
            
            // Emit position update to server
            sendWebSocketMessage('playerMove', {
                id: playerID,
                x: player.x,
                y: player.y,
                direction: playerDirection,
                state: playerState
            });
        });
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.scale.resize(window.innerWidth, window.innerHeight);
            this.cameras.main.setSize(window.innerWidth, window.innerHeight);
        });

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        // Handle player hit events
        socket.on('playerHit', (data) => {
            console.log('Player hit event received:', data);
            
            // Call the handler function to update health
            handlePlayerHit(data);
            
            // If it's the local player who got hit
            if (data.id === playerID) {
                // Flash the player red
                player.setTint(0xff0000);
                setTimeout(() => {
                    player.clearTint();
                }, 200);
                
                // Show damage text
                const damageText = this.add.text(player.x, player.y - 40, '-1', {
                    font: '16px Arial',
                    fill: '#ff0000',
                    stroke: '#000000',
                    strokeThickness: 3
                }).setOrigin(0.5);
                
                // Animate damage text
                this.tweens.add({
                    targets: damageText,
                    y: damageText.y - 30,
                    alpha: 0,
                    duration: 800,
                    onComplete: () => {
                        damageText.destroy();
                    }
                });
            }
            // If it's another player who got hit
            else if (otherPlayers[data.id]) {
                console.log('Other player hit, health reduced to:', data.health);
                
                // Flash the player red
                otherPlayers[data.id].sprite.setTint(0xff0000);
                setTimeout(() => {
                    if (otherPlayers[data.id] && otherPlayers[data.id].sprite) {
                        otherPlayers[data.id].sprite.clearTint();
                    }
                }, 200);
                
                // Show damage text
                const damageText = this.add.text(otherPlayers[data.id].sprite.x, otherPlayers[data.id].sprite.y - 40, '-1', {
                    font: '16px Arial',
                    fill: '#ff0000',
                    stroke: '#000000',
                    strokeThickness: 3
                }).setOrigin(0.5);
                
                // Animate damage text
                this.tweens.add({
                    targets: damageText,
                    y: damageText.y - 30,
                    alpha: 0,
                    duration: 800,
                    onComplete: () => damageText.destroy()
                });
            }
        });
    }
    
    /**
     * Update player texture based on direction
     */
    function updatePlayerTexture() {
        let textureKey = 'player';
        
        switch (playerDirection) {
            case 'up':
                textureKey = 'player_back';
                break;
            case 'down':
                textureKey = 'player';
                break;
            case 'left':
                textureKey = 'player_left';
                break;
            case 'right':
                textureKey = 'player_right';
                break;
            case 'left_up':
            case 'right_up':
                textureKey = 'player_back';
                break;
            case 'left_down':
            case 'right_down':
                textureKey = 'player';
                break;
        }
        
        player.setTexture(textureKey);
    }
    
    /**
     * Update other player's texture based on direction and state
     * @param {Object} otherPlayer - The other player object
     */
    function updateOtherPlayerTexture(otherPlayer) {
        try {
            let animKey = '';
            
            // Log the current state
            console.log(`Updating texture for player ${otherPlayer.id}:`, {
                direction: otherPlayer.direction,
                state: otherPlayer.state,
                currentAnim: otherPlayer.sprite.anims.currentAnim ? otherPlayer.sprite.anims.currentAnim.key : 'none'
            });
            
            if (otherPlayer.state === 'idle') {
                // Map idle directions to corresponding animations
                switch (otherPlayer.direction) {
                    case 'up':
                        animKey = 'idle_back';
                        break;
                    case 'down':
                        animKey = 'idle_front';
                        break;
                    case 'left':
                        animKey = 'idle_left';
                        break;
                    case 'right':
                        animKey = 'idle_right';
                        break;
                    case 'left_up':
                        animKey = 'idle_leftback';
                        break;
                    case 'left_down':
                        animKey = 'idle_leftfront';
                        break;
                    case 'right_up':
                        animKey = 'idle_rightback';
                        break;
                    case 'right_down':
                        animKey = 'idle_rightfront';
                        break;
                    default:
                        animKey = 'idle_front';
                }
            } else { // otherPlayer.state === 'run' or anything else, default to run animations
                // Map run directions to corresponding animations
                switch (otherPlayer.direction) {
                    case 'up':
                        animKey = 'run_up';
                        break;
                    case 'down':
                        animKey = 'run_down';
                        break;
                    case 'left':
                        animKey = 'run_left';
                        break;
                    case 'right':
                        animKey = 'run_right';
                        break;
                    case 'left_up':
                        animKey = 'run_leftup';
                        break;
                    case 'left_down':
                        animKey = 'run_leftdown';
                        break;
                    case 'right_up':
                        animKey = 'run_rightup';
                        break;
                    case 'right_down':
                        animKey = 'run_rightdown';
                        break;
                    default:
                        animKey = 'run_down';
                }
            }
            
            // Log the animation we're trying to play
            console.log(`Attempting to play animation '${animKey}' for player ${otherPlayer.id}`);
            
            // Check if the animation exists in the scene
            if (!otherPlayer.sprite.scene.anims.exists(animKey)) {
                console.warn(`Animation '${animKey}' doesn't exist in the scene for player ${otherPlayer.id}`);
                console.log('Available animations:', Object.keys(otherPlayer.sprite.scene.anims.anims.entries));
            }
            
            // Only change animation if it's different from current
            if (otherPlayer.sprite.anims.currentAnim === null || otherPlayer.sprite.anims.currentAnim.key !== animKey) {
                // Check if animation exists before trying to play it
                if (otherPlayer.sprite.scene.anims.exists(animKey)) {
                    console.log(`Playing animation '${animKey}' for player ${otherPlayer.id}`);
                    otherPlayer.sprite.play(animKey, true);
                } else {
                    console.warn(`Animation '${animKey}' doesn't exist for player ${otherPlayer.id}. Fallback to static texture.`);
                    
                    // Fallback to a static texture
                    const textureKey = otherPlayer.state === 'idle' ? 'player_idle_front' : 'player_run_down';
                    if (otherPlayer.sprite.scene.textures.exists(textureKey)) {
                        console.log(`Using fallback texture '${textureKey}' for player ${otherPlayer.id}`);
                        otherPlayer.sprite.setTexture(textureKey, 0);
                    } else {
                        console.warn(`Fallback texture '${textureKey}' doesn't exist for player ${otherPlayer.id}. Using character_fallback.`);
                        otherPlayer.sprite.setTexture('character_fallback');
                    }
                }
            }
        } catch (error) {
            console.error('Error in updateOtherPlayerTexture:', error);
        }
    }
    
    /**
     * Create a new obstacle in the game world
     * @param {Phaser.Scene} scene - The current scene
     * @param {number} x - The x position
     * @param {number} y - The y position
     * @param {number} width - The width of the obstacle
     * @param {number} height - The height of the obstacle
     */
    function createObstacle(scene, x, y, width, height) {
        // Normalize negative dimensions
        let normalizedX = x;
        let normalizedY = y;
        let normalizedWidth = width;
        let normalizedHeight = height;
        
        if (width < 0) {
            normalizedX = x + width;
            normalizedWidth = Math.abs(width);
        }
        
        if (height < 0) {
            normalizedY = y + height;
            normalizedHeight = Math.abs(height);
        }
        
        // Create a rectangle for the obstacle
        const obstacle = scene.add.rectangle(
            normalizedX + normalizedWidth / 2,
            normalizedY + normalizedHeight / 2,
            normalizedWidth,
            normalizedHeight,
            0x00ff00,
            0.3
        );
        
        // Add the obstacle to the physics group
        obstacles.add(obstacle);
        
        // Make sure it's immovable
        obstacle.body.immovable = true;
        
        console.log(`Created obstacle at (${normalizedX}, ${normalizedY}) with size ${normalizedWidth}x${normalizedHeight}`);
    }
    
    /**
     * Toggle editor mode on/off
     * @param {Phaser.Scene} scene - The current scene
     */
    function toggleEditorMode(scene) {
        isEditorMode = !isEditorMode;
        
        // Update UI
        const editorButton = document.getElementById('editor-toggle');
        if (editorButton) {
            editorButton.textContent = isEditorMode ? 'Exit Editor' : 'Enter Editor';
        }
        
        // Show/hide editor controls
        const editorControls = document.getElementById('editor-controls');
        if (editorControls) {
            editorControls.style.display = isEditorMode ? 'block' : 'none';
        }
        
        // Clear any in-progress obstacle
        editorGraphics.clear();
        obstacleStartPoint = null;
        
        // Show/hide obstacles based on mode
        obstacles.getChildren().forEach(obstacle => {
            obstacle.setAlpha(isEditorMode ? 0.5 : 0.2);
            
            // Make obstacles interactive in editor mode
            if (isEditorMode) {
                obstacle.setInteractive();
                
                // Add right-click event to remove obstacle
                obstacle.on('pointerdown', function(pointer) {
                    if (pointer.rightButtonDown()) {
                        this.destroy();
                    }
                });
            } else {
                obstacle.disableInteractive();
            }
        });
        
        console.log(`Editor mode ${isEditorMode ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Create the editor UI
     * @param {Phaser.Scene} scene - The current scene
     */
    function createEditorUI(scene) {
        // Create a container for the editor UI
        const editorContainer = document.createElement('div');
        editorContainer.id = 'editor-container';
        editorContainer.style.position = 'absolute';
        editorContainer.style.top = '10px';
        editorContainer.style.right = '10px';
        editorContainer.style.zIndex = '1000';
        
        // Create a toggle button for the editor
        const editorToggle = document.createElement('button');
        editorToggle.id = 'editor-toggle';
        editorToggle.textContent = 'Enter Editor';
        editorToggle.style.padding = '10px';
        editorToggle.style.backgroundColor = '#4CAF50';
        editorToggle.style.color = 'white';
        editorToggle.style.border = 'none';
        editorToggle.style.borderRadius = '5px';
        editorToggle.style.cursor = 'pointer';
        
        // Add click event to toggle editor mode
        editorToggle.addEventListener('click', () => {
            toggleEditorMode(scene);
        });
        
        // Create editor controls (initially hidden)
        const editorControls = document.createElement('div');
        editorControls.id = 'editor-controls';
        editorControls.style.display = 'none';
        editorControls.style.marginTop = '10px';
        
        // Create save button
        const saveButton = document.createElement('button');
        saveButton.id = 'save-map';
        saveButton.textContent = 'Save Map';
        saveButton.style.padding = '10px';
        saveButton.style.backgroundColor = '#2196F3';
        saveButton.style.color = 'white';
        saveButton.style.border = 'none';
        saveButton.style.borderRadius = '5px';
        saveButton.style.cursor = 'pointer';
        saveButton.style.marginRight = '5px';
        
        // Add click event to save the map
        saveButton.addEventListener('click', () => {
            saveMap(scene);
        });
        
        // Create load button
        const loadButton = document.createElement('button');
        loadButton.id = 'load-map';
        loadButton.textContent = 'Load Map';
        loadButton.style.padding = '10px';
        loadButton.style.backgroundColor = '#FF9800';
        loadButton.style.color = 'white';
        loadButton.style.border = 'none';
        loadButton.style.borderRadius = '5px';
        loadButton.style.cursor = 'pointer';
        
        // Add click event to load the map
        loadButton.addEventListener('click', () => {
            loadMap(scene);
        });
        
        // Add buttons to controls
        editorControls.appendChild(saveButton);
        editorControls.appendChild(loadButton);
        
        // Create instructions for the editor
        const instructions = document.createElement('div');
        instructions.id = 'editor-instructions';
        instructions.innerHTML = `
            <p style="color: white; background-color: rgba(0,0,0,0.7); padding: 10px; border-radius: 5px; margin-top: 10px;">
                <strong>Editor Instructions:</strong><br>
                1. Click and drag to create obstacles<br>
                2. Right-click on obstacles to remove them<br>
                3. Press 'E' to toggle editor mode<br>
                4. Save your map to use it later
            </p>
        `;
        
        // Add elements to the container
        editorContainer.appendChild(editorToggle);
        editorContainer.appendChild(editorControls);
        editorContainer.appendChild(instructions);
        
        // Add the container to the document
        document.body.appendChild(editorContainer);
    }
    
    /**
     * Save the current map to localStorage
     * @param {Phaser.Scene} scene - The current scene
     */
    function saveMap(scene) {
        // Get all obstacles
        const mapData = {
            obstacles: []
        };
        
        // Save each obstacle's position and size
        obstacles.getChildren().forEach(obstacle => {
            mapData.obstacles.push({
                x: obstacle.x,
                y: obstacle.y,
                width: obstacle.width,
                height: obstacle.height
            });
        });
        
        // Check if there are any obstacles
        if (mapData.obstacles.length === 0) {
            // Create a notification
            const notification = document.createElement('div');
            notification.style.position = 'absolute';
            notification.style.top = '50%';
            notification.style.left = '50%';
            notification.style.transform = 'translate(-50%, -50%)';
            notification.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
            notification.style.color = 'white';
            notification.style.padding = '20px';
            notification.style.borderRadius = '10px';
            notification.style.zIndex = '2000';
            notification.textContent = 'Cannot save empty map! Please create some obstacles first.';
            
            // Add to document
            document.body.appendChild(notification);
            
            // Remove after 3 seconds
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 3000);
            
            return;
        }
        
        // Save to localStorage
        localStorage.setItem('gameMap', JSON.stringify(mapData));
        
        // Create a notification
        const notification = document.createElement('div');
        notification.style.position = 'absolute';
        notification.style.top = '50%';
        notification.style.left = '50%';
        notification.style.transform = 'translate(-50%, -50%)';
        notification.style.backgroundColor = 'rgba(0, 128, 0, 0.8)';
        notification.style.color = 'white';
        notification.style.padding = '20px';
        notification.style.borderRadius = '10px';
        notification.style.zIndex = '2000';
        notification.textContent = 'Map saved successfully!';
        
        // Add to document
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 3000);
    }
    
    /**
     * Load a map from localStorage
     * @param {Phaser.Scene} scene - The current scene
     */
    function loadMap(scene) {
        // Get saved map data
        const savedMap = localStorage.getItem('gameMap');
        
        if (savedMap) {
            try {
                const mapData = JSON.parse(savedMap);
                
                // Clear existing obstacles
                obstacles.clear(true, true);
                
                // Create new obstacles from saved data
                mapData.obstacles.forEach(obstacleData => {
                    const obstacle = scene.add.rectangle(
                        obstacleData.x,
                        obstacleData.y,
                        obstacleData.width,
                        obstacleData.height,
                        0x00ff00,
                        isEditorMode ? 0.5 : 0.2
                    );
                    
                    // Add to physics group
                    obstacles.add(obstacle);
                    
                    // Make obstacle immovable
                    obstacle.body.immovable = true;
                    
                    // Make interactive in editor mode
                    if (isEditorMode) {
                        obstacle.setInteractive();
                        
                        // Add right-click event to remove obstacle
                        obstacle.on('pointerdown', function(pointer) {
                            if (pointer.rightButtonDown()) {
                                this.destroy();
                            }
                        });
                    }
                });
                
                console.log('Map loaded successfully!');
            } catch (error) {
                console.error('Error loading map:', error);
                createDefaultMap(scene);
            }
        } else {
            console.log('No saved map found. Creating default map.');
            createDefaultMap(scene);
        }
    }
    
    /**
     * Create a default map with some basic obstacles
     * @param {Phaser.Scene} scene - The current scene
     */
    function createDefaultMap(scene) {
        // Clear existing obstacles
        obstacles.clear(true, true);
        
        // Get map dimensions
        const mapWidth = scene.physics.world.bounds.width;
        const mapHeight = scene.physics.world.bounds.height;
        
        // Create border walls
        const borderThickness = 20;
        
        // Create obstacles for the default map
        const defaultObstacles = [
            // Top wall
            { x: mapWidth / 2, y: borderThickness / 2, width: mapWidth, height: borderThickness },
            // Bottom wall
            { x: mapWidth / 2, y: mapHeight - borderThickness / 2, width: mapWidth, height: borderThickness },
            // Left wall
            { x: borderThickness / 2, y: mapHeight / 2, width: borderThickness, height: mapHeight },
            // Right wall
            { x: mapWidth - borderThickness / 2, y: mapHeight / 2, width: borderThickness, height: mapHeight },
            
            // Some random obstacles in the map
            { x: mapWidth * 0.25, y: mapHeight * 0.25, width: 100, height: 100 },
            { x: mapWidth * 0.75, y: mapHeight * 0.25, width: 100, height: 100 },
            { x: mapWidth * 0.25, y: mapHeight * 0.75, width: 100, height: 100 },
            { x: mapWidth * 0.75, y: mapHeight * 0.75, width: 100, height: 100 },
            
            // A central obstacle
            { x: mapWidth * 0.5, y: mapHeight * 0.5, width: 150, height: 150 }
        ];
        
        // Create each obstacle
        defaultObstacles.forEach(obstacleData => {
            const obstacle = scene.add.rectangle(
                obstacleData.x,
                obstacleData.y,
                obstacleData.width,
                obstacleData.height,
                0x00ff00,
                isEditorMode ? 0.5 : 0.2
            );
            
            // Add to physics group
            obstacles.add(obstacle);
            
            // Make obstacle immovable
            obstacle.body.immovable = true;
            
            // Make interactive in editor mode
            if (isEditorMode) {
                obstacle.setInteractive();
                
                // Add right-click event to remove obstacle
                obstacle.on('pointerdown', function(pointer) {
                    if (pointer.rightButtonDown()) {
                        this.destroy();
                    }
                });
            }
        });
        
        console.log('Default map created.');
    }
    
    /**
     * Update player direction based on movement angle
     * @param {number} angle - The angle in radians
     */
    function updatePlayerDirection(angle) {
        // Convert the angle to degrees
        const degrees = Phaser.Math.RadToDeg(angle);
        
        // Determine the direction based on the angle
        if (degrees >= -22.5 && degrees < 22.5) {
            playerDirection = 'right';
        } else if (degrees >= 22.5 && degrees < 67.5) {
            playerDirection = 'right_down';
        } else if (degrees >= 67.5 && degrees < 112.5) {
            playerDirection = 'down';
        } else if (degrees >= 112.5 && degrees < 157.5) {
            playerDirection = 'left_down';
        } else if ((degrees >= 157.5 && degrees <= 180) || (degrees >= -180 && degrees < -157.5)) {
            playerDirection = 'left';
        } else if (degrees >= -157.5 && degrees < -112.5) {
            playerDirection = 'left_up';
        } else if (degrees >= -112.5 && degrees < -67.5) {
            playerDirection = 'up';
        } else if (degrees >= -67.5 && degrees < -22.5) {
            playerDirection = 'right_up';
        }
    }
    
    /**
     * Update other player direction based on movement angle
     * @param {Object} otherPlayer - The other player object
     * @param {number} angle - The angle in radians
     */
    function updateOtherPlayerDirection(otherPlayer, angle) {
        try {
            if (!otherPlayer) {
                console.error('Invalid otherPlayer object in updateOtherPlayerDirection:', otherPlayer);
                return;
            }
            
        // Convert the angle to degrees
        const degrees = Phaser.Math.RadToDeg(angle);
        
        // Determine the direction based on the angle
        if (degrees >= -22.5 && degrees < 22.5) {
            otherPlayer.direction = 'right';
        } else if (degrees >= 22.5 && degrees < 67.5) {
            otherPlayer.direction = 'right_down';
        } else if (degrees >= 67.5 && degrees < 112.5) {
            otherPlayer.direction = 'down';
        } else if (degrees >= 112.5 && degrees < 157.5) {
            otherPlayer.direction = 'left_down';
        } else if ((degrees >= 157.5 && degrees <= 180) || (degrees >= -180 && degrees < -157.5)) {
            otherPlayer.direction = 'left';
        } else if (degrees >= -157.5 && degrees < -112.5) {
            otherPlayer.direction = 'left_up';
        } else if (degrees >= -112.5 && degrees < -67.5) {
            otherPlayer.direction = 'up';
        } else if (degrees >= -67.5 && degrees < -22.5) {
            otherPlayer.direction = 'right_up';
            }
            
            // Update the player texture based on the new direction
            updateOtherPlayerTexture(otherPlayer);
        } catch (error) {
            console.error('Error in updateOtherPlayerDirection:', error);
        }
    }
    
    /**
     * Update player animation based on state and direction
     */
    function updatePlayerAnimation() {
        let animKey = '';
        
        if (playerState === 'idle') {
            // Map idle directions to corresponding animations
            switch (playerDirection) {
                case 'up':
                    animKey = 'idle_back';
                    break;
                case 'down':
                    animKey = 'idle_front';
                    break;
                case 'left':
                    animKey = 'idle_left';
                    break;
                case 'right':
                    animKey = 'idle_right';
                    break;
                case 'left_up':
                    animKey = 'idle_left'; // Use left idle for diagonal
                    break;
                case 'left_down':
                    animKey = 'idle_left'; // Use left idle for diagonal
                    break;
                case 'right_up':
                    animKey = 'idle_right'; // Use right idle for diagonal
                    break;
                case 'right_down':
                    animKey = 'idle_right'; // Use right idle for diagonal
                    break;
                default:
                    animKey = 'idle_front';
            }
        } else { // playerState === 'run'
            // Map run directions to corresponding animations
            switch (playerDirection) {
                case 'up':
                    animKey = 'run_up';
                    break;
                case 'down':
                    animKey = 'run_down';
                    break;
                case 'left':
                    animKey = 'run_left';
                    break;
                case 'right':
                    animKey = 'run_right';
                    break;
                case 'left_up':
                    animKey = 'run_leftup';
                    break;
                case 'left_down':
                    animKey = 'run_leftdown';
                    break;
                case 'right_up':
                    animKey = 'run_rightup';
                    break;
                case 'right_down':
                    animKey = 'run_rightdown';
                    break;
                default:
                    animKey = 'run_down';
            }
        }
        
        // Only change animation if it's different from current
        if (player.anims.currentAnim === null || player.anims.currentAnim.key !== animKey) {
                player.play(animKey);
        }
    }
    
    /**
     * Create animations for the player
     * @param {Phaser.Scene} scene - The current scene
     */
    function createPlayerAnimations(scene) {
        console.log('Creating player animations...');
        
        // Create idle animations
        try {
            scene.anims.create({
                key: 'idle_front',
                frames: scene.anims.generateFrameNumbers('player_idle_front', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_front animation');
        } catch (error) {
            console.error('Failed to create idle_front animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'idle_back',
                frames: scene.anims.generateFrameNumbers('player_idle_back', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_back animation');
        } catch (error) {
            console.error('Failed to create idle_back animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'idle_left',
                frames: scene.anims.generateFrameNumbers('player_idle_left', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_left animation');
        } catch (error) {
            console.error('Failed to create idle_left animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'idle_right',
                frames: scene.anims.generateFrameNumbers('player_idle_right', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_right animation');
        } catch (error) {
            console.error('Failed to create idle_right animation:', error);
        }
        
        // Create diagonal idle animations
        try {
            scene.anims.create({
                key: 'idle_leftfront',
                frames: scene.anims.generateFrameNumbers('player_idle_leftfront', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_leftfront animation');
        } catch (error) {
            console.error('Failed to create idle_leftfront animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'idle_leftback',
                frames: scene.anims.generateFrameNumbers('player_idle_leftback', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_leftback animation');
        } catch (error) {
            console.error('Failed to create idle_leftback animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'idle_rightfront',
                frames: scene.anims.generateFrameNumbers('player_idle_rightfront', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_rightfront animation');
        } catch (error) {
            console.error('Failed to create idle_rightfront animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'idle_rightback',
                frames: scene.anims.generateFrameNumbers('player_idle_rightback', { start: 0, end: 1 }),
                frameRate: 2,
                repeat: -1
            });
            console.log('Created idle_rightback animation');
        } catch (error) {
            console.error('Failed to create idle_rightback animation:', error);
        }
        
        // Create run animations
        try {
            scene.anims.create({
                key: 'run_down',
                frames: scene.anims.generateFrameNumbers('player_run_down', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_down animation');
        } catch (error) {
            console.error('Failed to create run_down animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'run_up',
                frames: scene.anims.generateFrameNumbers('player_run_up', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_up animation');
        } catch (error) {
            console.error('Failed to create run_up animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'run_left',
                frames: scene.anims.generateFrameNumbers('player_run_left', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_left animation');
        } catch (error) {
            console.error('Failed to create run_left animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'run_right',
                frames: scene.anims.generateFrameNumbers('player_run_right', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_right animation');
        } catch (error) {
            console.error('Failed to create run_right animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'run_leftup',
                frames: scene.anims.generateFrameNumbers('player_run_leftup', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_leftup animation');
        } catch (error) {
            console.error('Failed to create run_leftup animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'run_leftdown',
                frames: scene.anims.generateFrameNumbers('player_run_leftdown', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_leftdown animation');
        } catch (error) {
            console.error('Failed to create run_leftdown animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'run_rightup',
                frames: scene.anims.generateFrameNumbers('player_run_rightup', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_rightup animation');
        } catch (error) {
            console.error('Failed to create run_rightup animation:', error);
        }
        
        try {
            scene.anims.create({
                key: 'run_rightdown',
                frames: scene.anims.generateFrameNumbers('player_run_rightdown', { start: 0, end: 1 }),
                frameRate: 6,
                repeat: -1
            });
            console.log('Created run_rightdown animation');
        } catch (error) {
            console.error('Failed to create run_rightdown animation:', error);
        }
        
        // Log all available animations
        console.log('Available animations:', Object.keys(scene.anims.anims.entries));
    }
    
    /**
     * Create a bullet
     * @param {Phaser.Scene} scene - The current scene
     * @param {number} x - The x position
     * @param {number} y - The y position
     * @param {string} direction - The direction to fire
     * @param {string} shooterId - The ID of the player who fired
     * @param {string} bulletId - Unique ID for this bullet
     */
    function createBullet(scene, x, y, direction, shooterId, bulletId) {
        console.log('Creating bullet:', shooterId, direction, bulletId);
        
        try {
            // Create a new bullet sprite
            const bullet = scene.physics.add.sprite(x, y, 'bullet');
            
            if (!bullet) {
                console.error('Failed to create bullet sprite');
                return null;
            }
            
            // Set bullet properties
            bullet.setActive(true);
            bullet.setVisible(true);
            bullet.shooterId = shooterId;
            bullet.bulletId = bulletId;
            bullet.setScale(0.3);
            bullet.setTint(0xff0000);
            bullet.setDepth(100);
            
            // Calculate angle based on direction
            let angle = 0;
            switch (direction) {
                case 'up': angle = -Math.PI/2; break;
                case 'down': angle = Math.PI/2; break;
                case 'left': angle = Math.PI; break;
                case 'right': angle = 0; break;
                case 'left_up': angle = -3*Math.PI/4; break;
                case 'left_down': angle = 3*Math.PI/4; break;
                case 'right_up': angle = -Math.PI/4; break;
                case 'right_down': angle = Math.PI/4; break;
                default: break;
            }
            
            // Set bullet rotation and appearance
            bullet.rotation = angle;
            bullet.scaleY = 0.2;
            
            // Calculate velocity components
            const vx = bulletSpeed * Math.cos(angle);
            const vy = bulletSpeed * Math.sin(angle);
            
            // Set up physics body
            if (bullet.body) {
                bullet.body.reset(x, y);
                bullet.body.setVelocity(vx, vy);
                bullet.body.setAllowGravity(false);
                bullet.body.setImmovable(true);
                bullet.body.collideWorldBounds = false;
            }
                
            // Store original velocity for reference
                bullet.originalVelocity = { x: vx, y: vy };
                
            // Add bullet to group
            bullets.add(bullet);
            
            // Add glow effect
            scene.tweens.add({
                targets: bullet,
                alpha: 0.8,
                yoyo: true,
                repeat: -1,
                duration: 100
            });
            
            // Create muzzle flash
            const flash = scene.add.circle(x, y, 10, 0xff0000, 0.7);
            flash.setDepth(101);
                scene.tweens.add({
                targets: flash,
                    alpha: 0,
                scale: 0.5,
                duration: 100,
                onComplete: () => flash.destroy()
            });
            
            // Add screen shake
            scene.cameras.main.shake(30, 0.003);
            
            // Set up collisions
            setupBulletCollisions(scene, bullet);
            
            // Set bullet lifetime
            scene.time.delayedCall(5000, () => {
                if (bullet && bullet.active) {
                    bullet.destroy();
                }
            });
            
            console.log(`Bullet created at (${x}, ${y}) with angle: ${angle}, velocity: (${vx}, ${vy})`);
            return bullet;
            
        } catch (error) {
            console.error('Error creating bullet:', error);
            return null;
        }
    }

    function setupBulletCollisions(scene, bullet) {
        try {
            if (!scene || !bullet) return;

            // Add collision with obstacles
            scene.physics.add.collider(bullet, obstacles, handleBulletObstacleCollision, null, scene);

            // Handle collisions with players
            if (bullet.shooterId !== playerID) {
                // Add collision with local player if bullet is from another player
                scene.physics.add.overlap(bullet, player, (bullet, hitPlayer) => {
                    handleBulletPlayerCollision(scene, bullet, hitPlayer);
                }, null, scene);
            }

            // Add collision with other players
            Object.values(otherPlayers).forEach(otherPlayer => {
                if (otherPlayer && otherPlayer.active && otherPlayer.id !== bullet.shooterId) {
                    scene.physics.add.overlap(bullet, otherPlayer, (bullet, hitPlayer) => {
                        handleBulletPlayerCollision(scene, bullet, hitPlayer);
                    }, null, scene);
                }
            });

        } catch (error) {
            console.error('Error in setupBulletCollisions:', error);
        }
    }
    
    /**
     * Disable a bullet and clean up its resources
     * @param {Phaser.GameObjects.Sprite} bullet - The bullet to disable
     */
    function disableBullet(bullet) {
        if (!bullet) return;
        
        // Set bullet as inactive before cleanup
        bullet.setActive(false);
        bullet.setVisible(false);
        
        // Disable physics body to prevent memory leaks
        if (bullet.body) {
            bullet.body.enable = false;
            
            // Reset velocity to prevent physics calculations
            bullet.body.velocity.x = 0;
            bullet.body.velocity.y = 0;
            bullet.body.reset(bullet.x, bullet.y);
        }
        
        // Clean up any colliders
        if (bullet.colliders) {
            bullet.colliders.forEach(collider => {
                if (collider) collider.destroy();
            });
            bullet.colliders = [];
        }
        
        // Clear any references that might cause memory leaks
        bullet.shooterId = null;
        bullet.bulletId = null;
        bullet.originalVelocity = null;
    }
    
    /**
     * Fire a bullet from the player
     * @param {Phaser.Scene} scene - The current scene
     */
    function fireBullet(scene) {
        try {
            // Ensure we have valid scene and player
            if (!scene || !player || !playerID) {
                console.error('Invalid scene, player, or playerID for shooting');
                return;
            }
            
            // Check if enough time has passed since last shot
            const time = scene.time.now;
            if (time - lastFired < fireDelay) {
                return;
            }
            
            // Check if player is invulnerable (can't shoot while invulnerable)
            if (player.isInvulnerable) {
                console.log('Cannot shoot while invulnerable');
                return;
            }
            
            // Update last fired time
            lastFired = time;
            
            // Create bullet ID
            const bulletId = Date.now().toString();
            
            // Calculate bullet spawn position based on player direction
            let bulletX = player.x;
            let bulletY = player.y;
            const offset = 20;
            
            // Adjust bullet spawn position based on direction
            switch (playerDirection) {
                case 'up': bulletY -= offset; break;
                case 'down': bulletY += offset; break;
                case 'left': bulletX -= offset; break;
                case 'right': bulletX += offset; break;
                case 'left_up': bulletX -= offset * 0.7; bulletY -= offset * 0.7; break;
                case 'left_down': bulletX -= offset * 0.7; bulletY += offset * 0.7; break;
                case 'right_up': bulletX += offset * 0.7; bulletY -= offset * 0.7; break;
                case 'right_down': bulletX += offset * 0.7; bulletY += offset * 0.7; break;
                default: break;
            }

            // Emit bullet creation to server BEFORE creating the local bullet
            sendWebSocketMessage('playerShoot', {
                id: playerID,
                    x: bulletX,
                    y: bulletY,
                    direction: playerDirection,
                    bulletId: bulletId
                });
                
            // Create the local bullet for immediate rendering
            createBullet(scene, bulletX, bulletY, playerDirection, playerID, bulletId);
        } catch (error) {
            console.error('Error in fireBullet:', error);
        }
    }
    
    /**
     * Handle collision between player and obstacles
     * @param {Phaser.GameObjects.Sprite} player - The player sprite
     * @param {Phaser.GameObjects.Rectangle} obstacle - The obstacle
     */
    function handlePlayerCollision(player, obstacle) {
        // Stop player movement
        player.body.velocity.x = 0;
        player.body.velocity.y = 0;
        
        // Reset target position
        targetPosition = null;
        
        // Update player state
        playerState = 'idle';
        updatePlayerAnimation();
        
        // Emit state update to server
        sendWebSocketMessage('playerStateUpdate', { state: 'idle' });
    }
    
    /**
     * Handle collision between bullet and obstacle
     * @param {Phaser.GameObjects.Sprite} bullet - The bullet sprite
     * @param {Phaser.GameObjects.Rectangle} obstacle - The obstacle
     */
    function handleBulletObstacleCollision(bullet, obstacle) {
        // Skip if bullet is already inactive or has been handled
        if (!bullet || !bullet.active) {
            return;
        }

        // Only log if we have a bullet ID
        if (bullet.bulletId) {
        console.log('Bullet hit obstacle:', bullet.bulletId);
        }
        
        // Create impact effect
        const scene = bullet.scene;
        const impact = scene.add.circle(bullet.x, bullet.y, 5, 0xffff00, 0.8);
        impact.setDepth(101);
        
        // Fade out and destroy the impact
        scene.tweens.add({
            targets: impact,
            alpha: 0,
            scale: 2,
            duration: 200,
            onComplete: () => {
                impact.destroy();
            }
        });
        
        // Deactivate the bullet
        bullet.destroy();
    }
    
    /**
     * Create another player
     * @param {Phaser.Scene} scene - The current scene
     * @param {Object} data - The player data
     */
    function createOtherPlayer(scene, data) {
        try {
            // Skip if the scene is not valid
            if (!scene || !scene.physics) {
                console.error('Invalid scene for createOtherPlayer:', scene);
                return;
            }
            
            // Skip if the player already exists
            if (otherPlayers[data.id]) {
                console.log('Player already exists, updating instead:', data.id);
                updateOtherPlayer(otherPlayers[data.id], data);
                return;
            }
            
            // Skip if this is our own player
            if (data.id === playerID) {
                console.log('Skipping creation of our own player:', data.id);
                return;
            }
            
        console.log('Creating other player:', data.id, data);
            
            // Create a container for this player's objects
            otherPlayers[data.id] = {
                id: data.id,
                username: data.username || 'Player',
                direction: data.direction || 'down',
                state: data.state || 'idle',
                health: data.health || 10,
                x: data.x || 400,
                y: data.y || 300
            };
        
        // Create the player sprite with animation
            otherPlayers[data.id].sprite = scene.physics.add.sprite(data.x, data.y, 'player_idle_front', 0);
        
        // If the texture failed to load, use the fallback
            if (!otherPlayers[data.id].sprite.texture.key || otherPlayers[data.id].sprite.texture.key === '__MISSING') {
                otherPlayers[data.id].sprite.setTexture('character_fallback');
        }
        
        // Set player properties
            otherPlayers[data.id].sprite.id = data.id;
            otherPlayers[data.id].sprite.setScale(2.1);
            otherPlayers[data.id].sprite.setTint(0xff0000); // Tint other players red to distinguish them
        
        // Force visibility
            otherPlayers[data.id].sprite.setVisible(true);
            otherPlayers[data.id].sprite.setActive(true);
        
        // Add username text above player
        otherPlayers[data.id].usernameText = scene.add.text(data.x, data.y - 20, data.username || 'Player', {
            font: '14px Arial',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
            align: 'center'
        }).setOrigin(0.5);
        
        // Add health bar
        otherPlayers[data.id].healthBar = scene.add.graphics();
        otherPlayers[data.id].healthBar.setDepth(999); // Set high depth
        updateHealthBar(otherPlayers[data.id].healthBar, data.x, data.y - 30, otherPlayers[data.id].health);
        
        // Add collision with obstacles
            if (obstacles) {
                scene.physics.add.collider(otherPlayers[data.id].sprite, obstacles);
            }
            
            // Add collision with bullets
            updateBulletCollisionForPlayer(scene, otherPlayers[data.id]);
        
        // Update texture based on direction
        updateOtherPlayerTexture(otherPlayers[data.id]);
        
            console.log('Successfully created other player:', data.id);
        return otherPlayers[data.id];
        } catch (error) {
            console.error('Error creating other player:', error);
            return null;
        }
    }
    
    /**
     * Update bullet collision detection for a player
     * @param {Phaser.Scene} scene - The current scene
     * @param {Object} otherPlayer - The other player object
     */
    function updateBulletCollisionForPlayer(scene, otherPlayer) {
        try {
            if (!scene || !scene.physics || !otherPlayer || !otherPlayer.sprite || !bullets) {
                console.error('Invalid parameters for updateBulletCollisionForPlayer:', { scene, otherPlayer, bullets });
                return;
            }
            
        console.log('Updating bullet collision for player:', otherPlayer.id);
        
        // Create a single collider for all bullets with this player if it doesn't exist
        if (!otherPlayer.bulletCollider) {
                otherPlayer.bulletCollider = scene.physics.add.overlap(bullets, otherPlayer.sprite, (sprite, bullet) => {
                // Only process if this bullet is from the local player
                if (bullet.active && bullet.shooterId === playerID) {
                        console.log('Bullet hit other player:', otherPlayer.id, bullet.bulletId);
                    
                    // Emit bullet hit event
                        sendWebSocketMessage('bulletHit', {
                            targetId: otherPlayer.id,
                        bulletId: bullet.bulletId
                    });
                    
                    // Disable the bullet
                    disableBullet(bullet);
                }
            });
            }
        } catch (error) {
            console.error('Error in updateBulletCollisionForPlayer:', error);
        }
    }
    
    /**
     * Update health bar graphics
     * @param {Phaser.GameObjects.Graphics} graphics - The graphics object
     * @param {number} x - The x position
     * @param {number} y - The y position
     * @param {number} health - The health value (0-10)
     */
    function updateHealthBar(graphics, x, y, health) {
        if (!graphics || !graphics.active) {
            return;
        }
        
        // Clear previous graphics
        graphics.clear();
        
        // Draw background
        graphics.fillStyle(0x000000, 0.8);
        graphics.fillRect(x - 25, y - 5, 50, 10);
        
        // Calculate health percentage
        const healthPercent = Math.max(0, Math.min(1, health / 10));
        
        // Choose color based on health
        let color;
        if (healthPercent > 0.6) {
            color = 0x00ff00; // Green
        } else if (healthPercent > 0.3) {
            color = 0xffff00; // Yellow
        } else {
            color = 0xff0000; // Red
        }
        
        // Draw health bar
        graphics.fillStyle(color, 1);
        graphics.fillRect(x - 25, y - 5, 50 * healthPercent, 10);
        
        // Ensure the healthbar has high depth to be visible
        graphics.setDepth(999);
    }

    /**
     * Update game state
     */
    function update(time, delta) {
        // Throttle updates to reduce CPU usage
        if (time - lastUpdateTime < updateThrottleMs) {
            return;
        }
        
        // Update the last update time
        lastUpdateTime = time;
        
        // Update bullets - ensure they keep moving
        bullets.children.iterate(function(bullet) {
            if (!bullet || !bullet.active) return true;
            
            // Check if bullet has a valid velocity
            if (bullet.body && (Math.abs(bullet.body.velocity.x) < 10 && Math.abs(bullet.body.velocity.y) < 10)) {
                // If bullet has stopped or is moving too slowly, reapply velocity
                if (bullet.originalVelocity) {
                    bullet.body.velocity.x = bullet.originalVelocity.x;
                    bullet.body.velocity.y = bullet.originalVelocity.y;
                    console.log(`Reapplied original velocity to bullet at (${bullet.x}, ${bullet.y}): (${bullet.originalVelocity.x}, ${bullet.originalVelocity.y})`);
                } else {
                    // If no original velocity, calculate from rotation
                    const angle = bullet.rotation;
                    bullet.body.velocity.x = bulletSpeed * Math.cos(angle);
                    bullet.body.velocity.y = bulletSpeed * Math.sin(angle);
                    console.log(`Reapplied calculated velocity to bullet at (${bullet.x}, ${bullet.y})`);
                }
            }
            
            // CRITICAL: Ensure bullet physics properties are maintained
            bullet.body.collideWorldBounds = false;
            
            // Periodically log bullet position and velocity for debugging (1% chance)
            if (Math.random() < 0.01) {
                console.log(`Bullet at (${bullet.x}, ${bullet.y}) with velocity (${bullet.body.velocity.x}, ${bullet.body.velocity.y})`);
            }
            
            // Check if bullet is too far from the map center
            const mapCenterX = map.width * map.scaleX / 2;
            const mapCenterY = map.height * map.scaleY / 2;
            const distance = Phaser.Math.Distance.Between(
                bullet.x, bullet.y,
                mapCenterX, mapCenterY
            );
            
            // If the bullet is too far from the map center, deactivate it
            // Increase the distance threshold to allow bullets to travel further
            const maxDistance = Math.max(map.width, map.height) * 10; // Increased from 5 to 10
            if (distance > maxDistance) {
                console.log(`Deactivating bullet at (${bullet.x}, ${bullet.y}) - too far from map center (${distance} > ${maxDistance})`);
                bullet.setActive(false);
                bullet.setVisible(false);
                
                // Clean up any colliders
                if (bullet.colliders) {
                    bullet.colliders.forEach(collider => {
                        if (collider) collider.destroy();
                    });
                    bullet.colliders = [];
                }
            }
            
            return true;
        });
        
        // Periodically clean up memory
        if (time - lastMemoryCleanupTime >= memoryCleanupIntervalMs) {
            lastMemoryCleanupTime = time;
            performMemoryCleanup(this);
        }
        
        // Flag to track if we need to send a network update
        let needsNetworkUpdate = false;
        
        // Move the player towards the target position if it exists
        if (targetPosition && !isEditorMode) {
            // Calculate the distance to the target
            const distance = Phaser.Math.Distance.Between(
                player.x, player.y,
                targetPosition.x, targetPosition.y
            );
            
            // If the player is close enough to the target, stop moving
            if (distance < 5) {
                player.body.reset(targetPosition.x, targetPosition.y);
                playerState = 'idle';
                updatePlayerAnimation();
                targetPosition = null;
                
                // Emit state update to server
                sendWebSocketMessage('playerStateUpdate', { state: 'idle' });
            } else {
                // Move the player towards the target
                this.physics.moveTo(player, targetPosition.x, targetPosition.y, SPEED);
                
                // Calculate the angle to determine direction
        const angle = Phaser.Math.Angle.Between(
                    player.x, player.y,
                    targetPosition.x, targetPosition.y
                );
                
                // Update player direction based on angle
                updatePlayerDirection(angle);
                
                // Update texture based on direction
                updatePlayerAnimation();
                
                // Mark that we need a network update
                needsNetworkUpdate = true;
            }
        }
        
        // Send network update if needed and throttled
        if (needsNetworkUpdate && time - lastNetworkUpdateTime >= networkUpdateThrottleMs) {
            lastNetworkUpdateTime = time;
                
                // Emit position update to server
                sendWebSocketMessage('playerMove', {
                    id: playerID,
                    x: player.x,
                    y: player.y,
                    direction: playerDirection,
                    state: playerState
                });
        }
        
        // Update username text position to follow player
        if (playerText) {
            playerText.setPosition(player.x, player.y - 20);
        }
        
        // Update health bar position
        if (playerHealthBar && player && player.active) {
            updateHealthBar(playerHealthBar, player.x, player.y - 30, playerHealth);
        }
        
        // Update other players with smooth movement
        Object.values(otherPlayers).forEach(otherPlayer => {
            if (otherPlayer.targetX !== undefined && otherPlayer.targetY !== undefined) {
                // Calculate distance to target
                const distance = Phaser.Math.Distance.Between(
                    otherPlayer.x, otherPlayer.y,
                    otherPlayer.targetX, otherPlayer.targetY
                );
                
                if (distance > 5) {
                    // Use direct lerp for smoother movement
                    // Use a higher lerp factor on mobile for more responsive movement
                    const lerpFactor = isMobile ? 0.3 : 0.2;
                    
                    // Lerp the position
                    otherPlayer.x = Phaser.Math.Linear(otherPlayer.x, otherPlayer.targetX, lerpFactor);
                    otherPlayer.y = Phaser.Math.Linear(otherPlayer.y, otherPlayer.targetY, lerpFactor);
                    
                    // Update direction based on movement
                    const angle = Phaser.Math.Angle.Between(
                        otherPlayer.x, otherPlayer.y,
                        otherPlayer.targetX, otherPlayer.targetY
                    );
                    updateOtherPlayerDirection(otherPlayer, angle);
                    
                    // Update texture
                    updateOtherPlayerTexture(otherPlayer);
        } else {
                    // Stop at target
                    otherPlayer.x = otherPlayer.targetX;
                    otherPlayer.y = otherPlayer.targetY;
                    otherPlayer.state = 'idle';
                    updateOtherPlayerTexture(otherPlayer);
            }
            
            // Update username text position
            if (otherPlayer.usernameText) {
                otherPlayer.usernameText.setPosition(otherPlayer.x, otherPlayer.y - 20);
            }
            
            // Update health bar position
            if (otherPlayer.healthBar && otherPlayer.sprite && otherPlayer.sprite.active) {
                updateHealthBar(otherPlayer.healthBar, otherPlayer.sprite.x, otherPlayer.sprite.y - 30, otherPlayer.health);
                otherPlayer.healthBar.setDepth(999); // Ensure high depth in each frame
            }
        });
        
        // Update mobile controls if on mobile
        if (isMobile && joystick && mobileControls.left) {
            // Update cooldown indicator on shoot button if needed
            if (time - lastFired < fireDelay && shootButton) {
                // For faster shooting, don't show seconds countdown, just make button gray
                shootButton.setTint(0x888888);
            } else if (shootButton && shootButton.text !== 'FIRE') {
                shootButton.setText('FIRE');
                shootButton.clearTint();
            } else if (shootButton) {
                shootButton.clearTint();
            }
        }
    }

    /**
     * Scan the game world to ensure all players are visible
     * @param {Phaser.Scene} scene - The current scene
     */
    function scanForExistingPlayers(scene) {
        console.log('Scanning for existing players...');
        console.log('Current otherPlayers:', Object.keys(otherPlayers));
        
        // Request all players to ensure we have the latest data
        console.log('Requesting all players to ensure visibility');
        
        // Send a request to get all players
        // Try different message types since we don't know what the server expects
        sendWebSocketMessage('getAllPlayers', {});
        sendWebSocketMessage('getPlayers', {});
        
        // Also send our own player info to make sure the server knows about us
        if (playerID && player) {
            sendWebSocketMessage('player_info', {
                id: playerID,
                username: playerUsername,
                x: player.x,
                y: player.y,
                direction: playerDirection,
                state: playerState
            });
        }
    }

    /**
     * Perform memory cleanup to prevent memory leaks
     * @param {Phaser.Scene} scene - The current scene
     */
    function performMemoryCleanup(scene) {
        console.log('Performing memory cleanup');
        
        // Clean up inactive bullets
        bullets.getChildren().forEach(bullet => {
            if (!bullet.active) {
                // Make sure the bullet is fully disabled
                disableBullet(bullet);
            }
        });
        
        // Clean up any physics bodies that might be lingering
        scene.physics.world.bodies.getArray().forEach(body => {
            const gameObject = body.gameObject;
            
            // If the game object is not active or not visible, disable its physics body
            if (gameObject && (!gameObject.active || !gameObject.visible)) {
                body.enable = false;
            }
        });
        
        // Force garbage collection if available
        if (window.gc) {
            try {
                window.gc();
                console.log('Forced garbage collection');
            } catch (e) {
                console.log('Could not force garbage collection');
            }
        }
    }

    /**
     * Create mobile controls with a joystick for movement and a shoot button
     * @param {Phaser.Scene} scene - The current scene
     */
    function createMobileControls(scene) {
        console.log('Creating mobile controls');
        
        const width = scene.cameras.main.width;
        const height = scene.cameras.main.height;
        
        // Create left side control area for movement
        mobileControls.left = scene.add.circle(width * 0.2, height * 0.7, 100);
        mobileControls.left.setStrokeStyle(2, 0xffffff, 0.5);
        mobileControls.left.setFillStyle(0xffffff, 0.2);
        mobileControls.left.setScrollFactor(0); // Fixed to camera
        mobileControls.left.setDepth(1000); // Ensure it's on top
        mobileControls.left.setInteractive();
        
        // Create joystick in the left control area
        joystick = scene.add.circle(width * 0.2, height * 0.7, 40);
        joystick.setStrokeStyle(2, 0xffffff, 0.8);
        joystick.setFillStyle(0xffffff, 0.5);
        joystick.setScrollFactor(0); // Fixed to camera
        joystick.setDepth(1001); // Ensure it's on top of the control area
        
        // Create right side control area for shooting
        mobileControls.right = scene.add.circle(width * 0.8, height * 0.7, 80);
        mobileControls.right.setStrokeStyle(2, 0xff0000, 0.5);
        mobileControls.right.setFillStyle(0xff0000, 0.2);
        mobileControls.right.setScrollFactor(0); // Fixed to camera
        mobileControls.right.setDepth(1000); // Ensure it's on top
        mobileControls.right.setInteractive();
        
        // Create shoot button text
        shootButton = scene.add.text(width * 0.8, height * 0.7, 'FIRE', {
            font: '16px Arial',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);
        shootButton.setScrollFactor(0); // Fixed to camera
        shootButton.setDepth(1001); // Ensure it's on top
        
        // Track if joystick is being used
        let joystickActive = false;
        
        // Handle joystick down
        mobileControls.left.on('pointerdown', (pointer) => {
            joystickActive = true;
            
            // Calculate joystick position
            updateJoystickPosition(scene, pointer);
        });
        
        // Handle joystick movement
        mobileControls.left.on('pointermove', (pointer) => {
            if (joystickActive && pointer.isDown) {
                // Update joystick position and player movement
                updateJoystickPosition(scene, pointer);
            }
        });
        
        // Handle joystick release
        mobileControls.left.on('pointerup', () => {
            joystickActive = false;
            
            // Reset joystick position
            joystick.x = mobileControls.left.x;
            joystick.y = mobileControls.left.y;
            
            // Stop movement immediately
            targetPosition = null;
            
            // Stop the player's physics body
            if (player && player.body) {
                player.body.reset(player.x, player.y);
                player.body.velocity.x = 0;
                player.body.velocity.y = 0;
            }
            
            // Update player state
            playerState = 'idle';
            updatePlayerAnimation();
            
            // Emit state update to server
            sendWebSocketMessage('playerStateUpdate', { state: 'idle' });
            
            // Force a position update to ensure sync
            sendWebSocketMessage('playerMove', {
                id: playerID,
                x: player.x,
                y: player.y,
                direction: playerDirection,
                state: 'idle'
            });
        });
        
        // Handle joystick out
        mobileControls.left.on('pointerout', () => {
            if (joystickActive) {
                joystickActive = false;
                
                // Reset joystick position
                joystick.x = mobileControls.left.x;
                joystick.y = mobileControls.left.y;
                
                // Stop movement immediately
                targetPosition = null;
                
                // Stop the player's physics body
                if (player && player.body) {
                    player.body.reset(player.x, player.y);
                    player.body.velocity.x = 0;
                    player.body.velocity.y = 0;
                }
                
                // Update player state
                playerState = 'idle';
                updatePlayerAnimation();
                
                // Emit state update to server
                sendWebSocketMessage('playerStateUpdate', { state: 'idle' });
                
                // Force a position update to ensure sync
                sendWebSocketMessage('playerMove', {
                    id: playerID,
                    x: player.x,
                    y: player.y,
                    direction: playerDirection,
                    state: 'idle'
                });
            }
        });
        
        // Handle shoot button press
        mobileControls.right.on('pointerdown', function() {
            if (playerID) {
                console.log('Mobile FIRE button pressed');
                
                // Visual feedback
                mobileControls.right.setFillStyle(0xff0000, 0.5);
                
                // Call fire bullet function with the scene
                fireBullet(scene);
                
                // Reset button style after a short delay
                scene.time.delayedCall(200, () => {
                    mobileControls.right.setFillStyle(0xff0000, 0.2);
                });
            }
        });

        // Make the shoot button text also interactive
        shootButton.setInteractive();
        shootButton.on('pointerdown', function() {
            if (playerID) {
                console.log('Mobile FIRE text button pressed');
                
                // Visual feedback
                mobileControls.right.setFillStyle(0xff0000, 0.5);
                
                // Call fire bullet function with the scene
                fireBullet(scene);
                
                // Reset button style after a short delay
                scene.time.delayedCall(100, () => {
                    mobileControls.right.setFillStyle(0xff0000, 0.2);
                });
            }
        });
    }
    
    /**
     * Update joystick position and player movement
     * @param {Phaser.Scene} scene - The current scene
     * @param {Phaser.Input.Pointer} pointer - The pointer (mouse/touch) object
     */
    function updateJoystickPosition(scene, pointer) {
        // Calculate joystick position
        const centerX = mobileControls.left.x;
        const centerY = mobileControls.left.y;
        const maxDistance = 60; // Maximum distance from center
        
        // Calculate distance from center
        let dx = pointer.x - centerX;
        let dy = pointer.y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Limit distance to maxDistance
        if (distance > maxDistance) {
            const angle = Math.atan2(dy, dx);
            dx = Math.cos(angle) * maxDistance;
            dy = Math.sin(angle) * maxDistance;
        }
        
        // Update joystick position
        joystick.x = centerX + dx;
        joystick.y = centerY + dy;
        
        // Calculate movement direction
        const angle = Math.atan2(dy, dx);
        updatePlayerDirection(angle);
        
        // Set target position based on joystick direction
        const moveDistance = 200; // How far to move
        targetPosition = {
            x: player.x + Math.cos(angle) * moveDistance,
            y: player.y + Math.sin(angle) * moveDistance
        };
        
        // Move player directly for more responsive control
        player.body.velocity.x = Math.cos(angle) * SPEED;
        player.body.velocity.y = Math.sin(angle) * SPEED;
        
        // Update player state to running
        playerState = 'run';
        updatePlayerAnimation();
        
        // Emit movement update to server immediately for better real-time sync
        sendWebSocketMessage('playerMove', {
            id: playerID,
            x: player.x,
            y: player.y,
            direction: playerDirection,
            state: 'run'
        });
    }

    /**
     * Handle collision between bullet and player
     * @param {Phaser.Scene} scene - The current scene
     * @param {Phaser.GameObjects.Sprite} bullet - The bullet sprite
     * @param {Phaser.GameObjects.Sprite} hitPlayer - The player that was hit
     */
    function handleBulletPlayerCollision(scene, bullet, hitPlayer) {
        try {
            // Determine if it's a local or remote player
            const isLocalPlayer = hitPlayer === player;
            
            // Skip collision if player is invulnerable
            if ((isLocalPlayer && player.isInvulnerable) || 
                (!isLocalPlayer && hitPlayer.getData('isInvulnerable'))) {
                console.log('Player is invulnerable, ignoring bullet hit');
                bullet.destroy();
                return;
            }
            
            // Get current health
            let health = isLocalPlayer ? playerHealth : 
                (hitPlayer.getData('health') || 10);
            
            // Reduce health by 1
            health = Math.max(0, health - 1);
            
            // Update health for the appropriate player
            if (isLocalPlayer) {
                playerHealth = health;
                if (playerHealthBar) {
                    updateHealthBar(playerHealthBar, hitPlayer.x, hitPlayer.y - 30, playerHealth);
                }
            } else if (hitPlayer.getData('otherPlayerRef')) {
                const otherPlayerRef = hitPlayer.getData('otherPlayerRef');
                otherPlayerRef.health = health;
                if (otherPlayerRef.healthBar) {
                    updateHealthBar(otherPlayerRef.healthBar, hitPlayer.x, hitPlayer.y - 30, health);
                }
            }
            
            // Flash player red to indicate damage
            hitPlayer.setTint(0xff0000);
            setTimeout(() => {
                if (hitPlayer.active) {
                    hitPlayer.clearTint();
                }
            }, 200);
            
            // Blood splatter effect
            const blood = scene.add.circle(bullet.x, bullet.y, 8, 0xbb0000, 0.8);
            blood.setDepth(101);
            
            // Fade out and destroy the blood
            scene.tweens.add({
                targets: blood,
                alpha: 0,
                scale: 3,
                duration: 300,
                onComplete: () => blood.destroy()
            });
            
            // Create damage text
            const damageText = scene.add.text(hitPlayer.x, hitPlayer.y - 40, '-1', {
                font: '16px Arial',
                fill: '#ff0000',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5);

            // Animate damage text
            scene.tweens.add({
                targets: damageText,
                y: damageText.y - 30,
                alpha: 0,
                duration: 800,
                onComplete: () => damageText.destroy()
            });

            // Screen shake effect
            scene.cameras.main.shake(100, 0.01);

            // Emit hit event to server
            sendWebSocketMessage('bulletHit', {
                targetId: isLocalPlayer ? playerID : hitPlayer.id,
                bulletId: bullet.bulletId,
                health: health
            });

            // Destroy the bullet
            bullet.destroy();

            // Check if player died (health <= 0)
            if (health <= 0) {
                // Emit death event
                sendWebSocketMessage('playerDied', {
                    id: isLocalPlayer ? playerID : hitPlayer.id
                });

                // Reset health to full (server will handle this, but we update locally for immediate feedback)
                if (isLocalPlayer) {
                    playerHealth = 10;
                    updateHealthBar(playerHealthBar, hitPlayer.x, hitPlayer.y - 30, 10);
                } else if (hitPlayer.getData('otherPlayerRef')) {
                    const otherPlayerRef = hitPlayer.getData('otherPlayerRef');
                    otherPlayerRef.health = 10;
                    updateHealthBar(otherPlayerRef.healthBar, hitPlayer.x, hitPlayer.y - 30, 10);
                }

                // Show respawn effect
                const respawnText = scene.add.text(hitPlayer.x, hitPlayer.y - 60, 'RESPAWNED', {
                    font: '18px Arial',
                    fill: '#00ff00',
                    stroke: '#000000',
                    strokeThickness: 3
                }).setOrigin(0.5);

                // Animate respawn text
                scene.tweens.add({
                    targets: respawnText,
                    y: respawnText.y - 40,
                    alpha: 0,
                    duration: 1500,
                    onComplete: () => respawnText.destroy()
                });
            }

        } catch (error) {
            console.error('Error in handleBulletPlayerCollision:', error);
        }
    }
