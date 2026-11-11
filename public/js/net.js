// LAN co-op link to server.js: the lobby, then lockstep steps (everyone's input for each 1/60 s step).
// Reconnects by itself, so a page opened before the server started joins when it comes up.
// A connection lost mid-run reconnects and picks up the run (the server resends the missed steps).
export const net = {
  ws: null, id: null, lobby: null, running: false, token: null, ticks: [], sent: 0, done: 0, heard: 0,
  onLobby: null, onStart: null, onClose: null, onLost: null, onResume: null,
  connect() {
    if (location.protocol !== 'http:') return;   // file: 또는 깃허브 페이지(https, 서버 없음) → 혼자 하기
    const ws = this.ws = new WebSocket(`ws://${location.host}/ws`);
    this.heard = Date.now();
    ws.onopen = () => { if (this.running) this.send({ t: 'resume', token: this.token, from: this.done + this.ticks.length }); };
    ws.onmessage = (m) => {
      this.heard = Date.now();
      const d = JSON.parse(m.data);
      if (d.t === 'hb') this.send({ t: 'hb' });
      else if (d.t === 'lobby') { this.id = d.you; this.lobby = d; this.onLobby?.(); }
      else if (d.t === 'start') { this.ticks = []; this.sent = this.done = 0; this.running = true; this.token = d.token; this.onStart?.(d); }
      else if (d.t === 'tick') { this.ticks.push(d); if (this.sent <= d.n) this.sent = d.n + 1; }   // steps the server filled while I was silent
      else if (d.t === 'resumed') this.onResume?.();
      else if (d.t === 'noresume' && this.running) { this.running = false; this.token = null; this.onClose?.(true); }
    };
    ws.onclose = () => this.closed(ws);
  },
  closed(ws) {
    if (ws !== this.ws) return;
    ws.onclose = ws.onmessage = ws.onopen = null; ws.close();
    this.ws = null; this.lobby = null;
    if (this.running) this.onLost?.(); else this.onClose?.(false);
    setTimeout(() => this.connect(), this.running ? 1000 : 3000);
  },
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); },
  // other players in the lobby who could join a game with me right now
  free() { return this.lobby ? this.lobby.players.filter((p) => p.id !== this.id && !p.busy && !p.inRun) : []; },
};
// The server says something every 0.5 s; silence means a dead link the browser has not noticed (Wi-Fi drop)
setInterval(() => { if (net.ws?.readyState === 1 && Date.now() - net.heard > 5000) net.closed(net.ws); }, 1000);
