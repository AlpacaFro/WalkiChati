// server.js — PeerJS self-hosted signaling server
// Deploy this on Render.com (free tier)

const express = require('express');
const { ExpressPeerServer } = require('peer');
const http = require('http');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 9000;

app.use(cors({ origin: '*' }));

const server = http.createServer(app);

app.get('/', (req, res) => res.send('WalkiChat signaling server is running ✅'));

const peerServer = ExpressPeerServer(server, {
  allow_discovery: false,
  alive_timeout: 60000,
  proxied: true, // important when running behind Render's proxy
});

// peer@1.x: path is just /peerjs — no key in URL
app.use('/peerjs', peerServer);

peerServer.on('connection', client => console.log(`[+] Connected: ${client.getId()}`));
peerServer.on('disconnect', client => console.log(`[-] Disconnected: ${client.getId()}`));

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
