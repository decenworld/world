const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true });

// Store connected clients
const clients = new Map();

// Handle WebSocket connection
function handleWebSocket(event, context) {
  const { client } = event;
  const clientId = Math.random().toString(36).substring(7);
  
  clients.set(clientId, client);
  
  // Send initial ID to client
  client.send(JSON.stringify({
    type: 'playerID',
    data: { id: clientId }
  }));
  
  // Send current players to new client
  const players = [];
  clients.forEach((c, id) => {
    if (id !== clientId && c.playerInfo) {
      players.push(c.playerInfo);
    }
  });
  
  client.send(JSON.stringify({
    type: 'syncPlayers',
    data: { players }
  }));
  
  // Handle messages from client
  client.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'player_info':
          client.playerInfo = data.data;
          // Broadcast new player to others
          broadcast({
            type: 'playerJoined',
            data: data.data
          }, clientId);
          break;
          
        case 'playerMove':
          // Update stored player info
          if (client.playerInfo) {
            client.playerInfo.x = data.data.x;
            client.playerInfo.y = data.data.y;
            client.playerInfo.direction = data.data.direction;
            client.playerInfo.state = data.data.state;
          }
          // Broadcast movement to others
          broadcast({
            type: 'playerMoved',
            data: data.data
          }, clientId);
          break;
          
        case 'playerShoot':
          broadcast({
            type: 'bulletCreated',
            data: data.data
          }, clientId);
          break;
          
        case 'bulletHit':
          broadcast({
            type: 'playerHit',
            data: data.data
          }, clientId);
          break;
          
        case 'playerDied':
          broadcast({
            type: 'playerDied',
            data: data.data
          }, clientId);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  // Handle client disconnect
  client.on('close', () => {
    broadcast({
      type: 'playerDisconnected',
      data: { id: clientId }
    }, clientId);
    clients.delete(clientId);
  });
}

// Broadcast message to all clients except sender
function broadcast(message, senderId) {
  clients.forEach((client, id) => {
    if (id !== senderId && client.readyState === 1) {
      client.send(JSON.stringify(message));
    }
  });
}

exports.handler = function(event, context) {
  if (event.httpMethod === 'GET') {
    // Handle WebSocket upgrade
    if (event.headers.upgrade === 'websocket') {
      return {
        statusCode: 101,
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Accept': event.headers['sec-websocket-key']
        }
      };
    }
  }
  
  // Handle WebSocket messages
  if (event.requestContext && event.requestContext.ws) {
    handleWebSocket(event, context);
    return { statusCode: 200 };
  }
  
  return {
    statusCode: 400,
    body: 'Invalid request'
  };
}; 