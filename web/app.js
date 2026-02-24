'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const ICE_CONFIG = {
  iceServers: [
    {
      // UDP plain-TURN on 443 — preferred; lower latency when UDP is available.
      // Requires coturn listening-port=443 with no-tcp on the server.
      urls: 'turn:turn.personahub.app:443?transport=udp',
      username: 'videocall',
      credential: '387363fac8bd483df102843e12b05c1d9ae708af'
    },
    {
      // TCP TURNS on 443 — fallback; traverses strict firewalls via nginx SNI.
      urls: 'turns:turn.personahub.app:443?transport=tcp',
      username: 'videocall',
      credential: '387363fac8bd483df102843e12b05c1d9ae708af'
    }
  ],
  iceTransportPolicy: 'relay'   // Force TURN relay — guarantees 443-only paths
};

const WS_URL = 'wss://call.personahub.app/ws';
const ROOM   = 'default';

// Request up to 1080p/30fps; browser/camera will downscale gracefully.
const VIDEO_CONSTRAINTS = {
  width:     { ideal: 1920 },
  height:    { ideal: 1080 },
  frameRate: { ideal: 30   }
};

const MAX_VIDEO_BITRATE = 2_500_000; // 2.5 Mbps

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

// Stats state
let statsVisible  = false;
let statsInterval = null;
const prevBytes   = new Map();  // `${peerId}:${dir}:${ssrc}` → {bytes, ts}

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
const statsOverlay = document.getElementById('stats-overlay');

// ── Entry point ───────────────────────────────────────────────────────────────
btnJoin.addEventListener('click', startCall);
btnLeave.addEventListener('click', leaveCall);
btnMuteAudio.addEventListener('click', toggleAudio);
btnMuteVideo.addEventListener('click', toggleVideo);

// Backtick toggles the debug stats overlay during an active call.
document.addEventListener('keydown', e => {
  if (e.key === '`' && callScreen.classList.contains('active')) toggleStats();
});

async function startCall() {
  errorMsg.textContent = '';
  btnJoin.disabled = true;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: VIDEO_CONSTRAINTS,
      audio: true
    });
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
      setStatus('connecting', t('reconnecting'));
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
      setStatus('connected', t('inCall', msg.peers.length));
      for (const peerId of msg.peers) {
        await createOffer(peerId);
      }
      updateWaiting();
      break;

    case 'peer-joined':
      // Joining peer will send us an offer — just update the waiting message
      setStatus('connected', t('inCall', peers.size + 1));
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
      setStatus('connected', t('inCall', peers.size));
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
    if (pc.connectionState === 'connected') {
      applyMaxBitrate(pc, MAX_VIDEO_BITRATE);
    }
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

// Cap video sender bitrate. Must be called after SDP negotiation completes.
async function applyMaxBitrate(pc, bps) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    for (const enc of params.encodings) enc.maxBitrate = bps;
    await sender.setParameters(params).catch(() => {});
  }
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
  // Clean up per-peer byte counters used by the stats overlay.
  for (const key of prevBytes.keys()) {
    if (key.startsWith(`${peerId}:`)) prevBytes.delete(key);
  }
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
    // iOS Safari blocks autoplay on non-muted video; explicit play() required.
    video.play().catch(() => {});
  } else {
    const video = tile.querySelector('video');
    video.srcObject = stream;
    video.play().catch(() => {});
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

  // Reset stats
  clearInterval(statsInterval);
  statsInterval = null;
  statsVisible = false;
  prevBytes.clear();
  statsOverlay.classList.add('hidden');

  callScreen.classList.remove('active');
  joinScreen.classList.remove('hidden');
  btnJoin.disabled = false;
  errorMsg.textContent = '';
  audioMuted = false; videoMuted = false;
  btnMuteAudio.classList.remove('active'); btnMuteVideo.classList.remove('active');
  btnMuteAudio.textContent = '🎤'; btnMuteVideo.textContent = '📷';
  updateGridLayout();
}

