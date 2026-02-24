'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const ICE_CONFIG = {
  iceServers: [
    {
      urls: 'turns:turn.personahub.app:443?transport=tcp',
      username: 'videocall',
      credential: '387363fac8bd483df102843e12b05c1d9ae708af'
    }
  ],
  iceTransportPolicy: 'relay'   // Force TURN relay — guarantees 443-only TCP
};

const WS_URL = 'wss://call.personahub.app/ws';
const ROOM   = 'default';

// ── State ─────────────────────────────────────────────────────────────────────
let localStream    = null;
let ws             = null;
let myPeerId       = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let audioMuted     = false;
let videoMuted     = false;

// peers: Map<peerId, RTCPeerConnection>
const peers = new Map();

// ICE candidates that arrived before setRemoteDescription — keyed by peerId
const iceQueue = new Map();

// ── DOM ───────────────────────────────────────────────────────────────────────
const joinScreen   = document.getElementById('join-screen');
const callScreen   = document.getElementById('call-screen');
const btnJoin      = document.getElementById('btn-join');
const errorMsg     = document.getElementById('error-msg');
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const localVideo   = document.getElementById('local-video');
const videoGrid    = document.getElementById('video-grid');
const waitingMsg   = document.getElementById('waiting-msg');
const btnMuteAudio = document.getElementById('btn-mute-audio');
const btnMuteVideo = document.getElementById('btn-mute-video');
const btnLeave     = document.getElementById('btn-leave');

// ── Entry point ───────────────────────────────────────────────────────────────
btnJoin.addEventListener('click', startCall);
btnLeave.addEventListener('click', leaveCall);
btnMuteAudio.addEventListener('click', toggleAudio);
btnMuteVideo.addEventListener('click', toggleVideo);

async function startCall() {
  errorMsg.textContent = '';
  btnJoin.disabled = true;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    btnJoin.disabled = false;
    errorMsg.textContent = mediaErrorMessage(err);
    return;
  }

  localVideo.srcObject = localStream;
  joinScreen.classList.add('hidden');
  callScreen.classList.add('active');
  connectSignaling();
}

// ── Signaling ─────────────────────────────────────────────────────────────────
function connectSignaling() {
  setStatus('connecting');
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    reconnectDelay = 1000;
    wsSend({ type: 'join', room: ROOM });
  });

  ws.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    handleSignal(msg);
  });

  ws.addEventListener('close', () => {
    if (callScreen.classList.contains('active')) {
      setStatus('connecting', 'Reconnecting…');
      scheduleReconnect();
    }
  });

  ws.addEventListener('error', () => {
    // close event fires next and handles reconnect
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    for (const [id, pc] of peers) { pc.close(); removePeerVideo(id); }
    peers.clear();
    iceQueue.clear();
    connectSignaling();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
}

async function handleSignal(msg) {
  switch (msg.type) {
    case 'joined':
      myPeerId = msg.peerId;
      setStatus('connected', `Connected · ${msg.peers.length} in call`);
      for (const peerId of msg.peers) {
        await createOffer(peerId);
      }
      updateWaiting();
      break;

    case 'peer-joined':
      // Joining peer will send us an offer — just update the waiting message
      setStatus('connected', `Connected · ${peers.size + 1} in call`);
      updateWaiting();
      break;

    case 'offer':
      await handleOffer(msg.from, msg.sdp);
      updateWaiting();
      break;

    case 'answer':
      if (peers.has(msg.from)) {
        const pc = peers.get(msg.from);
        await pc.setRemoteDescription(msg.sdp);
        await drainIceQueue(msg.from, pc);
      }
      break;

    case 'ice-candidate':
      if (!msg.candidate) break;
      if (peers.has(msg.from)) {
        const pc = peers.get(msg.from);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(msg.candidate).catch(() => {});
        } else {
          // Queue until remote description is set
          if (!iceQueue.has(msg.from)) iceQueue.set(msg.from, []);
          iceQueue.get(msg.from).push(msg.candidate);
        }
      }
      break;

    case 'peer-left':
      closePeer(msg.peerId);
      setStatus('connected', `Connected · ${peers.size} in call`);
      updateWaiting();
      break;
  }
}

async function drainIceQueue(peerId, pc) {
  const queued = iceQueue.get(peerId) || [];
  iceQueue.delete(peerId);
  for (const candidate of queued) {
    await pc.addIceCandidate(candidate).catch(() => {});
  }
}

