// server.js — PeerJS self-hosted signaling server
// Deploy this on Render.com (free tier)

const express = require('express');
const { PeerServer } = require('peer'); // peer@1.x

const app = express();
const PORT = process.env.PORT || 9000;

// Health check — ping this with UptimeRobot to prevent Render sleep
app.get('/', (req, res) => res.send('WalkiChat signaling server is running ✅'));

app.listen(PORT, () => console.log(`Express running on port ${PORT}`));

// PeerJS server runs on its own port internally, proxied by Render
const peerServer = PeerServer({
  port: 9001,
  path: '/peerjs',
  allow_discovery: false,
  alive_timeout: 60000,
  key: 'walkichat',
  proxied: true,
});

peerServer.on('connection', client => {
  console.log(`[+] Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', client => {
  console.log(`[-] Peer disconnected: ${client.getId()}`);
});
