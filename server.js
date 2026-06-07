// server.js — WalkiChat relay server
// WebSocket relay with text, GIF, push-to-talk audio, active room list, and rejoin-friendly rooms

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
//     host: WebSocket | null,
//     guest: WebSocket | null,
//     hostName: string,
//     createdAt: number
//   }
// }
const rooms = {};

// Keep empty rooms alive for a short period.
// This lets someone return/rejoin after refresh or accidental close.
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

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

function isOpen(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function cleanupOldEmptyRooms() {
  const now = Date.now();

  Object.keys(rooms).forEach((roomId) => {
    const room = rooms[roomId];

    const hasHost = isOpen(room.host);
    const hasGuest = isOpen(room.guest);

    if (!hasHost && !hasGuest && now - room.createdAt > EMPTY_ROOM_TTL_MS) {
      delete rooms[roomId];
      console.log(`[cleanup] Removed empty room: ${roomId}`);
    }
  });
}

function getActiveRooms() {
  cleanupOldEmptyRooms();

  return Object.keys(rooms)
    .filter((roomId) => {
      const room = rooms[roomId];

      // Show rooms that are joinable:
      // 1. Host is waiting and no guest exists
      // 2. Or room exists but both disconnected recently, so either side can rejoin
      const hostOpen = isOpen(room.host);
      const guestOpen = isOpen(room.guest);

      return (hostOpen && !guestOpen) || (!hostOpen && !guestOpen);
    })
    .map((roomId) => ({
      roomId,
      hostName: rooms[roomId].hostName || 'Host'
    }));
}

function detachSocketFromRoom(ws) {
  if (!ws.roomId || !rooms[ws.roomId]) return;

  const roomId = ws.roomId;
  const room = rooms[roomId];

  if (ws.role === 'host' && room.host === ws) {
    room.host = null;
  }

  if (ws.role === 'guest' && room.guest === ws) {
    room.guest = null;
  }

  const peer = ws.role === 'host' ? room.guest : room.host;

  send(peer, {
    type: 'peer_disconnected'
  });

  ws.roomId = null;
  ws.role = null;

  // Do NOT delete the room immediately.
  // This is the fix for "cannot rejoin room".
  // The room survives for EMPTY_ROOM_TTL_MS.
  room.createdAt = room.createdAt || Date.now();

  console.log(`[-] User left room: ${roomId}`);
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

    if (msg.type === 'list_rooms') {
      send(ws, {
        type: 'rooms_list',
        rooms: getActiveRooms()
      });
      return;
    }

    if (msg.type === 'create') {
      const id = createRoomId();
      const hostName = String(msg.name || 'Host').trim();

      rooms[id] = {
        host: ws,
        guest: null,
        hostName,
        createdAt: Date.now()
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
          msg: 'Room not found or expired' 
        });
        return;
      }

      const hostOpen = isOpen(room.host);
      const guestOpen = isOpen(room.guest);

      // Case 1: host exists and guest slot is empty -> join as guest
      if (hostOpen && !guestOpen) {
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

      // Case 2: guest exists and host slot is empty -> rejoin as host side
      if (!hostOpen && guestOpen) {
        room.host = ws;
        room.hostName = name;

        ws.roomId = roomId;
        ws.role = 'host';
        ws.name = name;

        send(ws, {
          type: 'joined',
          roomId
        });

        send(room.guest, {
          type: 'peer_joined',
          name
        });

        console.log(`[+] Host side rejoined room: ${roomId}`);
        return;
      }

      // Case 3: both are gone but room is still within TTL -> first returner becomes host
      if (!hostOpen && !guestOpen) {
        room.host = ws;
        room.guest = null;
        room.hostName = name;
        room.createdAt = Date.now();

        ws.roomId = roomId;
        ws.role = 'host';
        ws.name = name;

        send(ws, {
          type: 'created',
          roomId
        });

        console.log(`[+] Empty room restored by host: ${roomId}`);
        return;
      }

      send(ws, {
        type: 'error',
        msg: 'Room full'
      });

      return;
    }

    if (msg.type === 'leave') {
      detachSocketFromRoom(ws);
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

    if (msg.type === 'audio_blob') {
      relayToPeer(ws, {
        type: 'audio_blob',
        data: msg.data,
        mimeType: msg.mimeType || 'audio/webm',
        ts: msg.ts || new Date().toISOString()
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
    detachSocketFromRoom(ws);
  });

  ws.on('error', (e) => {
    console.error('[WS] Error:', e.message);
  });
});

setInterval(cleanupOldEmptyRooms, 60 * 1000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
