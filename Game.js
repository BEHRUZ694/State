(function () {
'use strict';
const COLORS = ['#4f8cff', '#ff5a5a', '#3ddc84', '#ffc83d'];
const W = 1000, H = 640;
const $ = id => document.getElementById(id);
const rad = n => 13 + n.size * 5;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let mode = 'menu';            // 'host' | 'solo' | 'client' | 'menu'
let peer = null, hostConn = null;
let humans = [];              // host side: [{conn, name, left}]
let bots = 1, mapKey = 'italy', started = false, code = '';
let lastLobby = null;
let state = null, me = 0, loop = null;
let selected = new Set(), drag = null, frac = 1, ptr = { x: 0, y: 0 };
let shownResult = false;
const rp = new Map();         // smoothed render positions of squads

// ---------- screens ----------
function show(id) { for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id); }
function say(id, t) { $(id).textContent = t || ''; }

// ---------- menu ----------
const q = new URLSearchParams(location.search);
if (q.get('room')) $('joinCode').value = q.get('room').toUpperCase();
$('name').value = localStorage.getItem('sw_name') || '';
const getName = () => { const n = ($('name').value.trim() || 'Player').slice(0, 14); localStorage.setItem('sw_name', n); return n; };

$('btnCreate').onclick = createRoom;
$('btnJoin').onclick = joinRoom;
$('btnSolo').onclick = () => {
  resetNet(); mode = 'solo'; code = ''; bots = 2; started = false;
  humans = [{ conn: null, name: getName() }];
  show('lobby'); broadcastLobby();
};

function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

function resetNet() {
  if (loop) { clearInterval(loop); loop = null; }
  if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
  hostConn = null; humans = []; state = null; started = false; mode = 'menu'; rp.clear(); selected.clear();
}

// ---------- host networking ----------
function createRoom() {
  if (typeof Peer === 'undefined') return say('menuStatus', 'Could not load networking library. Check your connection.');
  resetNet(); say('menuStatus', 'Creating room…');
  mode = 'host'; bots = 0; humans = [{ conn: null, name: getName() }];
  openHostPeer(0);
}
function openHostPeer(tries) {
  code = genCode();
  peer = new Peer('stateio-' + code);
  peer.on('open', () => { say('menuStatus', ''); show('lobby'); broadcastLobby(); });
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && tries < 5) { try { peer.destroy(); } catch (e) {} return openHostPeer(tries + 1); }
    say('menuStatus', 'Network error: ' + err.type);
  });
  peer.on('connection', conn => {
    conn.on('open', () => {
      if (started || humans.length >= 4) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
      humans.push({ conn, name: 'Player ' + (humans.length + 1) });
      if (humans.length + bots > 4) bots = 4 - humans.length;
      broadcastLobby();
    });
    conn.on('data', m => hostMsg(conn, m));
    conn.on('close', () => {
      const idx = humans.findIndex(h => h.conn === conn);
      if (idx < 0) return;
      if (started) {
        humans[idx].left = true; humans[idx].conn = null;
        if (state) { state.players[idx].bot = true; state.players[idx].name += ' (bot)'; }
      } else { humans.splice(idx, 1); broadcastLobby(); }
    });
  });
}
function hostMsg(conn, m) {
  const idx = humans.findIndex(h => h.conn === conn);
  if (idx < 0 || !m) return;
  if (m.t === 'hello') { humans[idx].name = String(m.name || 'Player').slice(0, 14); if (!started) broadcastLobby(); }
  else if (m.t === 'cmd' && started && state && !state.over) {
    if (!Array.isArray(m.from) || !Number.isInteger(m.to)) return;
    sendTroops(idx, m.from, m.to, Math.min(1, Math.max(0.1, +m.frac || 1)));
  }
}
function lobbyView(i) { return { map: mapKey, names: humans.map(h => h.name), bots, you: i, code }; }
function broadcastLobby() {
  humans.forEach((h, i) => { if (h.conn) h.conn.send({ t: 'lobby', v: lobbyView(i) }); });
  renderLobby(lobbyView(0));
}

