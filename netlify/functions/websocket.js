/**
 * IMPORTANT NOTE ABOUT WEBSOCKETS ON NETLIFY:
 * 
 * Netlify Functions are serverless functions that run in a stateless environment.
 * They don't support long-lived connections like WebSockets natively.
 * 
 * For a multiplayer game, you should:
 * 1. Use a dedicated WebSocket server (like Heroku, Railway, Render, etc.)
 * 2. Update your client code to connect to that server instead of trying to use Netlify Functions
 * 
 * This file is kept for reference but won't function as a WebSocket server.
 */

const { WebSocketServer } = require('ws');

// Store connected clients
const clients = new Map();

exports.handler = async function(event, context) {
  // Inform the client that WebSockets aren't supported directly
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "WebSockets are not supported directly on Netlify Functions.",
      solution: "Deploy a dedicated WebSocket server elsewhere and update your client to connect to it."
    }),
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  };
};

async function handleMessage(connectionId, message) {
  const client = clients.get(connectionId);
  if (!client) return;

  switch (message.type) {
    case 'player_info':
      client.playerInfo = message.data;
      await broadcast({
        type: 'playerJoined',
        data: {
          ...message.data,
          id: connectionId
        }
      }, connectionId);
      break;

    case 'playerMove':
      if (client.playerInfo) {
        client.playerInfo = {
          ...client.playerInfo,
          ...message.data
        };
      }
      await broadcast({
        type: 'playerMoved',
        data: {
          ...message.data,
          id: connectionId
        }
      }, connectionId);
      break;

    case 'playerShoot':
      await broadcast({
        type: 'bulletCreated',
        data: {
          ...message.data,
          id: connectionId
        }
      }, connectionId);
      break;

    case 'getAllPlayers':
      const players = Array.from(clients.entries())
        .filter(([id, c]) => id !== connectionId && c.playerInfo)
        .map(([_, c]) => c.playerInfo);
      
      await send(connectionId, {
        type: 'syncPlayers',
        data: { players }
      });
      break;
  }
}

async function broadcast(message, senderId) {
  const payload = JSON.stringify(message);
  const promises = Array.from(clients.entries())
    .filter(([id, _]) => id !== senderId)
    .map(([id, _]) => send(id, payload));
  
  await Promise.all(promises);
}

async function send(connectionId, message) {
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  
  return {
    statusCode: 200,
    body: payload,
    headers: {
      'Content-Type': 'application/json',
      'connection': 'keep-alive',
      'keep-alive': 'timeout=5, max=1000'
    }
  };
} 