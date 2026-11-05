'use strict';
// 巨人 対 兵士 — Render Web Service 用サーバー: 静的配信 + WebSocket（部屋/ロビー/同期/判定）
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---- 調整用の定数（数値はここだけで変更できる）----
const C = {
  PORT: +process.env.PORT || 3000,
  TICK_HZ: 20,            // スナップショット配信
  PING_MS: 25000,         // WebSocket ping（Render 無料枠のアイドル対策）
  GRACE_MS: 30000,        // 切断後に同じ席へ復帰できる時間
  MAX_SOLDIERS: 4, MAX_PLAYERS: 5,
  GRAB_MS: 2500,          // 掴んでから食べるまで
  GRAB_REACH: 12,         // 掴み距離(水平) = REACH*スケール + SLACK
  CRUSH_R: 8, CRUSH_H: 4, CRUSH_CD: 4000,
  GUARD_MS: 1500, GUARD_CD: 10000,
  NAPE_H: 33, NAPE_R: 5,  // うなじの高さ/半径(スケール倍) ※実機で既存モデルに合わせて調整
  SLACK: 4,               // 遅延ぶんの許容距離
  MAP: 340                // 座標クランプ（外壁の内側 ±330 + 余裕）
};
const ROOT = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  const f = path.normalize(path.join(ROOT, u === '/' ? 'index.html' : u));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(d);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

// ---- ユーティリティ ----
const rooms = new Map();
let pidSeq = 0;
const now = () => Date.now();
const num = (v, lim) => Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0;
const vec = a => (Array.isArray(a) && a.length === 3) ? a.map(x => num(x, C.MAP)) : null;
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || '名無し';
const send = (p, m) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };
const bcast = (room, m) => { const s = JSON.stringify(m); for (const p of room.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(s); };
const err = (p, m) => send(p, { t: 'err', m });
function newCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c; do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c)); return c; }
const giantOf = r => [...r.players.values()].find(p => p.role === 'giant');
const soldiersOf = r => [...r.players.values()].filter(p => p.role === 'soldier');

function roster(room) {
  bcast(room, { t: 'room', code: room.code, host: room.host, phase: room.phase,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, on: p.connected, alive: p.alive })) });
}
function addPlayer(room, name, ws) {
  const p = { id: 'p' + (++pidSeq), token: crypto.randomBytes(8).toString('hex'), name: cleanName(name), role: 'soldier', ws, connected: true, discAt: 0, alive: true, st: null };
  if (soldiersOf(room).length >= C.MAX_SOLDIERS) p.role = giantOf(room) ? 'soldier' : 'giant';
  room.players.set(p.id, p); ws.pid = p.id; ws.room = room.code;
  if (!room.host) room.host = p.id;
  return p;
}
function startMatch(room) {
  room.phase = 'playing'; room.grab = null; room.crushReady = 0; room.guardUntil = 0; room.guardReady = 0; room.collapsed = new Set(); room.limbs = new Set(); room.t0 = now();
  let i = 0;
  for (const p of room.players.values()) { p.alive = true; p.st = null; p.idx = p.role === 'soldier' ? i++ : 0; }
  bcast(room, { t: 'start', seed: crypto.randomInt(1e9), players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, idx: p.idx })) });
  roster(room);
}
function endMatch(room, winner, reason) {
  if (room.phase !== 'playing') return;
  room.phase = 'result'; room.grab = null;
  bcast(room, { t: 'result', winner, reason, secs: Math.round((now() - room.t0) / 1000) });
  roster(room);
}
function checkEnd(room) {
  if (room.phase !== 'playing') return;
  if (!soldiersOf(room).some(s => s.alive)) endMatch(room, 'giant', 'allDown');
}
function kill(room, p, by) {
  if (!p.alive) return;
  p.alive = false;
  if (room.grab && room.grab.target === p.id) room.grab = null;
  bcast(room, { t: 'event', k: 'dead', id: p.id, by });
  checkEnd(room);
}
function dropPlayer(room, p) {
  room.players.delete(p.id);
  if (room.phase === 'playing') {
    if (p.role === 'giant') endMatch(room, null, 'giantLeft');
    else { if (room.grab && room.grab.target === p.id) room.grab = null; bcast(room, { t: 'event', k: 'dead', id: p.id, by: 'left' }); checkEnd(room); }
  }
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.host === p.id) room.host = [...room.players.values()].find(x => x.connected)?.id || room.players.keys().next().value;
  roster(room);
}