// ---------- client networking ----------
function joinRoom() {
  const c = $('joinCode').value.trim().toUpperCase();
  if (c.length < 4) return say('menuStatus', 'Enter the room code.');
  if (typeof Peer === 'undefined') return say('menuStatus', 'Could not load networking library.');
  resetNet(); mode = 'client'; code = c; say('menuStatus', 'Connecting…');
  peer = new Peer();
  const timeout = setTimeout(() => { if (!hostConn || !hostConn.open) { say('menuStatus', 'Could not connect. Check the code, or try another network.'); resetNet(); } }, 12000);
  peer.on('error', err => { clearTimeout(timeout); say('menuStatus', err.type === 'peer-unavailable' ? 'Room not found.' : 'Network error: ' + err.type); });
  peer.on('open', () => {
    hostConn = peer.connect('stateio-' + c, { reliable: true });
    hostConn.on('open', () => { clearTimeout(timeout); hostConn.send({ t: 'hello', name: getName() }); });
    hostConn.on('data', clientMsg);
    hostConn.on('close', () => { if (mode === 'client') { alert('Disconnected from host.'); leave(); } });
  });
}
function clientMsg(m) {
  if (m.t === 'full') { say('menuStatus', 'Room is full or already playing.'); resetNet(); }
  else if (m.t === 'lobby') { lastLobby = m.v; mapKey = m.v.map; if (!state || state.over) { $('result').classList.add('hidden'); show('lobby'); } renderLobby(m.v); }
  else if (m.t === 'start') applyStart(m);
  else if (m.t === 'snap') applySnap(m);
}

// ---------- lobby UI ----------
const mapsEl = $('maps');
Object.keys(MAPS).forEach(k => {
  const b = document.createElement('button'); b.textContent = MAPS[k].flag + ' ' + MAPS[k].name; b.dataset.k = k;
  b.onclick = () => { if (mode !== 'client') { mapKey = k; broadcastLobby(); } };
  mapsEl.appendChild(b);
});
function renderLobby(v) {
  lastLobby = v;
  const host = mode !== 'client';
  $('roomBox').classList.toggle('hidden', mode === 'solo');
  $('roomCode').textContent = code || '-----';
  let html = v.names.map((n, i) => `<li><span class="dot" style="background:${COLORS[i]}"></span>${esc(n)}${i === v.you ? ' (you)' : ''}${i === 0 ? ' 👑' : ''}</li>`).join('');
  for (let b = 0; b < v.bots; b++) { const i = v.names.length + b; html += `<li><span class="dot" style="background:${COLORS[i]}"></span>Bot ${b + 1} 🤖</li>`; }
  $('players').innerHTML = html;
  [...mapsEl.children].forEach(b => { b.classList.toggle('on', b.dataset.k === v.map); b.disabled = !host; });
  $('botN').textContent = v.bots;
  $('botMinus').disabled = !host || v.bots <= 0;
  $('botPlus').disabled = !host || v.names.length + v.bots >= 4;
  const total = v.names.length + v.bots;
  $('btnStart').disabled = !host || total < 2;
  $('btnStart').textContent = host ? (total < 2 ? 'Need 2+ players (add friends or bots)' : 'Start game') : 'Waiting for host…';
  drawPreview(v.map);
}
function drawPreview(key) {
  const c = $('preview'), x = c.getContext('2d'), m = buildMap(key);
  x.clearRect(0, 0, c.width, c.height); x.save(); x.scale(c.width / W, c.height / H);
  paintMap(x, m);
  for (const n of m.nodes) { x.beginPath(); x.arc(n.x, n.y, rad(n) * 0.8, 0, 7); x.fillStyle = '#7b8794'; x.fill(); }
  x.restore();
}
$('botMinus').onclick = () => { if (bots > 0) { bots--; broadcastLobby(); } };
$('botPlus').onclick = () => { if (humans.length + bots < 4) { bots++; broadcastLobby(); } };
$('btnStart').onclick = startGame;
$('btnLobbyLeave').onclick = leave;
$('btnLeave').onclick = () => { if (confirm('Leave the game?')) leave(); };
$('btnShare').onclick = async () => {
  const link = location.origin + location.pathname + '?room=' + code;
  try { if (navigator.share) await navigator.share({ title: 'StateWars', text: 'Join my game! Code ' + code, url: link }); else { await navigator.clipboard.writeText(link); say('lobbyStatus', 'Link copied!'); } }
  catch (e) { say('lobbyStatus', link); }
};
$('btnFrac').onclick = () => { frac = frac === 1 ? 0.5 : 1; $('btnFrac').textContent = 'Send: ' + frac * 100 + '%'; };
$('btnBack').onclick = () => {
  $('result').classList.add('hidden');
  if (mode === 'client') { show('lobby'); if (lastLobby) renderLobby(lastLobby); return; }
  if (loop) { clearInterval(loop); loop = null; }
  started = false; state = null; humans = humans.filter(h => !h.left); show('lobby'); broadcastLobby();
};
function leave() { resetNet(); $('result').classList.add('hidden'); show('menu'); }

