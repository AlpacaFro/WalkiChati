// server.js — PeerJS self-hosted signaling server
// Deploy this on Render.com (free tier)

const express = require('express');
const { ExpressPeerServer } = require('peer'); // peer@2.x uses ExpressPeerServer
const http = require('http');

const app = express();
const PORT = process.env.PORT || 9000;

const server = http.createServer(app);

// Health check route — keeps Render alive (ping with UptimeRobot)
app.get('/', (req, res) => res.send('WalkiChat signaling server is running ✅'));

// Mount PeerJS on /peerjs
const peerServer = ExpressPeerServer(server, {
  path: '/peerjs',
  allow_discovery: false,
  alive_timeout: 60000,
  key: 'walkichat',
});

app.use('/peerjs', peerServer);

peerServer.on('connection', client => {
  console.log(`[+] Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', client => {
  console.log(`[-] Peer disconnected: ${client.getId()}`);
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