// ── Stats overlay (backtick to toggle) ───────────────────────────────────────
function toggleStats() {
  statsVisible = !statsVisible;
  statsOverlay.classList.toggle('hidden', !statsVisible);
  if (statsVisible) {
    renderStats();
    statsInterval = setInterval(renderStats, 1000);
  } else {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

async function renderStats() {
  if (peers.size === 0) {
    statsOverlay.innerHTML = '<div class="stats-empty">No active peers</div>';
    return;
  }
  const parts = [];
  for (const [peerId, pc] of peers) {
    const report = await pc.getStats();
    parts.push(peerStatsHTML(peerId, report));
  }
  statsOverlay.innerHTML = parts.join('');
}

function peerStatsHTML(peerId, report) {
  const now = Date.now();

  // Index all stats by id; bucket the types we need.
  const byId = {};
  const inRtp = [], outRtp = [], remIn = [];
  let pair = null;
  for (const s of report.values()) {
    byId[s.id] = s;
    if (s.type === 'inbound-rtp')        inRtp.push(s);
    if (s.type === 'outbound-rtp')       outRtp.push(s);
    if (s.type === 'remote-inbound-rtp') remIn.push(s);
    // Pick the nominated candidate-pair with the most bytes sent (active path).
    if (s.type === 'candidate-pair' && s.nominated) {
      if (!pair || (s.bytesSent ?? 0) > (pair.bytesSent ?? 0)) pair = s;
    }
  }

  // RTT: prefer RTCP-based (remote-inbound-rtp), fall back to STUN ping (candidate-pair).
  let rtt = null;
  for (const s of remIn) {
    if (s.kind === 'video' && s.roundTripTime != null) rtt = Math.round(s.roundTripTime * 1000);
  }
  if (rtt == null && pair?.currentRoundTripTime != null) rtt = Math.round(pair.currentRoundTripTime * 1000);

  const bwe      = pair?.availableOutgoingBitrate != null
    ? (pair.availableOutgoingBitrate / 1e6).toFixed(1) : null;
  const lc       = pair ? byId[pair.localCandidateId] : null;
  const candType = lc?.candidateType === 'relay' ? 'TURN' : (lc?.candidateType ?? '?');

  // Delta-bytes helper → kbps. Stores previous sample keyed by peer+direction+ssrc.
  function kbps(dir, ssrc, bytes) {
    const key  = `${peerId}:${dir}:${ssrc}`;
    const prev = prevBytes.get(key);
    const rate = (prev && now > prev.ts)
      ? Math.round((bytes - prev.bytes) * 8 / ((now - prev.ts) / 1000) / 1000)
      : 0;
    prevBytes.set(key, { bytes, ts: now });
    return Math.max(0, rate);
  }

  // Inbound (what we receive from the remote peer).
  let vr = {}, ar = {};
  for (const s of inRtp) {
    const br    = kbps('recv', s.ssrc, s.bytesReceived ?? 0);
    const total = (s.packetsReceived ?? 0) + Math.max(0, s.packetsLost ?? 0);
    const loss  = total > 0 ? (Math.max(0, s.packetsLost ?? 0) / total * 100).toFixed(1) : '0.0';
    const codec = s.codecId ? (byId[s.codecId]?.mimeType?.split('/')[1] ?? '?') : '?';
    if (s.kind === 'video') {
      vr = { br, loss, codec,
             jitter:  s.jitter         != null ? Math.round(s.jitter * 1000)          : null,
             w:       s.frameWidth,
             h:       s.frameHeight,
             fps:     s.framesPerSecond != null ? Math.round(s.framesPerSecond)        : null,
             dropped: s.framesDropped ?? 0,
             nack:    s.nackCount ?? 0,
             pli:     s.pliCount  ?? 0 };
    } else {
      ar = { br, codec };
    }
  }

  // Outbound (what we send to the remote peer).
  let vs = {}, as_ = {};
  for (const s of outRtp) {
    const br    = kbps('send', s.ssrc, s.bytesSent ?? 0);
    const codec = s.codecId ? (byId[s.codecId]?.mimeType?.split('/')[1] ?? '?') : '?';
    if (s.kind === 'video') {
      vs = { br, codec,
             w:   s.frameWidth,
             h:   s.frameHeight,
             fps: s.framesPerSecond != null ? Math.round(s.framesPerSecond) : null,
             nack: s.nackCount ?? 0,
             pli:  s.pliCount  ?? 0 };
    } else {
      as_ = { br, codec };
    }
  }

  // Color helpers for key metrics.
  const rc  = ms => ms == null ? '' : ms < 100 ? 'good' : ms < 300 ? 'warn' : 'bad';
  const lc2 = p  => +p  <   1  ? 'good' : +p  <   3  ? 'warn' : 'bad';
  const jc  = ms => ms == null ? '' : ms <  30 ? 'good' : ms < 100 ? 'warn' : 'bad';

  const sv = (cls, v, sfx = '') => `<span class="sv ${cls}">${v}${sfx}</span>`;
  const sk = s => `<span class="sk">${s}</span>`;

  const rttStr    = sv(rc(rtt),           rtt ?? '—',         rtt        != null ? 'ms' : '');
  const lossStr   = sv(lc2(vr.loss ?? 0), vr.loss ?? '0.0',  '%');
  const jitterStr = sv(jc(vr.jitter),     vr.jitter ?? '—',  vr.jitter  != null ? 'ms' : '');

  const rows = [
    `<div class="sr">${sk('RTT')}${rttStr}${sk('type')}${sv('', candType)}${bwe ? sk('BWE') + sv('', bwe, 'M') : ''}</div>`,
    `<div class="sr">${sk('vid↑')}${sv('', `${vs.w ?? '?'}×${vs.h ?? '?'} ${vs.fps ?? '?'}fps ${vs.br ?? 0}k`)}${sk('↓')}${sv('', `${vr.w ?? '?'}×${vr.h ?? '?'} ${vr.fps ?? '?'}fps ${vr.br ?? 0}k`)}</div>`,
    `<div class="sr">${sk('aud↑')}${sv('', `${as_.br ?? 0}k`)}${sk('↓')}${sv('', `${ar.br ?? 0}k`)}</div>`,
    `<div class="sr">${sk('loss')}${lossStr}${sk('jitter')}${jitterStr}</div>`,
    `<div class="sr">${sk('codec')}${sv('', `${vs.codec ?? '?'}/${ar.codec ?? '?'}`)}${sk('drop')}${sv('', vr.dropped ?? 0)}${sk('NACK/PLI')}${sv('', `${vr.nack ?? 0}/${vr.pli ?? 0}`)}</div>`,
  ];

  return `<div class="sp"><div class="sp-id">${peerId.slice(0, 8)}</div>${rows.join('')}</div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text ?? { connecting: t('connecting'), connected: t('connected'), error: t('connError') }[state];
}

function mediaErrorMessage(err) {
  switch (err.name) {
    case 'NotAllowedError':  return t('errPermission');
    case 'NotFoundError':    return t('errNotFound');
    case 'NotReadableError': return t('errInUse');
    default:                 return t('errGeneric', err.message);
  }
}