// ---------- game setup ----------
function startGame() {
  const total = humans.length + bots;
  if (total < 2) return;
  const m = buildMap(mapKey);
  const players = humans.map(h => ({ name: h.name, bot: false }));
  for (let i = 0; i < bots; i++) players.push({ name: 'Bot ' + (i + 1), bot: true, t: 1 + Math.random() });
  const nodes = m.nodes.map(n => ({ ...n, owner: -1, troops: Math.round(8 + n.size * 6 + Math.random() * 8) }));
  players.forEach((p, i) => { const n = nodes[m.starts[i]]; n.owner = i; n.troops = 30; n.size = 2; });
  state = { map: m, nodes, squads: [], players, nextId: 1, over: false, winner: -1 };
  started = true; me = 0; shownResult = false;
  const init = nodes.map(n => [n.owner, n.troops, n.size]);
  humans.forEach((h, i) => { if (h.conn) h.conn.send({ t: 'start', map: mapKey, players: players.map(p => ({ name: p.name, bot: p.bot })), you: i, n: init }); });
  enterGame();
  let last = performance.now(), k = 0;
  loop = setInterval(() => {
    const now = performance.now(), dt = Math.min(1, (now - last) / 1000); last = now;
    const steps = Math.min(20, Math.max(1, Math.round(dt / 0.033)));
    for (let i = 0; i < steps && !state.over; i++) tick(dt / steps);
    if (state.over || ++k % 2 === 0) broadcastSnap();
    if (state.over) { clearInterval(loop); loop = null; }
  }, 33);
}
function applyStart(m) {
  const map = buildMap(m.map);
  const nodes = map.nodes.map((n, i) => ({ ...n, owner: m.n[i][0], troops: m.n[i][1], size: m.n[i][2] }));
  state = { map, nodes, squads: [], players: m.players, nextId: 1, over: false, winner: -1 };
  me = m.you; started = true; shownResult = false; enterGame();
}
function enterGame() {
  selected.clear(); drag = null; rp.clear(); $('result').classList.add('hidden');
  show('game'); requestAnimationFrame(frame);
}

