'use strict';

const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;
const PING_INTERVAL = 30_000;

// rooms: Map<roomId, Map<peerId, ws>>
const rooms = new Map();

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`Signaling server listening on :${PORT}`);
});

wss.on('connection', (ws) => {
  const peerId = uuidv4();
  let roomId = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        roomId = msg.room || 'default';
        if (!rooms.has(roomId)) rooms.set(roomId, new Map());
        const room = rooms.get(roomId);

        const peers = [...room.keys()];
        send(ws, { type: 'joined', peerId, peers });

        for (const [, peerWs] of room) {
          send(peerWs, { type: 'peer-joined', peerId });
        }

        room.set(peerId, ws);
        console.log(`[${roomId}] ${peerId} joined (${room.size} peers)`);
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const targetWs = room.get(msg.target);
        if (targetWs) {
          send(targetWs, {
            type: msg.type,
            from: peerId,
            sdp: msg.sdp,
            candidate: msg.candidate
          });
        }
        break;
      }

      case 'leave':
        cleanup(peerId, roomId);
        roomId = null;
        break;
    }
  });

  ws.on('close', () => cleanup(peerId, roomId));
  ws.on('error', () => cleanup(peerId, roomId));
});

function cleanup(peerId, roomId) {
  if (!roomId || !peerId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(peerId);
  for (const [, peerWs] of room) {
    send(peerWs, { type: 'peer-left', peerId });
  }
  if (room.size === 0) rooms.delete(roomId);
  console.log(`[${roomId}] ${peerId} left`);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));
