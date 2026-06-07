// server.js — WalkiChat relay server
// All communication goes through this server via WebSocket (no P2P)

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
//     guest: WebSocket | null
//   }
// }
const rooms = {};

// Safe JSON sender
function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Find the other person inside the same room
function getPeer(ws) {
  if (!ws.roomId || !rooms[ws.roomId]) return null;

  const room = rooms[ws.roomId];

  if (ws.role === 'host') return room.guest;
  if (ws.role === 'guest') return room.host;

  return null;
}

// Relay one message to the connected peer
function relayToPeer(ws, msg) {
  const peer = getPeer(ws);
  send(peer, msg);
}

// Generate simple room ID
function createRoomId() {
  return Math.random().toString(36).slice(2, 10);
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;
  ws.peerName = null;

  console.log('[WS] Client connected');

  ws.on('message', (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      send(ws, { type: 'error', msg: 'Invalid JSON message' });
      return;
    }

    console.log('[WS] Message:', msg.type);

    // ─────────────────────────────
    // Create room
    // ─────────────────────────────
    if (msg.type === 'create') {
      const id = createRoomId();

      rooms[id] = {
        host: ws,
        guest: null
      };

      ws.roomId = id;
      ws.role = 'host';

      send(ws, {
        type: 'created',
        roomId: id
      });

      console.log(`[+] Room created: ${id}`);
      return;
    }

    // ─────────────────────────────
    // Join room
    // ─────────────────────────────
    if (msg.type === 'join') {
      const roomId = String(msg.roomId || '').trim();
      const name = String(msg.name || 'Friend').trim();

      if (!roomId) {
        send(ws, { type: 'error', msg: 'Missing room ID' });
        return;
      }

      const room = rooms[roomId];

      if (!room) {
        send(ws, { type: 'error', msg: 'Room not found' });
        return;
      }

      if (room.guest) {
        send(ws, { type: 'error', msg: 'Room full' });
        return;
      }

      room.guest = ws;
      ws.roomId = roomId;
      ws.role = 'guest';
      ws.peerName = name;

      // Confirm to guest
      send(ws, {
        type: 'joined',
        roomId
      });

      // Notify host
      send(room.host, {
        type: 'peer_joined',
        name
      });

      console.log(`[+] Guest joined room: ${roomId}`);
      return;
    }

    // From here, user must already be inside a room
    if (!ws.roomId || !rooms[ws.roomId]) {
      send(ws, { type: 'error', msg: 'You are not in a room' });
      return;
    }

    // ─────────────────────────────
    // Exchange names
    // ─────────────────────────────
    if (msg.type === 'hello') {
      const name = String(msg.name || 'Friend').trim();

      relayToPeer(ws, {
        type: 'hello',
        name
      });

      return;
    }

    // ─────────────────────────────
    // Text message relay
    // ─────────────────────────────
    if (msg.type === 'text') {
      relayToPeer(ws, {
        type: 'text',
        text: String(msg.text || ''),
        ts: msg.ts || new Date().toISOString()
      });

      return;
    }

    // ─────────────────────────────
    // GIF message relay
    // Frontend sends: { type: "gif", url, ts }
    // Server forwards it to the other person.
    // ─────────────────────────────
    if (msg.type === 'gif') {
      if (!msg.url) {
        send(ws, { type: 'error', msg: 'Missing GIF URL' });
        return;
      }

      relayToPeer(ws, {
        type: 'gif',
        url: String(msg.url),
        ts: msg.ts || new Date().toISOString()
      });

      return;
    }

    // ─────────────────────────────
    // Push-to-talk status relay
    // ─────────────────────────────
    if (msg.type === 'ptt_start' || msg.type === 'ptt_stop') {
      relayToPeer(ws, {
        type: msg.type
      });

      return;
    }

    // ─────────────────────────────
    // Audio chunk relay
    // ─────────────────────────────
    if (msg.type === 'audio') {
      relayToPeer(ws, {
        type: 'audio',
        data: msg.data,
        sampleRate: msg.sampleRate || 16000
      });

      return;
    }

    // Unknown message
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