// ── WebRTC ────────────────────────────────────────────────────────────────────
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(ICE_CONFIG);
  peers.set(peerId, pc);

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  pc.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice-candidate', target: peerId, candidate });
  });

  // track event: streams[0] is set when addTrack was called with a stream.
  // Guard against the rare case where streams is empty by building a stream.
  pc.addEventListener('track', (evt) => {
    const stream = evt.streams[0] ?? (() => {
      const s = new MediaStream();
      s.addTrack(evt.track);
      return s;
    })();
    addPeerVideo(peerId, stream);
  });

  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') {
      // Try ICE restart before giving up
      if (peers.get(peerId) === pc) pc.restartIce();
    }
    if (pc.connectionState === 'closed') {
      closePeer(peerId);
    }
  });

  return pc;
}

async function createOffer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  wsSend({ type: 'offer', target: peerId, sdp: pc.localDescription });
}

async function handleOffer(peerId, sdp) {
  if (peers.has(peerId)) peers.get(peerId).close();
  const pc = createPeerConnection(peerId);
  await pc.setRemoteDescription(sdp);
  await drainIceQueue(peerId, pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  wsSend({ type: 'answer', target: peerId, sdp: pc.localDescription });
}

function closePeer(peerId) {
  if (peers.has(peerId)) { peers.get(peerId).close(); peers.delete(peerId); }
  iceQueue.delete(peerId);
  removePeerVideo(peerId);
}

// ── Video grid ────────────────────────────────────────────────────────────────
function addPeerVideo(peerId, stream) {
  let tile = document.getElementById(`tile-${peerId}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${peerId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'peer-label';
    label.textContent = peerId.slice(0, 8);

    tile.appendChild(video);
    tile.appendChild(label);
    videoGrid.appendChild(tile);
    updateGridLayout();
  } else {
    tile.querySelector('video').srcObject = stream;
  }
}

function removePeerVideo(peerId) {
  const tile = document.getElementById(`tile-${peerId}`);
  if (tile) tile.remove();
  updateGridLayout();
}

function updateGridLayout() {
  const count = videoGrid.querySelectorAll('.video-tile').length;
  videoGrid.dataset.count = Math.min(count, 6);
}

function updateWaiting() {
  const count = videoGrid.querySelectorAll('.video-tile').length;
  waitingMsg.classList.toggle('hidden', count > 0);
}

// ── Controls ──────────────────────────────────────────────────────────────────
function toggleAudio() {
  audioMuted = !audioMuted;
  for (const track of localStream.getAudioTracks()) track.enabled = !audioMuted;
  btnMuteAudio.classList.toggle('active', audioMuted);
  btnMuteAudio.textContent = audioMuted ? '🔇' : '🎤';
}

function toggleVideo() {
  videoMuted = !videoMuted;
  for (const track of localStream.getVideoTracks()) track.enabled = !videoMuted;
  btnMuteVideo.classList.toggle('active', videoMuted);
  btnMuteVideo.textContent = videoMuted ? '🚫' : '📷';
  document.getElementById('local-pip').classList.toggle('muted-video', videoMuted);
}

function leaveCall() {
  clearTimeout(reconnectTimer);
  wsSend({ type: 'leave' });
  if (ws) { ws.close(); ws = null; }

  for (const [id, pc] of peers) { pc.close(); removePeerVideo(id); }
  peers.clear();
  iceQueue.clear();

  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  localVideo.srcObject = null;

  callScreen.classList.remove('active');
  joinScreen.classList.remove('hidden');
  btnJoin.disabled = false;
  errorMsg.textContent = '';
  audioMuted = false; videoMuted = false;
  btnMuteAudio.classList.remove('active'); btnMuteVideo.classList.remove('active');
  btnMuteAudio.textContent = '🎤'; btnMuteVideo.textContent = '📷';
  updateGridLayout();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text ?? { connecting: 'Connecting…', connected: 'Connected', error: 'Connection error' }[state];
}

function mediaErrorMessage(err) {
  switch (err.name) {
    case 'NotAllowedError':  return 'Camera/mic permission required to join.';
    case 'NotFoundError':    return 'No camera or microphone found on this device.';
    case 'NotReadableError': return 'Camera/mic is in use by another app.';
    default:                 return `Could not access camera/mic: ${err.message}`;
  }
}
