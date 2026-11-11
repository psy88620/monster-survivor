// Game server (no dependencies): serves public/ and runs the LAN co-op lobby on ws://<this PC>:8080/ws.
// Co-op is lockstep: every PC simulates the whole run itself; the server only collects each player's input
// for step n and sends the bundle to everyone, so all PCs apply exactly the same inputs in the same order.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json', '.ico': 'image/x-icon', '.ogg': 'audio/ogg' };
const IPS = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }   // no ../ escapes
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- minimal WebSocket (RFC 6455): text frames, ping/close, no fragmentation (browsers do not fragment small messages)
function wsSend(c, obj) {
  const data = Buffer.from(JSON.stringify(obj)), n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), Buffer.alloc(8)]);
  if (n >= 65536) head.writeBigUInt64BE(BigInt(n), 2);
  if (!c.sock.destroyed) c.sock.write(Buffer.concat([head, data]));
}
function wsRead(c) {   // next complete frame from c.buf: a string, '' for control frames, null if incomplete
  const b = c.buf; if (b.length < 2) return null;
  const op = b[0] & 15, masked = b[1] & 128; let len = b[1] & 127, off = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; }
  const mask = masked ? b.subarray(off, off + 4) : null; if (masked) off += 4;
  if (b.length < off + len) return null;
  const data = Buffer.from(b.subarray(off, off + len)); if (mask) for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
  c.buf = b.subarray(off + len);
  if (op === 8) { c.sock.end(); return ''; }
  if (op === 9) { if (!c.sock.destroyed) c.sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); return ''; }   // ping -> pong
  return op === 1 ? data.toString('utf8') : '';
}

// ---- lobby and lockstep
// run: { ids: members, slow: members who timed out and are not waited for, off: Map(id -> when they lost connection), tok: Map(id -> resume token),
//        next, pending: Map(n -> { t: first input time, ins }), hist: every tick sent (resent after a reconnect), gone }
const clients = new Set();
let nextId = 1, run = null;
const STALL_MS = 1000;    // a player silent this long (hidden tab, slow PC) stops holding the others up: they get an empty input
const GRACE_MS = 90000;   // a lost connection may come back this long and carry on where it left off