// ---- 判定（巨人/兵士の申告をサーバーが検証）----
function giantOK(room, g) { return room.phase === 'playing' && g.alive !== false && g.st; }
const LIMBS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const h2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function validNape(room, s, g) {
  if (!s.st || !g.st || !s.alive || now() < room.guardUntil) return false;
  const sc = g.st.sc, nh = g.st.nh > 0 ? g.st.nh : C.NAPE_H * sc, nape = [g.st.p[0], g.st.p[1] + nh, g.st.p[2]]; // nh=巨人クライアントが実モデルから計測したうなじの高さ
  const d = Math.hypot(s.st.p[0] - nape[0], s.st.p[1] - nape[1], s.st.p[2] - nape[2]);
  if (d > C.NAPE_R * sc + C.SLACK) return false;
  const fx = Math.sin(g.st.hy), fz = Math.cos(g.st.hy);
  return (s.st.p[0] - g.st.p[0]) * fx + (s.st.p[2] - g.st.p[2]) * fz < 0; // 背後（既存 napeBehind と同じ条件）
}
function handleEvent(room, p, m) {
  if (room.phase !== 'playing') return;
  const g = giantOf(room);
  if (m.k === 'nape' && p.role === 'soldier') {
    if (validNape(room, p, g)) { bcast(room, { t: 'event', k: 'nape', id: p.id }); endMatch(room, 'soldiers', 'nape'); }
    return;
  }
  if (m.k === 'limb' && p.role === 'soldier') { // 四肢の切断: 巨人の近くの生存兵士の申告のみ、1部位1回だけ全員へ
    if (!g || !g.st || !p.alive || !p.st || !LIMBS.includes(m.key) || room.limbs.has(m.key)) return;
    if (h2(p.st.p, g.st.p) > 25 * g.st.sc + C.SLACK) return;
    room.limbs.add(m.key); bcast(room, { t: 'event', k: 'limb', key: m.key, id: p.id }); return;
  }
  if (p.role !== 'giant' || !giantOK(room, p)) return;
  const st = p.st, sc = st.sc, t = now();
  if (m.k === 'grab') {
    const tg = room.players.get(m.id);
    if (room.grab || !tg || tg.role !== 'soldier' || !tg.alive || !tg.st || st.limbs[0] && st.limbs[1] || now() < room.guardUntil) return;
    const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw), dx = tg.st.p[0] - st.p[0], dz = tg.st.p[2] - st.p[2];
    if (Math.hypot(dx, dz) > C.GRAB_REACH * sc + C.SLACK || dx * fx + dz * fz <= 0) return; // 前方のみ
    room.grab = { target: tg.id, until: t + C.GRAB_MS };
    bcast(room, { t: 'event', k: 'grab', id: tg.id });
  } else if (m.k === 'release') {
    if (room.grab) { bcast(room, { t: 'event', k: 'release', id: room.grab.target }); room.grab = null; }
  } else if (m.k === 'crush') {
    if (t < room.crushReady) return;
    room.crushReady = t + C.CRUSH_CD;
    const victims = soldiersOf(room).filter(s => s.alive && s.st && h2(s.st.p, st.p) <= C.CRUSH_R * sc + C.SLACK / 2 && s.st.p[1] - (st.p[1]) <= C.CRUSH_H).map(s => s.id);
    bcast(room, { t: 'event', k: 'crush', victims });
    victims.forEach(id => kill(room, room.players.get(id), 'crush'));
  } else if (m.k === 'guard') {
    if (t < room.guardReady) return;
    room.guardUntil = t + C.GUARD_MS; room.guardReady = t + C.GUARD_CD;
    bcast(room, { t: 'event', k: 'guard', ms: C.GUARD_MS });
  } else if (m.k === 'collapse') {
    const b = m.b | 0; if (b < 0 || b > 9999 || room.collapsed.has(b)) return;
    room.collapsed.add(b); bcast(room, { t: 'event', k: 'collapse', b });
  }
}
function handleState(room, p, m) {
  if (room.phase !== 'playing') return;
  const pos = vec(m.p); if (!pos) return;
  if (p.role === 'soldier') {
    if (!p.alive) return;
    p.st = { p: pos, yaw: num(m.yaw, 100), pitch: num(m.pitch, 4), v: vec(m.v) || [0, 0, 0], w: [vec(m.w && m.w[0]), vec(m.w && m.w[1])], f: m.f | 0, g: num(m.g, 1000) };
  } else {
    p.st = { p: pos, yaw: num(m.yaw, 100), hy: num(m.hy, 100), sp: num(m.sp, 200), run: m.run ? 1 : 0, sc: Math.max(.5, Math.min(3, num(m.sc, 10) || 1)),
      limbs: [0, 1, 2, 3].map(i => (m.limbs && m.limbs[i]) ? 1 : 0), hd: num(m.hd, 100), nh: Math.max(0, Math.min(200, num(m.nh, 200))), guard: 0 };
  }
}

