// server.js — PeerJS self-hosted signaling server
// Deploy this on Render.com (free tier)

const express = require('express');
const { ExpressPeerServer } = require('peer'); // peer@1.x supports ExpressPeerServer
const http = require('http');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 9000;

// Allow ALL origins (needed for local file:// and any hosted domain)
app.use(cors({ origin: '*' }));

const server = http.createServer(app);

// Health check
app.get('/', (req, res) => res.send('WalkiChat signaling server is running ✅'));

// Mount PeerJS on /peerjs
const peerServer = ExpressPeerServer(server, {
  path: '/',
  allow_discovery: false,
  alive_timeout: 60000,
  key: 'walkichat',
});

app.use('/peerjs', peerServer);

peerServer.on('connection', client => console.log(`[+] Connected: ${client.getId()}`));
peerServer.on('disconnect', client => console.log(`[-] Disconnected: ${client.getId()}`));

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
