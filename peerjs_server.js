// server.js — PeerJS self-hosted signaling server
// Deploy this on Render.com (free tier)

const { PeerServer } = require('peer'); // peer npm package
const express = require('express');

const app = express();
const PORT = process.env.PORT || 9000;

// Health check route — keeps Render from spinning down (ping this via UptimeRobot)
app.get('/', (req, res) => res.send('WalkiChat signaling server is running ✅'));

// Mount PeerJS server on /peerjs path
const peerServer = PeerServer({
  port: PORT,
  path: '/peerjs',         // clients connect to /peerjs
  proxied: true,           // needed when behind Render's reverse proxy
  allow_discovery: false,  // don't expose peer list publicly
  alive_timeout: 60000,    // 60s keep-alive
  key: 'walkichat',        // optional auth key — must match client
});

peerServer.on('connection', client => {
  console.log(`[+] Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', client => {
  console.log(`[-] Peer disconnected: ${client.getId()}`);
});
