# VIDEO CALL PWA — Implementation Specification

## Project Overview

Build a **Progressive Web App** that acts as a self-hosted video conferencing server. A single host runs the server; anyone who navigates to the URL sees **one button** ("Join Call"). Clicking it requests browser camera/microphone permissions and joins a video call.

**Absolute constraint:** ALL traffic — HTTP, WebSocket signaling, and TURN relay — MUST use **port 443 only**. No exceptions. No fallback ports. This must work behind the most restrictive corporate firewalls.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Port 443 (TLS)                    │
│                                                      │
│  ┌──────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  HTTPS/PWA   │  │   WSS    │  │  TURNS/STUN   │  │
│  │  Static Files │  │ Signaling│  │  (coturn)     │  │
│  │  + manifest  │  │  Server  │  │  Relay Server │  │
│  └──────┬───────┘  └────┬─────┘  └───────┬───────┘  │
│         │               │                │           │
│         └───────┬───────┘                │           │
│           nginx :443                coturn :443      │
│         (main server IP)         (TURN subdomain IP) │
└─────────────────────────────────────────────────────┘
```

### Two-IP / Two-Subdomain Strategy (Recommended)

Since both nginx and coturn need port 443 and TURN is raw TLS (not HTTP), the cleanest approach is:

- **`call.example.com`** → IP A → nginx :443 (serves PWA + WebSocket signaling)
- **`turn.example.com`** → IP B → coturn :443 (TURN/STUN relay)

Both IPs can live on the same machine using secondary IPs, or use separate containers/VMs.

### Single-IP Alternative (Advanced)

Use HAProxy with SNI-based routing on port 443:
- SNI `call.example.com` → nginx backend
- SNI `turn.example.com` → coturn backend

This works because TLS ClientHello includes the SNI hostname before decryption.

---

## Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Frontend | Vanilla HTML/CSS/JS | Zero build step, maximum simplicity |
| PWA | manifest.json + service worker | Installable, works offline (UI only) |
| Signaling | Node.js + `ws` library | Lightweight WebSocket server |
| Web Server | nginx | Reverse proxy, static files, WSS upgrade |
| TURN/STUN | coturn | Industry standard, supports TURNS on 443 |
| TLS | Let's Encrypt (certbot) | Free, automated certs |
| Containers | Docker + docker-compose | Reproducible deployment |

---

## Project Structure

```
videocall-pwa/
├── docker-compose.yml
├── .env.example
├── nginx/
│   ├── nginx.conf
│   └── Dockerfile
├── signaling/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── coturn/
│   └── turnserver.conf
├── web/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
└── certs/
    └── (TLS certificates — mounted at runtime)
```

---

## Component Specifications

### 1. Frontend PWA (`web/`)

#### `index.html`

Single-page app with:
- App title/logo area
- One large **"Join Call"** button (centered, prominent)
- A hidden video grid container that appears after joining
- Local video preview (small, corner pip)
- Remote video elements (dynamically added/removed)
- A **"Leave Call"** button (appears after joining)
- A **mute audio** and **mute video** toggle
- Connection status indicator (connecting / connected / disconnected)
- PWA meta tags: `<link rel="manifest" href="/manifest.json">`, theme-color, viewport

**Design requirements:**
- Mobile-first responsive design
- Dark background (#1a1a2e or similar) — video calls look better on dark
- The join button should be impossible to miss
- Video grid should use CSS Grid, adapting layout based on participant count:
  - 1 remote: full screen
  - 2 remotes: side by side
  - 3-4: 2x2 grid
  - 5+: flexible grid with scroll
- Local video: small overlay in bottom-right corner, mirrored horizontally via CSS `transform: scaleX(-1)`

#### `app.js`

This is the core application logic. Implement as an ES module or IIFE (no bundler).

**WebRTC Flow:**

```
1. User clicks "Join Call"
2. Request media: navigator.mediaDevices.getUserMedia({ video: true, audio: true })
3. Connect WebSocket to wss://call.example.com/ws
4. Send { type: "join", room: "default" } to signaling server
5. For each existing participant (signaling sends their IDs):
   a. Create RTCPeerConnection with ICE config
   b. Add local tracks to connection
   c. Create SDP offer → setLocalDescription → send offer via signaling