// ---------- simulation (host only) ----------
function tick(dt) {
  const s = state;
  for (const n of s.nodes) {
    if (n.owner < 0) continue;
    const cap = 30 + 20 * n.size;
    if (n.troops < cap) n.troops = Math.min(cap, n.troops + (0.8 + 0.4 * n.size) * dt);
    else n.troops = Math.max(cap, n.troops - 0.6 * dt);
  }
  const dead = new Set();
  for (const sq of s.squads) {
    const t = s.nodes[sq.to], dx = t.x - sq.x, dy = t.y - sq.y, d = Math.hypot(dx, dy), step = 110 * dt;
    if (d <= step) { arrive(sq, t); dead.add(sq); } else { sq.x += dx / d * step; sq.y += dy / d * step; }
  }
  const live = s.squads.filter(a => !dead.has(a));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (dead.has(a) || dead.has(b) || a.o === b.o) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 12) {
      if (a.c > b.c) { a.c -= b.c; dead.add(b); } else if (b.c > a.c) { b.c -= a.c; dead.add(a); } else { dead.add(a); dead.add(b); }
    }
  }
  s.squads = s.squads.filter(a => !dead.has(a));
  s.players.forEach((p, i) => { if (p.bot && alive(i)) { p.t = (p.t || 0) - dt; if (p.t <= 0) { p.t = 0.9 + Math.random() * 1.2; botThink(i); } } });
  const al = s.players.map((p, i) => i).filter(alive);
  if (al.length <= 1) { s.over = true; s.winner = al.length ? al[0] : -1; }
}
function alive(i) { return state.nodes.some(n => n.owner === i) || state.squads.some(q => q.o === i); }
function arrive(sq, n) {
  if (n.owner === sq.o) n.troops += sq.c;
  else { n.troops -= sq.c; if (n.troops < 0) { n.owner = sq.o; n.troops = -n.troops; } }
}
function sendTroops(owner, from, to, f) {
  const s = state; if (!s || to < 0 || to >= s.nodes.length) return;
  for (const i of from) {
    if (!Number.isInteger(i) || i < 0 || i >= s.nodes.length || i === to) continue;
    const n = s.nodes[i]; if (n.owner !== owner) continue;
    const amt = Math.floor(n.troops * f); if (amt < 1) continue;
    n.troops -= amt; s.squads.push({ id: s.nextId++, o: owner, x: n.x, y: n.y, c: amt, to });
  }
}
function botThink(p) {
  const s = state, mine = s.nodes.filter(n => n.owner === p);
  for (const n of mine) {
    if (n.troops < 14 || Math.random() < 0.3) continue;
    const send = Math.floor(n.troops * 0.7);
    let best = null, bs = 1e9;
    for (const t of s.nodes) {
      if (t.owner === p) continue;
      const d = Math.hypot(t.x - n.x, t.y - n.y);
      const need = t.troops + (t.owner >= 0 ? (0.8 + 0.4 * t.size) * d / 110 : 0) + 3;
      if (send <= need) continue;
      const score = d * 0.05 + t.troops - t.size * 3;
      if (score < bs) { bs = score; best = t; }
    }
    if (best) sendTroops(p, [n.i], best.i, 0.7);
    else if (n.troops > 0.9 * (30 + 20 * n.size)) {
      // reinforce the frontier: nearest enemy-adjacent own node
      const t = mine.filter(o => o !== n).sort((a, b) => a.troops - b.troops)[0];
      if (t) sendTroops(p, [n.i], t.i, 0.5);
    }
  }
}
function broadcastSnap() {
  const s = state;
  const m = { t: 'snap', n: s.nodes.map(n => [n.owner, Math.round(n.troops * 10) / 10]), s: s.squads.map(a => [a.id, a.o, Math.round(a.x), Math.round(a.y), a.c, a.to]), over: s.over, winner: s.winner };
  humans.forEach(h => { if (h.conn) h.conn.send(m); });
}
function applySnap(m) {
  if (!state) return;
  m.n.forEach((a, i) => { state.nodes[i].owner = a[0]; state.nodes[i].troops = a[1]; });
  state.squads = m.s.map(a => ({ id: a[0], o: a[1], x: a[2], y: a[3], c: a[4], to: a[5] }));
  state.over = m.over; state.winner = m.winner;
}

// ---------- rendering ----------
const cv = $('cv'), ctx = cv.getContext('2d');
let sc = 1, ox = 0, oy = 0, lastT = performance.now(), hudT = 0;

