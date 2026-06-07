// server.js — WalkiChat relay server
// WebSocket relay with text, GIF, push-to-talk audio, and active room list

const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 9000;

app.use(cors({ origin: '*' }));

app.get('/', (req, res) => {
  res.send('WalkiChat relay server running ✅');
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// rooms shape:
// {
//   roomId: {
//     host: WebSocket,
//     guest: WebSocket | null,
//     hostName: string
//   }
// }
const rooms = {};

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function createRoomId() {
  return Math.random().toString(36).slice(2, 10);
}

function getRoom(ws) {
  if (!ws.roomId) return null;
  return rooms[ws.roomId] || null;
}

function getPeer(ws) {
  const room = getRoom(ws);
  if (!room) return null;

  if (ws.role === 'host') return room.guest;
  if (ws.role === 'guest') return room.host;

  return null;
}

function relayToPeer(ws, msg) {
  const peer = getPeer(ws);
  send(peer, msg);
}

function getActiveRooms() {
  return Object.keys(rooms)
    .filter((roomId) => {
      const room = rooms[roomId];

      // Show only rooms that have a host and are waiting for a guest
      return room.host && room.host.readyState === WebSocket.OPEN && !room.guest;
    })
    .map((roomId) => ({
      roomId,
      hostName: rooms[roomId].hostName || 'Host'
    }));
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;
  ws.name = null;

  console.log('[WS] Client connected');

  ws.on('message', (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      send(ws, {
        type: 'error',
        msg: 'Invalid JSON message'
      });
      return;
    }

    console.log('[WS] Message:', msg.type);

    // Show rooms waiting for a second person
    if (msg.type === 'list_rooms') {
      send(ws, {
        type: 'rooms_list',
        rooms: getActiveRooms()
      });
      return;
    }

    // Host creates a room
    if (msg.type === 'create') {
      const id = createRoomId();
      const hostName = String(msg.name || 'Host').trim();

      rooms[id] = {
        host: ws,
        guest: null,
        hostName
      };

      ws.roomId = id;
      ws.role = 'host';
      ws.name = hostName;

      send(ws, {
        type: 'created',
        roomId: id
      });

      console.log(`[+] Room created: ${id}`);
      return;
    }

    // Guest joins a room
    if (msg.type === 'join') {
      const roomId = String(msg.roomId || '').trim();
      const name = String(msg.name || 'Friend').trim();

      if (!roomId) {
        send(ws, {
          type: 'error',
          msg: 'Missing room ID'
        });
        return;
      }

      const room = rooms[roomId];

      if (!room) {
        send(ws, {
          type: 'error',
          msg: 'Room not found'
        });
        return;
      }

      if (room.guest) {
        send(ws, {
          type: 'error',
          msg: 'Room full'
        });
        return;
      }

      room.guest = ws;

      ws.roomId = roomId;
      ws.role = 'guest';
      ws.name = name;

      send(ws, {
        type: 'joined',
        roomId
      });

      send(room.host, {
        type: 'peer_joined',
        name
      });

      console.log(`[+] Guest joined room: ${roomId}`);
      return;
    }

    if (!ws.roomId || !rooms[ws.roomId]) {
      send(ws, {
        type: 'error',
        msg: 'You are not in a room'
      });
      return;
    }

    if (msg.type === 'hello') {
      const name = String(msg.name || 'Friend').trim();

      relayToPeer(ws, {
        type: 'hello',
        name
      });

      return;
    }

    if (msg.type === 'text') {
      relayToPeer(ws, {
        type: 'text',
        text: String(msg.text || ''),
        ts: msg.ts || new Date().toISOString()
      });

      return;
    }

    if (msg.type === 'gif') {
      if (!msg.url) {
        send(ws, {
          type: 'error',
          msg: 'Missing GIF URL'
        });
        return;
      }

      relayToPeer(ws, {
        type: 'gif',
        url: String(msg.url),
        ts: msg.ts || new Date().toISOString()
      });

      return;
    }

    if (msg.type === 'ptt_start' || msg.type === 'ptt_stop') {
      relayToPeer(ws, {
        type: msg.type
      });

      return;
    }

    if (msg.type === 'audio') {
      relayToPeer(ws, {
        type: 'audio',
        data: msg.data,
        sampleRate: msg.sampleRate || 16000
      });

      return;
    }

    send(ws, {
      type: 'error',
      msg: `Unknown message type: ${msg.type}`
    });
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');

    if (!ws.roomId || !rooms[ws.roomId]) return;

    const roomId = ws.roomId;
    const peer = getPeer(ws);

    send(peer, {
      type: 'peer_disconnected'
    });

    // Current app is 1 host + 1 guest, so closing either side closes the room
    delete rooms[roomId];

    console.log(`[-] Room closed: ${roomId}`);
  });

  ws.on('error', (e) => {
    console.error('[WS] Error:', e.message);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
