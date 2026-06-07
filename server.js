// server.js — WalkiChat relay server
// All communication goes through this server via WebSocket (no P2P)

const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 9000;

app.use(cors({ origin: '*' }));
app.get('/', (req, res) => res.send('WalkiChat relay server running ✅'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// rooms: { roomId: { host: ws, guest: ws } }
const rooms = {};

function send(ws, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', ws => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      // Host creates a room
      const id = Math.random().toString(36).slice(2, 10);
      rooms[id] = { host: ws, guest: null };
      ws.roomId = id;
      ws.role = 'host';
      send(ws, { type: 'created', roomId: id });
      console.log(`[+] Room created: ${id}`);

    } else if (msg.type === 'join') {
      // Guest joins a room
      const room = rooms[msg.roomId];
      if (!room) { send(ws, { type: 'error', msg: 'Room not found' }); return; }
      if (room.guest) { send(ws, { type: 'error', msg: 'Room full' }); return; }
      room.guest = ws;
      ws.roomId = msg.roomId;
      ws.role = 'guest';
      // Notify both sides
      send(ws, { type: 'joined', roomId: msg.roomId });
      send(room.host, { type: 'peer_joined', name: msg.name });
      ws.peerName = msg.name;
      console.log(`[+] Guest joined room: ${msg.roomId}`);

    } else if (msg.type === 'hello') {
      // Exchange names
      const room = rooms[ws.roomId];
      if (!room) return;
      const peer = ws.role === 'host' ? room.guest : room.host;
      send(peer, { type: 'hello', name: msg.name });

    } else if (msg.type === 'text' || msg.type === 'gif') {
      // Relay chat message to peer
      const room = rooms[ws.roomId];
      if (!room) return;
      const peer = ws.role === 'host' ? room.guest : room.host;
      send(peer, msg);

    } else if (msg.type === 'ptt_start' || msg.type === 'ptt_stop') {
      // Relay PTT signal to peer
      const room = rooms[ws.roomId];
      if (!room) return;
      const peer = ws.role === 'host' ? room.guest : room.host;
      send(peer, msg);

    } else if (msg.type === 'audio') {
      // Relay audio chunk (base64) to peer
      const room = rooms[ws.roomId];
      if (!room) return;
      const peer = ws.role === 'host' ? room.guest : room.host;
      send(peer, msg);
    }
  });

  ws.on('close', () => {
    if (!ws.roomId || !rooms[ws.roomId]) return;
    const room = rooms[ws.roomId];
    const peer = ws.role === 'host' ? room.guest : room.host;
    send(peer, { type: 'peer_disconnected' });
    delete rooms[ws.roomId];
    console.log(`[-] Room closed: ${ws.roomId}`);
  });

  ws.on('error', e => console.error('WS error:', e.message));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