function lobby() {
  const players = [...clients].map(c => ({ id: c.id, pick: c.pick, busy: c.busy, inRun: !!run?.ids.has(c.id) }));
  for (const c of clients) wsSend(c, { t: 'lobby', you: c.id, players, running: !!run, ips: IPS, port: PORT });
}
function tryStart() {   // everyone free has picked a monster (two or more players) -> go
  if (run) return;
  const ready = [...clients].filter(c => !c.busy);
  if (ready.length < 2 || ready.some(c => c.pick === null)) return;
  run = { ids: new Set(ready.map(c => c.id)), off: new Map(), slow: new Set(), tok: new Map(), next: 0, pending: new Map(), hist: [], gone: [] };
  const msg = { t: 'start', seed: crypto.randomInt(2 ** 32), players: ready.map(c => ({ id: c.id, pick: c.pick, meta: c.meta || {} })) };
  for (const c of ready) {
    const token = crypto.randomBytes(12).toString('hex'); run.tok.set(c.id, token);
    wsSend(c, { ...msg, token }); c.pick = null;
  }
  console.log(`co-op run started: ${ready.length} players`);
}
const online = () => [...run.ids].filter(id => !run.off.has(id));
function flush() {   // send every step whose inputs are in, in order; offline or stalled players get an empty input
  while (run) {
    const step = run.pending.get(run.next);
    if (!step) return;
    const missing = [...run.ids].filter(id => !(id in step.ins));
    const waitFor = missing.filter(id => !run.off.has(id) && !run.slow.has(id));
    if (waitFor.length && Date.now() - step.t < STALL_MS) return;
    for (const id of waitFor) run.slow.add(id);   // not waited for again until they send something
    for (const id of missing) step.ins[id] = {};
    const msg = { t: 'tick', n: run.next, ins: step.ins };
    if (run.gone.length) { msg.gone = run.gone; run.gone = []; }
    run.hist.push(msg);   // ponytail: whole run kept in memory (~15 MB for 40 min), trim if runs get longer
    for (const c of clients) if (run.ids.has(c.id) && !run.off.has(c.id)) wsSend(c, msg);
    run.pending.delete(run.next++);
  }
}
function endRun() { if (run) console.log('co-op run ended'); run = null; lobby(); }
function leaveRun(id) {   // out of this run for good: the others remove that player's monster
  if (!run?.ids.delete(id)) return;
  run.off.delete(id); run.slow.delete(id); run.tok.delete(id); run.gone.push(id);
  if (!online().length) return endRun();
  flush();
}
function onMessage(c, text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  if (m.t === 'in' && run?.ids.has(c.id) && Number.isInteger(m.n) && m.n >= run.next && m.n < run.next + 600) {
    if (!run.pending.has(m.n)) run.pending.set(m.n, { t: Date.now(), ins: {} });
    run.pending.get(m.n).ins[c.id] = m.d ?? {}; run.slow.delete(c.id);
    flush();
  } else if (m.t === 'resume') {   // a dropped player is back: same id, plus every tick they missed
    const id = [...(run?.tok || [])].find(([, tk]) => tk === m.token)?.[0];
    if (id === undefined || !Number.isInteger(m.from) || m.from < 0) return wsSend(c, { t: 'noresume' });
    for (const o of clients) if (o !== c && o.id === id) { clients.delete(o); o.sock.destroy(); }   // the old half-dead socket
    c.id = id; c.busy = false; c.pick = null; run.off.delete(id);
    wsSend(c, { t: 'resumed', you: id });
    for (const tk of run.hist.slice(m.from)) wsSend(c, tk);
    console.log(`player ${id} reconnected (${run.hist.length - m.from} steps resent)`);
    lobby();
  } else if (m.t === 'desync') {   // two PCs computed different worlds: log both so the cause can be found
    console.log(`[desync] step ${m.k}, player ${c.id}\n  mine:   ${m.mine}\n  theirs: ${m.theirs}`);
  } else if (m.t === 'pick' && Number.isInteger(m.i) && m.i >= 0 && m.i < 8) {   // meta: the player's permanent upgrades (checked again by each PC)
    c.pick = m.i; c.meta = m.meta && typeof m.meta === 'object' ? m.meta : {}; c.busy = false; tryStart(); lobby();
  }
  else if (m.t === 'unpick') { c.pick = null; lobby(); }
  else if (m.t === 'busy') { c.busy = !!m.on; if (c.busy) c.pick = null; tryStart(); lobby(); }
  else if (m.t === 'over' && run?.ids.has(c.id)) { leaveRun(c.id); lobby(); }   // only this PC's run is over (wiped, won, or out of step)
}
function drop(c) {
  if (!clients.delete(c)) return;
  if (run?.ids.has(c.id)) { run.off.set(c.id, Date.now()); flush(); }   // keep their place: Wi-Fi blips and sleeping laptops come back
  tryStart(); lobby();
}
setInterval(() => {
  const now = Date.now();
  for (const c of clients) {
    if (now - c.last > 15000) { c.sock.destroy(); continue; }   // silent socket (Wi-Fi gone, PC asleep): treat as closed
    wsSend(c, { t: 'hb' });
  }
  if (!run) return;
  for (const [id, t] of run.off) if (now - t > GRACE_MS) { console.log(`player ${id} did not come back`); leaveRun(id); }
  flush();   // stalled players time out even when no new input arrives
}, 500);

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url !== '/ws' || !key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const c = { sock, id: nextId++, pick: null, busy: false, buf: Buffer.alloc(0), last: Date.now() };
  clients.add(c); lobby();
  sock.on('data', (d) => {
    c.last = Date.now();
    c.buf = Buffer.concat([c.buf, d]);
    if (c.buf.length > 1 << 20) return sock.destroy();   // nobody sends 1 MB here
    let text; while ((text = wsRead(c)) !== null) if (text) onMessage(c, text);
  });
  sock.on('close', () => drop(c)); sock.on('error', () => drop(c));
});

server.listen(PORT, () => {
  console.log(`몬스터 서바이버 서버 실행 중: http://localhost:${PORT}`);
  for (const ip of IPS) console.log(`  같은 네트워크의 다른 PC: http://${ip}:${PORT}  (같이 하기)`);
});