function paintMap(x, m) {
  x.fillStyle = '#18243a'; x.strokeStyle = '#34496d'; x.lineWidth = 3; x.lineJoin = 'round';
  for (const poly of m.polys) { x.beginPath(); poly.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.fill(); x.stroke(); }
}
function frame(now) {
  if ($('game').classList.contains('hidden') || !state) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const dpr = window.devicePixelRatio || 1, cw = cv.clientWidth, ch = cv.clientHeight;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  sc = Math.min(cw / W, ch / H); ox = (cw - W * sc) / 2; oy = (ch - H * sc) / 2;
  ctx.translate(ox, oy); ctx.scale(sc, sc);
  paintMap(ctx, state.map);
  const col = o => o < 0 ? '#7b8794' : COLORS[o];
  // territory glow
  for (const n of state.nodes) if (n.owner >= 0) { ctx.beginPath(); ctx.arc(n.x, n.y, rad(n) + 22, 0, 7); ctx.fillStyle = col(n.owner) + '22'; ctx.fill(); }
  // drag arrow
  if (drag && drag.moved) {
    ctx.setLineDash([8, 8]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath();
    const srcs = new Set(selected); srcs.add(drag.from.i);
    srcs.forEach(i => { const n = state.nodes[i]; ctx.moveTo(n.x, n.y); ctx.lineTo(ptr.x, ptr.y); }); ctx.stroke(); ctx.setLineDash([]);
  }
  // nodes
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const n of state.nodes) {
    const r = rad(n);
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fillStyle = col(n.owner); ctx.fill();
    ctx.lineWidth = selected.has(n.i) ? 5 : 2; ctx.strokeStyle = selected.has(n.i) ? '#fff' : 'rgba(0,0,0,.45)'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (12 + n.size * 2) + 'px system-ui'; ctx.fillText(Math.floor(n.troops), n.x, n.y + 1);
    ctx.font = '11px system-ui'; ctx.fillStyle = '#9fb0c8'; ctx.fillText(n.name, n.x, n.y + r + 11);
  }
  // squads (smoothed)
  const ids = new Set();
  for (const a of state.squads) {
    ids.add(a.id);
    let p = rp.get(a.id); if (!p) { p = { x: a.x, y: a.y }; rp.set(a.id, p); }
    const k = Math.min(1, dt * 14); p.x += (a.x - p.x) * k; p.y += (a.y - p.y) * k;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.fillStyle = col(a.o); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#0b1220'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.fillText(a.c, p.x, p.y + 1);
  }
  for (const id of rp.keys()) if (!ids.has(id)) rp.delete(id);
  if (now - hudT > 250) { hudT = now; updateHud(); }
  if (state.over && !shownResult) showResult();
}
function updateHud() {
  const st = state.players.map(() => ({ t: 0, n: 0, sq: 0 }));
  state.nodes.forEach(n => { if (n.owner >= 0) { st[n.owner].t += n.troops; st[n.owner].n++; } });
  state.squads.forEach(a => { st[a.o].t += a.c; st[a.o].sq++; });
  $('hud').innerHTML = state.players.map((p, i) =>
    `<span class="chip ${st[i].n + st[i].sq ? '' : 'dead'}"><span class="dot" style="background:${COLORS[i]}"></span>${esc(p.name)}${i === me ? ' ★' : ''} · ${Math.floor(st[i].t)} · ${st[i].n}🏙</span>`).join('');
}
function showResult() {
  shownResult = true;
  const w = state.winner;
  $('resultText').textContent = w < 0 ? 'Draw' : w === me ? '🏆 You win!' : (state.players[w].name + ' wins');
  $('btnBack').textContent = mode === 'client' ? 'Back to lobby' : 'Back to lobby';
  $('result').classList.remove('hidden');
}

// ---------- input ----------
function toWorld(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - ox) / sc, y: (e.clientY - r.top - oy) / sc }; }
function nodeAt(p) {
  let best = null, bd = 1e9;
  for (const n of state.nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < rad(n) + 14 && d < bd) { best = n; bd = d; } }
  return best;
}
function issue(from, to) {
  if (!from.length) return;
  if (mode === 'client') hostConn.send({ t: 'cmd', from, to, frac });
  else sendTroops(me, from, to, frac);
}
cv.addEventListener('pointerdown', e => {
  if (!state || state.over) return;
  const p = toWorld(e); ptr = p; const n = nodeAt(p);
  drag = n && n.owner === me ? { from: n, moved: false, sx: p.x, sy: p.y } : null;
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!state) return; ptr = toWorld(e);
  if (drag && Math.hypot(ptr.x - drag.sx, ptr.y - drag.sy) > 10) drag.moved = true;
});
cv.addEventListener('pointerup', e => {
  if (!state || state.over) { drag = null; return; }
  const p = toWorld(e), t = nodeAt(p);
  if (drag && drag.moved) {
    if (t && t !== drag.from) {
      const src = new Set(selected); src.add(drag.from.i);
      issue([...src].filter(i => state.nodes[i].owner === me && i !== t.i), t.i);
    }
    selected.clear();
  } else tap(t);
  drag = null;
});
function tap(t) {
  if (!t) { selected.clear(); return; }
  if (t.owner === me) {
    if (selected.size === 0) { selected.add(t.i); return; }
    if (selected.has(t.i)) { selected.delete(t.i); return; }
  }
  if (selected.size) { issue([...selected].filter(i => i !== t.i), t.i); selected.clear(); }
}

show('menu');
})();