// ---- 接続 ----
wss.on('connection', ws => {
  ws.isAlive = true; ws.cnt = 0;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    if (++ws.cnt > 120 * (1 + (now() - (ws.t0 || (ws.t0 = now()))) / 1000)) return; // 秒間 ~120通まで
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', ts: m.ts }));
    let room = rooms.get(ws.room), p = room && room.players.get(ws.pid);
    if (!p) {
      if (m.t === 'create') {
        room = { code: newCode(), host: null, phase: 'lobby', players: new Map(), grab: null };
        rooms.set(room.code, room); p = addPlayer(room, m.name, ws);
      } else if (m.t === 'join') {
        room = rooms.get(String(m.code || '').toUpperCase());
        const tmp = { ws, id: '-' };
        if (!room) return err(tmp, 'noRoom');
        if (room.players.size >= C.MAX_PLAYERS) return err(tmp, 'full');
        if (room.phase !== 'lobby') return err(tmp, 'inProgress');
        p = addPlayer(room, m.name, ws);
      } else if (m.t === 'resume') {
        room = rooms.get(String(m.code || '').toUpperCase());
        p = room && [...room.players.values()].find(x => x.token === m.token);
        if (!p) return err({ ws }, 'noSeat');
        if (p.ws && p.ws !== ws) { p.ws.room = null; p.ws.close(); }
        p.ws = ws; p.connected = true; p.discAt = 0; ws.pid = p.id; ws.room = room.code;
        send(p, { t: 'joined', id: p.id, token: p.token, code: room.code, resumed: true });
        if (room.phase === 'playing') send(p, { t: 'start', resumed: true, players: [...room.players.values()].map(x => ({ id: x.id, name: x.name, role: x.role, idx: x.idx || 0 })), dead: [...room.players.values()].filter(x => !x.alive).map(x => x.id) });
        return roster(room);
      } else return;
      send(p, { t: 'joined', id: p.id, token: p.token, code: room.code });
      return roster(room);
    }
    switch (m.t) {
      case 'name': p.name = cleanName(m.name); if (room.phase === 'lobby') roster(room); break;
      case 'role':
        if (room.phase !== 'lobby') break;
        if (m.role === 'giant' && !(giantOf(room) && giantOf(room) !== p)) p.role = 'giant';
        else if (m.role === 'soldier' && (p.role === 'soldier' || soldiersOf(room).length < C.MAX_SOLDIERS)) p.role = 'soldier';
        else err(p, m.role === 'giant' ? 'giantTaken' : 'soldiersFull');
        roster(room); break;
      case 'start':
        if (p.id !== room.host || room.phase !== 'lobby') break;
        if (!giantOf(room)) return err(p, 'needGiant');
        if (!soldiersOf(room).length) return err(p, 'needSoldier');
        startMatch(room); break;
      case 'again': { // 結果画面から。swap=true で巨人役を交代
        if (p.id !== room.host || room.phase !== 'result') break;
        if (m.swap) {
          const ps = [...room.players.values()].filter(x => x.connected), g = giantOf(room);
          const nx = ps[(ps.indexOf(g) + 1) % ps.length];
          if (g && nx && nx !== g) { g.role = 'soldier'; nx.role = 'giant'; }
        }
        startMatch(room); break;
      }
      case 'state': handleState(room, p, m); break;
      case 'event': handleEvent(room, p, m); break;
      case 'leave': ws.room = null; dropPlayer(room, p); ws.close(); break;
    }
  });
  ws.on('close', () => {
    const room = rooms.get(ws.room), p = room && room.players.get(ws.pid);
    if (p && p.ws === ws) { p.connected = false; p.discAt = now(); roster(room); }
  });
  ws.on('error', () => {});
});

// ---- ループ: 20Hz スナップショット / 掴み→食べる / 切断猶予 / ping ----
setInterval(() => {
  const t = now();
  for (const room of [...rooms.values()]) {
    for (const p of [...room.players.values()]) if (!p.connected && t - p.discAt > C.GRACE_MS) dropPlayer(room, p);
    if (!rooms.has(room.code) || room.phase !== 'playing') continue;
    if (room.grab && t >= room.grab.until) { const v = room.players.get(room.grab.target); room.grab = null; if (v) { bcast(room, { t: 'event', k: 'eat', id: v.id }); kill(room, v, 'eat'); } }
    if (room.phase !== 'playing') continue;
    const g = giantOf(room);
    bcast(room, { t: 'snap', ts: t, al: soldiersOf(room).filter(x => x.alive).length,
      s: soldiersOf(room).filter(p => p.st).map(p => ({ id: p.id, a: p.alive ? 1 : 0, c: p.connected ? 1 : 0, ...p.st })),
      g: g && g.st ? { id: g.id, c: g.connected ? 1 : 0, ...g.st, grab: room.grab ? 1 : 0, gid: room.grab ? room.grab.target : null, guard: t < room.guardUntil ? 1 : 0 } : null });
  }
}, 1000 / C.TICK_HZ);
setInterval(() => wss.clients.forEach(ws => { try { ws.ping(); } catch (e) {} }), C.PING_MS);

if (require.main === module) server.listen(C.PORT, () => console.log('listening on :' + C.PORT));
module.exports = { server, C };
