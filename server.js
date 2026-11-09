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
  GRAB_HAND_R: 5,         // 掴み: 巨人の手（クライアント申告の手の位置）と兵士の距離 = R*スケール + SLACK。手が触れれば向き・状況を問わず掴める
  KICK_R: 16, KICK_H: 22, KICK_HIT: 1130, KICK_LOCK: 1800, // 蹴り: 全方向（360°）・半径(スケール倍)・届く高さ・発生までの時間・連打できない最短間隔(モーション分)
  GUARD_MS: 1500, GUARD_CD: 0, GUARD_MAX: 3, // うなじ守り: クールダウンなし・1試合あたりの使用回数に上限
  COOP_GOAL: 20, COOP_CAP: 10, AI_GRAB_CD: 5000, RESCUE_R: 9, RESCUE_S: 3, RESCUE_WINDOW: 60000, // 協力モード: 倒す目標数・同時に出る巨人の上限・掴みの間隔・救助の範囲/秒数/猶予
  SPEAR_RANGE: 200,       // 雷槍での四肢切断は遠くから届く（通常の切断は 25×スケール以内）

  ROAR_CD: 14000, ROAR_MS: 4000,                           // 咆哮: 全兵士の位置が巨人に見える時間
  GUARD_TAIL: 250,       // 守り終了後も、遅延ぶんだけうなじ申告を拒否する
  NAPE_DELAY: 250,       // うなじ申告の確定を遅らせる時間。この間に守りが発動したら申告は取り消し（通信遅延で守りが負けないように）
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.mp3' || ext === '.png' || ext === '.jpg' ? 'public, max-age=86400' : 'no-cache' });
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
  room.coop = !giantOf(room); room.gs = new Map(); room.kills = 0; room.gidSeq = 0; room.spawnAt = now() + 2500; room.lastTick = now(); // 巨人役がいなければ協力モード（壁を開けて巨人の群れが押し寄せる）
  room.phase = 'playing'; room.grab = null; room.kickAt = 0; room.kickLock = 0; room.guardLeft = C.GUARD_MAX; room.guardUntil = 0; room.guardReady = 0; room.napePending = null; room.roarReady = 0; room.collapsed = new Set(); room.limbs = new Set(); room.t0 = now();
  let i = 0;
  for (const p of room.players.values()) { p.alive = true; p.downed = false; p.rp = 0; p.st = null; p.idx = p.role === 'soldier' ? i++ : 0; }
  bcast(room, { t: 'start', coop: room.coop, goal: C.COOP_GOAL, gl: C.GUARD_MAX, seed: crypto.randomInt(1e9), players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, idx: p.idx })) });
  roster(room);
}
function endMatch(room, winner, reason) {
  if (room.phase !== 'playing') return;
  room.phase = 'result'; room.grab = null; room.napePending = null; room.kickAt = 0;
  bcast(room, { t: 'result', winner, reason, coop: !!room.coop, kills: room.kills, goal: C.COOP_GOAL, secs: Math.round((now() - room.t0) / 1000) });
  roster(room);
}
function checkEnd(room) {
  if (room.phase !== 'playing') return;
  if (!soldiersOf(room).some(s => s.alive)) endMatch(room, 'giant', 'allDown');
  else if (room.coop && room.kills >= C.COOP_GOAL) endMatch(room, 'soldiers', 'clear');
}
function kill(room, p, by) {
  if (!p.alive) return;
  p.alive = false;
  if (room.coop && by !== 'left') { p.downed = true; p.dpos = p.st ? p.st.p.slice() : [0, 3, 0]; p.dT0 = now(); p.rp = 0; } // 協力: 倒れた仲間は一定時間、味方が近くにいれば助けられる
  if (room.grab && room.grab.target === p.id) room.grab = null;
  if (room.gs) room.gs.forEach(gi => { if (gi.grab && gi.grab.target === p.id) gi.grab = null; });
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
function napeAt(e, s) { // e: 巨人の状態スナップショット
  const sc = e.sc, nh = e.nh > 0 ? e.nh : C.NAPE_H * sc, nape = [e.p[0], e.p[1] + nh, e.p[2]];
  if (Math.hypot(s.st.p[0] - nape[0], s.st.p[1] - nape[1], s.st.p[2] - nape[2]) > C.NAPE_R * sc + C.SLACK) return false;
  const fx = Math.sin(e.hy), fz = Math.cos(e.hy);
  return (s.st.p[0] - e.p[0]) * fx + (s.st.p[2] - e.p[2]) * fz < 0; // 背後
}
function validNape(room, s, g) { // g: 巨人（人間のプレイヤー or AI）。直近約0.5秒の位置のどれかで条件を満たせばOK（遅延補償）
  if (!s.st || !g.st || !s.alive || now() < room.guardUntil + C.GUARD_TAIL) return false;
  if (napeAt(g.st, s)) return true;
  const t = now(); return (g.hist || []).some(h => t - h.t < 500 && napeAt(h, s));
}
function handleEvent(room, p, m) {
  if (room.phase !== 'playing') return;
  const g = giantOf(room);
  if (room.coop && p.role === 'soldier' && (m.k === 'nape' || m.k === 'limb')) { // 協力: AI巨人への申告（gid で対象を指定）
    const gi = room.gs.get(m.gid); if (!gi || !gi.alive || !gi.st || !p.alive || !p.st) return;
    if (m.k === 'nape') { if (!napeAt(gi.st, p) && !(gi.hist || []).some(h => now() - h.t < 500 && napeAt(h, p))) return; killGiantAI(room, gi, p); return; }
    const li = LIMBS.indexOf(m.key); if (li < 0 || gi.limbs[li]) return; if (h2(p.st.p, gi.st.p) > (m.sp ? C.SPEAR_RANGE : 25) * gi.sc + C.SLACK) return;
    gi.limbs[li] = 1; bcast(room, { t: 'event', k: 'limb', key: m.key, id: p.id, gid: gi.id });
    if (gi.grab && (li === 0 || li === 1)) releaseAI(room, gi, 2500); // 腕を斬ると掴まれていた仲間を解放
    return;
  }
  if (m.k === 'nape' && p.role === 'soldier') {
    if (now() < room.guardUntil + C.GUARD_TAIL) { send(p, { t: 'event', k: 'napeBlocked' }); return; }
    if (validNape(room, p, g) && !room.napePending) room.napePending = { id: p.id, at: now() + C.NAPE_DELAY }; // 確定はループで（その間に守りが入れば取り消し）
    return;
  }
  if (m.k === 'limb' && p.role === 'soldier') { // 四肢の切断: 巨人の近くの生存兵士の申告のみ、1部位1回だけ全員へ
    if (!g || !g.st || !p.alive || !p.st || !LIMBS.includes(m.key) || room.limbs.has(m.key)) return;
    if (h2(p.st.p, g.st.p) > (m.sp ? C.SPEAR_RANGE : 25) * g.st.sc + C.SLACK) return; // m.sp: 雷槍による切断（遠距離OK）
    room.limbs.add(m.key); bcast(room, { t: 'event', k: 'limb', key: m.key, id: p.id }); return;
  }
  if (p.role !== 'giant' || !giantOK(room, p)) return;
  const st = p.st, sc = st.sc, t = now();
  if (m.k === 'grab') { // 手が触れた兵士は、いつでも掴める（向き・距離の前方条件・うなじ守り中でも可）。判定は申告された手の位置とのずれで検証
    const tg = room.players.get(m.id);
    if (room.grab || !tg || tg.role !== 'soldier' || !tg.alive || !tg.st || !st.hnd) return;
    let arm = -1, bd = 1e9;
    st.hnd.forEach((h, i) => { if (!h) return; const d = Math.hypot(h[0] - tg.st.p[0], h[1] - (tg.st.p[1] - .6), h[2] - tg.st.p[2]); if (d < bd) { bd = d; arm = i; } });
    if (arm < 0 || bd > C.GRAB_HAND_R * sc + C.SLACK) return;
    room.grab = { target: tg.id, until: t + C.GRAB_MS };
    bcast(room, { t: 'event', k: 'grab', id: tg.id, arm });
  } else if (m.k === 'release') {
    if (room.grab) { bcast(room, { t: 'event', k: 'release', id: room.grab.target }); room.grab = null; }
  } else if (m.k === 'kick') { // 蹴り: 発動から KICK_HIT 後に、周囲（全方向）の兵士をまとめて脱落。脚を失うと蹴れない。クールダウンなし（モーション中の連打のみ不可）
    if (room.kickAt || t < room.kickLock || t < room.guardUntil || st.limbs[2] || st.limbs[3]) return;
    room.kickAt = t + C.KICK_HIT; room.kickLock = t + C.KICK_LOCK;
    bcast(room, { t: 'event', k: 'kick', ms: C.KICK_HIT });
  } else if (m.k === 'guard') {
    if (t < room.guardReady || t < room.guardUntil || room.guardLeft <= 0) return; // 発動中の重ね掛け・使い切り後は無効
    if (room.napePending) { const cl = room.players.get(room.napePending.id); if (cl) send(cl, { t: 'event', k: 'napeBlocked' }); }
    room.guardLeft--; room.guardUntil = t + C.GUARD_MS; room.guardReady = t + C.GUARD_CD; room.napePending = null; // 守り優先: 保留中のうなじ申告は無効
    bcast(room, { t: 'event', k: 'guard', ms: C.GUARD_MS, left: room.guardLeft });
  } else if (m.k === 'roar') {
    if (t < room.roarReady) return;
    room.roarReady = t + C.ROAR_CD; bcast(room, { t: 'event', k: 'roar', ms: C.ROAR_MS });
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
      limbs: [0, 1, 2, 3].map(i => (m.limbs && m.limbs[i]) ? 1 : 0), cq: m.cq ? 1 : 0, hnd: [0, 1].map(i => vec(m.hnd && m.hnd[i])), hd: num(m.hd, 100), nh: Math.max(0, Math.min(200, num(m.nh, 200))), guard: 0,
      ar: [0, 1].map(i => (m.ar && Array.isArray(m.ar[i])) ? [num(m.ar[i][0], 1), num(m.ar[i][1], 1), m.ar[i][2] == null ? null : num(m.ar[i][2], 30)] : null) }; // 腕の操作: [横,上下,前方距離] (横・上下は -1〜1) または null
    (p.hist = p.hist || []).push({ t: now(), p: pos, hy: p.st.hy, sc: p.st.sc, nh: p.st.nh }); if (p.hist.length > 14) p.hist.shift(); // うなじ判定の遅延補償用
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
        if (room.phase === 'playing') send(p, { t: 'start', resumed: true, coop: !!room.coop, goal: C.COOP_GOAL, gl: room.guardLeft, players: [...room.players.values()].map(x => ({ id: x.id, name: x.name, role: x.role, idx: x.idx || 0 })), dead: [...room.players.values()].filter(x => !x.alive).map(x => x.id) });
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

// ---- 協力モード: 壁を開けて押し寄せる AI 巨人 / 倒れた仲間の救助 ----
const GATES = [[0, -1], [0, 1], [-1, 0], [1, 0]], KINDS = [{ n: '歩行型', w: 3, sc: [.95, 1.15], sp: 1 }, { n: '走行型', w: 2, sc: [.9, 1.1], sp: 1.7 }, { n: '大型', w: 1, sc: [1.4, 1.7], sp: .8 }, { n: '小型', w: 3, sc: [.58, .72], sp: 1.5 }];
const angd = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function spawnGiantAI(room) {
  const gt = GATES[crypto.randomInt(4)], lat = (Math.random() - .5) * 40, far = 390, ws = KINDS.reduce((a, k) => a + k.w, 0); let r = Math.random() * ws, kind = KINDS[0]; for (const k of KINDS) { r -= k.w; if (r <= 0) { kind = k; break; } }
  const sc = kind.sc[0] + Math.random() * (kind.sc[1] - kind.sc[0]), id = 'g' + (++room.gidSeq);
  const gi = { id, kind, sc, gate: gt, p: [gt[0] ? gt[0] * far : lat, 0, gt[1] ? gt[1] * far : lat], yaw: Math.atan2(-gt[0], -gt[1]), spd: 0, limbs: [0, 0, 0, 0], alive: true, entering: true, grab: null, nextGrab: now() + 1500, diedAt: 0, st: null, hist: [] };
  room.gs.set(id, gi); bcast(room, { t: 'event', k: 'gspawn', gid: id, gate: gt });
}
function releaseAI(room, gi, cd) { if (!gi.grab) return; bcast(room, { t: 'event', k: 'release', id: gi.grab.target, gid: gi.id }); gi.grab = null; gi.nextGrab = now() + cd; }
function killGiantAI(room, gi, by) {
  gi.alive = false; gi.diedAt = now(); if (gi.grab) releaseAI(room, gi, 0); room.kills++;
  bcast(room, { t: 'event', k: 'gkill', gid: gi.id, id: by ? by.id : null, kills: room.kills });
  checkEnd(room);
}
function coopTick(room, t, dt) {
  const alive = [...room.gs.values()].filter(g => g.alive).length;
  if (t >= room.spawnAt && alive < Math.min(C.COOP_CAP, 3 + soldiersOf(room).length * 2 + Math.floor(room.kills / 4)) && room.kills + alive < C.COOP_GOAL) { spawnGiantAI(room); room.spawnAt = t + Math.max(1800, 4500 - room.kills * 120); }
  const sol = soldiersOf(room).filter(s => s.alive && s.st), held = new Set(); room.gs.forEach(g => { if (g.grab) held.add(g.grab.target); });
  for (const [id, gi] of room.gs) {
    if (!gi.alive) { if (t - gi.diedAt > 12000) room.gs.delete(id); else gi.st = { p: gi.p, yaw: gi.yaw, hy: gi.yaw, sp: 0, run: 0, sc: gi.sc, limbs: gi.limbs, hd: 0, nh: C.NAPE_H * gi.sc, cq: 0, ar: null, hnd: null }; continue; }
    const legs = gi.limbs[2] + gi.limbs[3], leg = legs === 0 ? 1 : legs === 1 ? .5 : .25, run = 9 * gi.kind.sp * leg;
    let tg = null, bd = 1e9; for (const s of sol) { if (held.has(s.id)) continue; const d = h2(s.st.p, gi.p); if (d < bd) { bd = d; tg = s; } }
    let want = 0, goal = null;
    if (gi.grab) { if (t >= gi.grab.until) { const v = room.players.get(gi.grab.target); const gid = gi.id; gi.grab = null; gi.nextGrab = t + C.AI_GRAB_CD; if (v) { bcast(room, { t: 'event', k: 'eat', id: v.id, gid }); kill(room, v, 'eat'); } if (room.phase !== 'playing') return; } }
    else if (gi.entering) { goal = [gi.gate[0] * 250, gi.gate[1] * 250]; if (gi.gate[0]) goal[1] = gi.p[2]; else goal[0] = gi.p[0]; want = run; if (Math.max(Math.abs(gi.p[0]), Math.abs(gi.p[2])) < 300) gi.entering = false; }
    else if (tg) {
      goal = [tg.st.p[0], tg.st.p[2]]; want = bd > 8 * gi.sc ? run : 0;
      if (t >= gi.nextGrab && !(gi.limbs[0] && gi.limbs[1]) && bd <= 11 * gi.sc + C.SLACK && tg.st.p[1] <= 22 * gi.sc) { gi.grab = { target: tg.id, until: t + C.GRAB_MS }; held.add(tg.id); bcast(room, { t: 'event', k: 'grab', id: tg.id, gid: gi.id, arm: gi.limbs[0] ? 1 : 0 }); }
    }
    if (goal) { const dy = angd(Math.atan2(goal[0] - gi.p[0], goal[1] - gi.p[2]), gi.yaw), st2 = 1.5 * dt; gi.yaw += Math.max(-st2, Math.min(st2, dy)); }
    if (gi.grab) want = 0;
    gi.spd += (want - gi.spd) * Math.min(1, 4 * dt); gi.p[0] += Math.sin(gi.yaw) * gi.spd * dt; gi.p[2] += Math.cos(gi.yaw) * gi.spd * dt;
    gi.st = { p: gi.p.slice(), yaw: gi.yaw, hy: gi.yaw, sp: gi.spd, run: gi.spd > 11 ? 1 : 0, sc: gi.sc, limbs: gi.limbs.slice(), hd: 0, nh: C.NAPE_H * gi.sc, cq: 0, ar: gi.grab ? [[0, .9, 8], [0, .9, 8]] : null, hnd: null };
    gi.hist.push({ t, p: gi.p.slice(), hy: gi.yaw, sc: gi.sc, nh: C.NAPE_H * gi.sc }); if (gi.hist.length > 14) gi.hist.shift();
  }
  for (const p of room.players.values()) { // 倒れた仲間の救助: 生きている味方が近くにいる間、進捗が溜まる
    if (!p.downed) continue;
    const near = sol.some(s => s.id !== p.id && h2(s.st.p, p.dpos) <= C.RESCUE_R && Math.abs(s.st.p[1] - p.dpos[1]) <= 14);
    p.rp = near ? Math.min(1, p.rp + dt / C.RESCUE_S) : Math.max(0, p.rp - dt / 6);
    if (p.rp >= 1) { p.alive = true; p.downed = false; p.rp = 0; p.st = { p: [p.dpos[0], Math.max(3, p.dpos[1]), p.dpos[2]], yaw: 0, pitch: 0, v: [0, 0, 0], w: [null, null], f: 0, g: 100 }; bcast(room, { t: 'event', k: 'revive', id: p.id, p: p.st.p }); roster(room); }
    else if (t - p.dT0 > C.RESCUE_WINDOW) { p.downed = false; bcast(room, { t: 'event', k: 'lost', id: p.id }); }
  }
}

// ---- ループ: 20Hz スナップショット / 掴み→食べる / 切断猶予 / ping ----
setInterval(() => {
  const t = now();
  for (const room of [...rooms.values()]) {
    for (const p of [...room.players.values()]) if (!p.connected && t - p.discAt > C.GRACE_MS) dropPlayer(room, p);
    if (!rooms.has(room.code) || room.phase !== 'playing') continue;
    if (room.grab && t >= room.grab.until) { const v = room.players.get(room.grab.target); room.grab = null; if (v) { bcast(room, { t: 'event', k: 'eat', id: v.id }); kill(room, v, 'eat'); } }
    if (room.phase !== 'playing') continue;
    if (room.kickAt && t >= room.kickAt) { room.kickAt = 0; const gk = giantOf(room);
      if (gk && gk.st) { const q = gk.st, victims = soldiersOf(room).filter(s => s.alive && s.st && h2(s.st.p, q.p) <= C.KICK_R * q.sc + C.SLACK / 2 && s.st.p[1] - q.p[1] <= C.KICK_H * q.sc).map(s => s.id);
        bcast(room, { t: 'event', k: 'kicked', victims }); victims.forEach(id => kill(room, room.players.get(id), 'kick')); }
      if (room.phase !== 'playing') continue; }
    if (room.coop) { coopTick(room, t, Math.min(.2, (t - room.lastTick) / 1000)); room.lastTick = t; if (room.phase !== 'playing') continue; }
    const np = room.napePending;
    if (np && t >= np.at) { room.napePending = null; const s = room.players.get(np.id), gg = giantOf(room); if (s && gg) { bcast(room, { t: 'event', k: 'nape', id: s.id }); endMatch(room, 'soldiers', 'nape'); continue; } }
    const g = giantOf(room);
    const co = room.coop ? { gl: [...room.gs.values()].filter(x => x.st).map(x => ({ id: x.id, dead: x.alive ? 0 : 1, grab: x.grab ? 1 : 0, gid: x.grab ? x.grab.target : null, ...x.st })), dn: soldiersOf(room).filter(x => x.downed).map(x => ({ id: x.id, p: x.dpos, pr: Math.round(x.rp * 100) / 100, tl: Math.max(0, Math.round((C.RESCUE_WINDOW - (t - x.dT0)) / 1000)) })), ck: room.kills } : {};
    bcast(room, { t: 'snap', ...co, ts: t, al: soldiersOf(room).filter(x => x.alive).length,
      s: soldiersOf(room).filter(p => p.st).map(p => ({ id: p.id, a: p.alive ? 1 : 0, c: p.connected ? 1 : 0, ...p.st })),
      g: g && g.st ? { id: g.id, c: g.connected ? 1 : 0, ...g.st, grab: room.grab ? 1 : 0, gid: room.grab ? room.grab.target : null, guard: t < room.guardUntil ? 1 : 0 } : null });
  }
}, 1000 / C.TICK_HZ);
setInterval(() => wss.clients.forEach(ws => { try { ws.ping(); } catch (e) {} }), C.PING_MS);

if (require.main === module) server.listen(C.PORT, () => console.log('listening on :' + C.PORT));
module.exports = { server, C };
