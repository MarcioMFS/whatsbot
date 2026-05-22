#!/bin/bash
# Apply after every Evolution container start.
# 1. Disables fireInitQueries (skips auto executeInitQueries on connect)
# 2. Increases UPLOAD_TIMEOUT to 300s (WhatsApp server is slow to ack pre-key upload from VPS)
set -e

CONTAINER=whatsbot-evolution-1

echo "[patch-evolution] Waiting for container to be ready..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" test -f /evolution/dist/main.js 2>/dev/null; then
    break
  fi
  sleep 2
done

docker exec "$CONTAINER" node -e "
const fs = require('fs');

// Patch 1: fireInitQueries in compiled bundle
const mainPath = '/evolution/dist/main.js';
let main = fs.readFileSync(mainPath, 'utf8');
if (main.includes('fireInitQueries:!0')) {
  main = main.replace('fireInitQueries:!0', 'fireInitQueries:!1');
  console.log('[patch] fireInitQueries -> false');
} else if (main.includes('fireInitQueries:!1')) {
  console.log('[patch] fireInitQueries already false');
}

// Patch 2: loadProxy missing await in connectToWhatsapp
const before = 'this.loadChatwoot(),this.loadSettings(),this.loadWebhook(),this.loadProxy(),this.messageProcessor';
const after  = 'this.loadChatwoot(),this.loadSettings(),this.loadWebhook(),await this.loadProxy(),this.messageProcessor';
if (main.includes(before)) {
  main = main.replace(before, after);
  console.log('[patch] loadProxy -> await added');
} else if (main.includes('await this.loadProxy()')) {
  console.log('[patch] loadProxy already awaited');
} else {
  console.log('[patch] WARNING: loadProxy pattern not found');
}

fs.writeFileSync(mainPath, main);

// Patch 2: Baileys Defaults/index.js — timeouts and keep-alive
const defPath = '/evolution/node_modules/baileys/lib/Defaults/index.js';
let def = fs.readFileSync(defPath, 'utf8');
if (def.includes('UPLOAD_TIMEOUT = 30000')) {
  def = def.replace('UPLOAD_TIMEOUT = 30000; // 30 seconds', 'UPLOAD_TIMEOUT = 300000; // 5 minutes');
}
if (def.includes('keepAliveIntervalMs: 30000')) {
  def = def.replace('keepAliveIntervalMs: 30000', 'keepAliveIntervalMs: 10000');
}
if (def.includes('defaultQueryTimeoutMs: 60000')) {
  def = def.replace('defaultQueryTimeoutMs: 60000', 'defaultQueryTimeoutMs: 300000');
}
fs.writeFileSync(defPath, def);
const defCheck = fs.readFileSync(defPath, 'utf8');
console.log('[patch] Defaults ->', defCheck.match(/UPLOAD_TIMEOUT = \d+/)[0], '|', defCheck.match(/keepAliveIntervalMs: \d+/)[0]);

// Patch 3: hardcode timeout in socket.js (bypass ESM import cache)
const sockPath = '/evolution/node_modules/baileys/lib/Socket/socket.js';
let sock = fs.readFileSync(sockPath, 'utf8');
const old = \"new Promise((_, reject) => setTimeout(() => reject(new Boom('Pre-key upload timeout', { statusCode: 408 })), UPLOAD_TIMEOUT))\";
const neu = \"new Promise((_, reject) => setTimeout(() => reject(new Boom('Pre-key upload timeout', { statusCode: 408 })), 300000))\";
if (sock.includes(old)) {
  sock = sock.replace(old, neu);
  fs.writeFileSync(sockPath, sock);
  console.log('[patch] socket.js UPLOAD_TIMEOUT hardcoded to 300000');
} else if (sock.includes('300000')) {
  console.log('[patch] socket.js already has 300000');
} else {
  console.log('[patch] WARNING: socket.js UPLOAD_TIMEOUT pattern not found');
}
"

echo "[patch-evolution] Done. Restarting Evolution..."
docker restart "$CONTAINER"
echo "[patch-evolution] Evolution restarted."