6. When receiving an offer from a new participant:
   a. Create RTCPeerConnection
   b. Add local tracks
   c. setRemoteDescription(offer) → createAnswer → setLocalDescription → send answer
7. Exchange ICE candidates via signaling (trickle ICE)
8. On remote track received → create <video> element, attach stream, add to grid
9. On participant disconnect → remove their video element, close RTCPeerConnection
```

**ICE Configuration (CRITICAL — 443 only):**

```javascript
const iceConfig = {
  iceServers: [
    {
      urls: "stun:turn.example.com:443"
    },
    {
      urls: "turns:turn.example.com:443?transport=tcp",
      username: "<from-env-or-config>",
      credential: "<from-env-or-config>"
    }
  ],
  iceTransportPolicy: "relay"  // IMPORTANT: Force TURN relay to guarantee 443-only
};
```

**IMPORTANT on `iceTransportPolicy`:**
- Set to `"relay"` to **guarantee** all media goes through TURN on 443. This is the only way to ensure no traffic leaks to random UDP ports.
- Set to `"all"` for better performance (direct P2P when possible), but this may use non-443 ports for STUN binding requests or direct connections. Only use `"all"` if the 443-only requirement is about firewall traversal (TURN on 443 as fallback) rather than a strict audit requirement.
- **Default recommendation: `"relay"`** to meet the stated absolute requirement.

**getUserMedia error handling:**
- `NotAllowedError` → show message: "Camera/mic permission required to join"
- `NotFoundError` → show message: "No camera or microphone found"
- `NotReadableError` → show message: "Camera/mic in use by another app"
- Always handle gracefully with user-friendly messages, never raw errors

**Reconnection logic:**
- If WebSocket disconnects, attempt reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Show "Reconnecting..." status to user
- On reconnect, re-join room and re-establish peer connections

#### `manifest.json`

```json
{
  "name": "Video Call",
  "short_name": "Call",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#1a1a2e",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

#### `sw.js` (Service Worker)

Minimal service worker for PWA installability. Cache the app shell (HTML, CSS, JS, icons) using cache-first strategy. Do NOT cache API/WebSocket calls.

```javascript
const CACHE_NAME = 'videocall-v1';
const SHELL_ASSETS = ['/', '/style.css', '/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/ws')) return; // Never cache WebSocket
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
```

#### `style.css`

- Use CSS custom properties for theming
- Mobile-first media queries
- Video grid using CSS Grid with `auto-fill` / `minmax()`
- Smooth transitions for video grid layout changes
- Button states: default, hover, active, disabled
- Join button: large, green (#4ecca3 or similar), rounded, centered
- Leave button: red, appears only when in call
- Controls bar at bottom with mute/video toggles

---

### 2. Signaling Server (`signaling/`)

#### `server.js`

A lightweight WebSocket server that handles room-based signaling.

**Protocol messages (JSON over WebSocket):**

```
Client → Server:
  { type: "join", room: "default" }
  { type: "offer", target: "<peerId>", sdp: <RTCSessionDescription> }
  { type: "answer", target: "<peerId>", sdp: <RTCSessionDescription> }
  { type: "ice-candidate", target: "<peerId>", candidate: <RTCIceCandidate> }
  { type: "leave" }

Server → Client:
  { type: "joined", peerId: "<yourId>", peers: ["<existingPeerId1>", ...] }
  { type: "peer-joined", peerId: "<newPeerId>" }
  { type: "offer", from: "<peerId>", sdp: <RTCSessionDescription> }
  { type: "answer", from: "<peerId>", sdp: <RTCSessionDescription> }
  { type: "ice-candidate", from: "<peerId>", candidate: <RTCIceCandidate> }
  { type: "peer-left", peerId: "<peerId>" }
```

**Implementation details:**
- Use `ws` npm package (not socket.io — less overhead)
- Assign each connection a UUID on connect
- Maintain a `Map<room, Set<{id, ws}>>` for room membership
- On "join": add to room, send back list of existing peers, broadcast "peer-joined" to others
- On "offer"/"answer"/"ice-candidate": relay to target peer (add `from` field)
- On disconnect: remove from room, broadcast "peer-left"
- **No authentication** for MVP (add later if needed)
- **Heartbeat**: ping/pong every 30 seconds to detect dead connections
- Bind to `0.0.0.0:8080` (nginx proxies from 443)

#### `package.json`

```json
{
  "name": "videocall-signaling",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "ws": "^8.16.0",
    "uuid": "^9.0.0"
  }
}
```

#### `Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server.js .
EXPOSE 8080
CMD ["node", "server.js"]
```

---

### 3. Nginx Configuration (`nginx/`)

#### `nginx.conf`

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;

    # Redirect HTTP → HTTPS
    server {
        listen 80;
        server_name call.example.com;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name call.example.com;

        ssl_certificate     /etc/letsencrypt/live/call.example.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/call.example.com/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers on;

        # Security headers
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options DENY always;
        add_header X-Content-Type-Options nosniff always;

        # CRITICAL for getUserMedia — requires Secure Context
        # Permissions-Policy allows camera and microphone
        add_header Permissions-Policy "camera=(self), microphone=(self)" always;

        # Serve PWA static files
        root /usr/share/nginx/html;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }

        # WebSocket signaling endpoint
        location /ws {
            proxy_pass http://signaling:8080;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_read_timeout 86400s;  # Keep WebSocket alive
            proxy_send_timeout 86400s;
        }
    }
}
```

#### `Dockerfile`

```dockerfile
FROM nginx:alpine
COPY nginx.conf /etc/nginx/nginx.conf
```

---

### 4. TURN Server (`coturn/`)

#### `turnserver.conf`

```ini
# Network
listening-port=443
tls-listening-port=443
alt-listening-port=0
alt-tls-listening-port=0

# CRITICAL: Only listen on TCP/TLS — no UDP to ensure 443-only
no-udp
no-dtls

# TLS certificates (same domain certs or separate)
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem

# Realm and auth
realm=turn.example.com
# Static user credentials (for MVP — use REST API auth for production)
user=videocall:CHANGE_THIS_PASSWORD

# Security
no-multicast-peers
no-cli
fingerprint
lt-cred-mech

# Logging
log-file=stdout
verbose

# Relay address range (restrict to private IPs if behind NAT)
# Uncomment and set to your server's public IP:
# external-ip=203.0.113.10
# relay-ip=203.0.113.10

# Deny relay to private networks (security)
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
allowed-peer-ip=0.0.0.0-255.255.255.255
```

**IMPORTANT NOTES:**
- `no-udp` and `no-dtls` ensure ALL relay traffic is TCP/TLS on port 443
- `external-ip` MUST be set to the server's public IP for proper relay
- The `user` line uses static credentials — replace with TURN REST API (time-limited credentials) for production
- Media quality will be slightly lower than UDP (TCP adds overhead), but this is the trade-off for strict 443-only compliance

---

### 5. Docker Compose (`docker-compose.yml`)

```yaml
version: "3.8"

services:
  nginx:
    build: ./nginx
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./web:/usr/share/nginx/html:ro
      - ./certs:/etc/letsencrypt:ro
    depends_on:
      - signaling
    restart: unless-stopped
    networks:
      - internal

  signaling:
    build: ./signaling
    expose:
      - "8080"
    restart: unless-stopped
    networks:
      - internal

  coturn:
    image: coturn/coturn:latest
    ports:
      - "<TURN_IP>:443:443/tcp"
    volumes:
      - ./coturn/turnserver.conf:/etc/turnserver.conf:ro
      - ./certs:/etc/letsencrypt:ro
    command: ["-c", "/etc/turnserver.conf"]
    restart: unless-stopped
    networks:
      - internal

networks:
  internal:
    driver: bridge
```

**Replace `<TURN_IP>`** with the secondary IP dedicated to coturn, or use host networking mode if running on separate hosts.

---

### 6. Environment / Configuration (`.env.example`)

```bash
# Domain configuration
DOMAIN=call.example.com
TURN_DOMAIN=turn.example.com

# TURN credentials (change these!)
TURN_USERNAME=videocall
TURN_PASSWORD=CHANGE_THIS_PASSWORD

# Optional: restrict room size
MAX_PARTICIPANTS_PER_ROOM=10
```

---

## Implementation Order

Build in this exact sequence. Each step should be testable before moving on.

### Phase 1: Static PWA Shell
1. Create `index.html` with join button, video grid, controls
2. Create `style.css` with responsive layout
3. Create `manifest.json` and `sw.js`
4. Generate placeholder icons (192x192 and 512x512 PNGs)
5. **Test:** Open in browser, verify PWA install prompt appears, button renders

### Phase 2: Signaling Server
1. Implement `server.js` with room management
2. Create Dockerfile, build and run
3. **Test:** Connect two WebSocket clients (use `wscat`), verify message relay works

### Phase 3: Local WebRTC (No TURN)
1. Implement `app.js` with getUserMedia and WebRTC peer connection logic
2. Wire up signaling via WebSocket
3. Set up nginx config (can use self-signed certs for local testing)
4. **Test:** Open two browser tabs on localhost, verify video call works (will work on LAN without TURN)

### Phase 4: TURN Server
1. Configure coturn with TLS on 443
2. Obtain Let's Encrypt certs for both domains
3. Update ICE config in `app.js` with TURN credentials
4. Set `iceTransportPolicy: "relay"` to force TURN usage for testing
5. **Test:** Connect from two different networks (e.g., phone on mobile data + laptop on WiFi), verify call works

### Phase 5: Docker Compose & Production
1. Create docker-compose.yml bringing all services together
2. Set up cert auto-renewal (certbot timer)
3. Test full deployment on target server
4. **Test:** Full end-to-end from external device

---

## Security Considerations

1. **TLS everywhere** — getUserMedia requires Secure Context (HTTPS). No exceptions.
2. **TURN credentials** — For MVP, static credentials are acceptable. For production, implement TURN REST API with time-limited tokens generated by the signaling server.
3. **No authentication on join** — MVP has no auth. For production, add a simple room PIN or token-based access.
4. **CORS** — Not needed since everything is same-origin (PWA served from same domain as signaling).
5. **Rate limiting** — Add nginx rate limiting on WebSocket connections to prevent abuse.
6. **CSP headers** — Add Content-Security-Policy to restrict script sources.
7. **Private IP leak** — `iceTransportPolicy: "relay"` also prevents WebRTC from leaking local/private IPs.

---

## Testing Checklist

- [ ] PWA installs on mobile (Android Chrome, iOS Safari)
- [ ] Camera/mic permissions requested on "Join" click
- [ ] Permission denial shows friendly error message
- [ ] Two participants can see/hear each other
- [ ] Video grid adjusts layout with 2, 3, 4+ participants
- [ ] Mute audio works (local mic muted, remote confirms no audio)
- [ ] Mute video works (local camera off, remote sees black/placeholder)
- [ ] Participant leaving removes their video tile
- [ ] Reconnection works after brief network interruption
- [ ] Works behind corporate firewall (443-only proof)
- [ ] `netstat` / `ss` on server confirms only port 443 is listening
- [ ] Chrome `chrome://webrtc-internals` shows TURN relay candidates only (no srflx/host if policy=relay)
- [ ] Service worker caches app shell for offline UI loading

---

## Performance Notes

- **TCP-only TURN** adds ~10-30ms latency and some overhead vs UDP. For small group calls (2-6 people) this is perfectly fine. For larger calls, consider allowing UDP on 443 via coturn's `--no-udp` removal (UDP 443 is unusual but technically possible).
- **Mesh topology** (each peer connects to every other peer) works for up to ~4-6 participants. Beyond that, you'd need an SFU (Selective Forwarding Unit) like mediasoup or Janus. This spec assumes mesh for simplicity.
- **Bandwidth:** Budget ~1.5-2 Mbps per participant for 720p video. The TURN server needs sufficient bandwidth for all relayed streams.

---

## Future Enhancements (Out of Scope for MVP)

- Screen sharing (`getDisplayMedia()`)
- Chat messages alongside video
- Room PINs / access control
- Recording (server-side via SFU)
- SFU for large rooms (mediasoup/Janus)
- TURN REST API for rotating credentials
- Participant names / display
- Noise suppression / echo cancellation tuning
- Bandwidth adaptation / simulcast
