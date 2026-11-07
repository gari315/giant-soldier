'use strict';
// テスト用ボット。 使い方:
//   node scripts/bot.js --room ABCD [--count 3] [--url ws://localhost:3000]   兵士ボットを部屋に参加させ、巨人に向かって飛び回らせる
//   node scripts/bot.js --selftest [--url ws://localhost:3000]               サーバーの部屋・判定ロジックを自動検証
const WebSocket = require('ws');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const URL = arg('url', 'ws://localhost:3000');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Bot {
  constructor(name) { this.name = name; this.q = []; this.waiters = []; this.snap = null; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL); this.ws.on('error', rej);
      this.ws.on('open', () => res(this));
      this.ws.on('message', d => {
        const m = JSON.parse(d); if (m.t === 'snap') { this.snap = m; return; }
        if (m.t === 'joined') Object.assign(this, { id: m.id, token: m.token, code: m.code });
        if (m.t === 'room') this.room = m;
        this.q.push(m); this.waiters = this.waiters.filter(w => !w(m));
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  until(f, ms = 4000) { // 過去に受信した分も含めて待つ
    const i = this.q.findIndex(f); if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    return new Promise(res => { const t = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); res(null); }, ms);
      const w = m => { if (f(m)) { clearTimeout(t); this.q.splice(this.q.indexOf(m), 1); res(m); return true; } return false; }; this.waiters.push(w); });
  }
  soldier(p, extra) { this.send({ t: 'state', p, yaw: 0, pitch: 0, v: [0, 0, 0], w: [null, null], f: 0, g: 100, ...extra }); }
  giant(p, extra) { this.send({ t: 'state', p, yaw: 0, hy: 0, sp: 0, run: 0, sc: 1, limbs: [0, 0, 0, 0], hd: 0, ...extra }); }
  close() { this.ws.close(); }
}

async function selftest() {
  let pass = 0, fail = 0;
  const ok = (c, msg) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + msg); };
  const [A, B, C, D, G, E] = await Promise.all(['A', 'B', 'C', 'D', 'G', 'E'].map(n => new Bot(n).connect()));

  // --- ロビー ---
  E.send({ t: 'join', code: 'ZZZZ', name: 'E' }); ok((await E.until(m => m.t === 'err'))?.m === 'noRoom', '存在しない部屋コードは拒否');
  A.send({ t: 'create', name: 'A' }); await A.until(m => m.t === 'joined'); ok(/^[A-Z2-9]{4}$/.test(A.code), '4文字の部屋コードで作成 ' + A.code);
  A.send({ t: 'start' }); ok((await A.until(m => m.t === 'err'))?.m === 'needGiant', '巨人不在では開始できない');
  A.send({ t: 'role', role: 'giant' }); await sleep(80); A.send({ t: 'start' }); ok((await A.until(m => m.t === 'err'))?.m === 'needSoldier', '兵士不在では開始できない');
  A.send({ t: 'role', role: 'soldier' }); await sleep(80);
  for (const b of [B, C, D, G]) { b.send({ t: 'join', code: A.code, name: b.name }); await b.until(m => m.t === 'joined'); }
  E.send({ t: 'join', code: A.code, name: 'E' }); ok((await E.until(m => m.t === 'err'))?.m === 'full', '6人目は満員で拒否（最大5人）');
  ok(G.room.players.find(p => p.id === G.id).role === 'giant', '兵士4人が埋まると次の参加者は巨人席に入る');
  B.send({ t: 'role', role: 'giant' }); ok((await B.until(m => m.t === 'err'))?.m === 'giantTaken', '巨人は1人まで');
  B.send({ t: 'start' }); await sleep(100); ok(!B.q.some(m => m.t === 'start'), 'ホスト以外は開始できない');
  A.send({ t: 'start' }); ok(!!(await A.until(m => m.t === 'start')), 'ホストが開始（巨人1+兵士4）');

  // --- 掴み ---
  G.giant([0, 0, 0]); A.soldier([0, 3, 80]); B.soldier([0, 3, -10]); C.soldier([0, 3, 10]); D.soldier([200, 3, 200]); await sleep(150);
  G.send({ t: 'event', k: 'grab', id: A.id }); await sleep(100); ok(!G.q.some(m => m.k === 'grab'), '遠すぎる掴みは却下');
  G.send({ t: 'event', k: 'grab', id: B.id }); await sleep(100); ok(!G.q.some(m => m.k === 'grab'), '背後の掴みは却下（前方のみ）');
  G.send({ t: 'event', k: 'grab', id: C.id }); ok(!!(await G.until(m => m.k === 'grab' && m.id === C.id)), '前方の近い兵士は掴める');
  const t0 = Date.now(); const eat = await G.until(m => m.k === 'dead' && m.id === C.id, 4000);
  ok(eat?.by === 'eat' && Date.now() - t0 > 2200 && Date.now() - t0 < 3200, `約2.5秒後に食べられて脱落 (${Date.now() - t0}ms)`);

  // --- 蹴り（全方向・空中でも低ければ当たる・高い所と遠くは無事。クールダウンなし、モーション中の連打のみ不可）---
  A.soldier([5, 45, 0]); B.soldier([-6, 10, -8]); D.soldier([30, 1, 0]); await sleep(150);
  G.send({ t: 'event', k: 'kick' }); const cr = await G.until(m => m.k === 'kicked');
  ok(cr && cr.victims.length === 1 && cr.victims[0] === B.id, '蹴り: 背後を含む周囲の兵士が脱落（高い所・範囲外は無事）');
  G.q = G.q.filter(m => m.k !== 'kick'); G.send({ t: 'event', k: 'kick' }); await sleep(150); ok(!G.q.some(m => m.k === 'kick'), '蹴りのモーション中は連打できない');
  await sleep(900);
  // --- 咆哮（クールダウンあり）---
  G.send({ t: 'event', k: 'roar' }); ok(!!(await A.until(m => m.k === 'roar', 1000)), '咆哮は全員に配信');
  A.q = A.q.filter(m => m.k !== 'roar'); G.send({ t: 'event', k: 'roar' }); await sleep(150); ok(!A.q.some(m => m.k === 'roar'), '咆哮のクールダウン中は却下');
  A.soldier([0, 15, -12]); await sleep(100); G.q.length = 0;

  // --- 四肢の切断（巨人の近くの兵士のみ、1部位1回）---
  D.send({ t: 'event', k: 'limb', key: 'rightArm' }); await sleep(100); ok(!G.q.some(m => m.k === 'limb'), '切断: 遠い兵士の申告は却下');
  A.send({ t: 'event', k: 'limb', key: 'leftArm' }); ok((await G.until(m => m.k === 'limb' && m.key === 'leftArm')) !== null, '切断: 近い兵士の申告は全員に配信');
  A.send({ t: 'event', k: 'limb', key: 'leftArm' }); await sleep(100); ok(!G.q.some(m => m.k === 'limb'), '切断: 同じ部位の重複は却下');

  // --- うなじ ---
  A.soldier([0, 60, 0]); await sleep(100); A.send({ t: 'event', k: 'nape' }); await sleep(100); ok(!A.q.some(m => m.t === 'result'), 'うなじ: 遠すぎる申告は却下');
  A.soldier([0, 33, 5]); await sleep(100); A.send({ t: 'event', k: 'nape' }); await sleep(100); ok(!A.q.some(m => m.t === 'result'), 'うなじ: 正面からの申告は却下');
  G.send({ t: 'event', k: 'guard' }); await G.until(m => m.k === 'guard');
  A.soldier([0, 33, -5]); await sleep(100); A.send({ t: 'event', k: 'nape' }); await sleep(100); ok(!A.q.some(m => m.t === 'result'), 'うなじ守り中は斬れない');
  await sleep(1900); A.send({ t: 'event', k: 'nape' }); // 守り1.5秒 + 余韻0.25秒のあと
  const res = await A.until(m => m.t === 'result'); ok(res?.winner === 'soldiers' && res.reason === 'nape', '背後・至近距離のうなじ申告で兵士の勝ち（確定は0.25秒後）');

  // --- 再戦（役割交代あり）・再接続・巨人退出 ---
  A.send({ t: 'again', swap: true }); const st = await A.until(m => m.t === 'start');
  ok(st && st.players.find(p => p.id === G.id).role === 'soldier' && st.players.filter(p => p.role === 'giant').length === 1, '役割交代ありで再戦（巨人が1人入れ替わる）');
  const giantBot = [A, B, C, D, G].find(b => st.players.find(p => p.id === b.id).role === 'giant');
  const victim = [A, B, C, D, G].find(b => b !== giantBot && b !== A);
  const tok = victim.token; victim.ws.terminate(); await sleep(300);
  ok(giantBot.room.players.find(p => p.id === victim.id)?.on === false, '切断は他の参加者に通知される');
  const v2 = await new Bot(victim.name).connect(); v2.send({ t: 'resume', code: A.code, token: tok });
  const rj = await v2.until(m => m.t === 'joined'); ok(rj?.resumed && rj.id === victim.id, '30秒以内なら同じ席に復帰');
  giantBot.send({ t: 'leave' }); const lr = await v2.until(m => m.t === 'result'); ok(lr?.reason === 'giantLeft', '巨人が退出すると試合終了');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}

async function swarm() { // 兵士ボットを既存の部屋に参加させ、巨人に近づけて動かす
  const n = +arg('count', 2), code = arg('room'); if (!code) throw new Error('--room が必要です');
  for (let i = 0; i < n; i++) {
    const b = await new Bot('bot' + (i + 1)).connect(); b.send({ t: 'join', code, name: 'bot' + (i + 1) }); 
    const gm = arg('role', 'soldier') === 'giant'; if (gm) b.send({ t: 'role', role: 'giant' });
    let t = Math.random() * 6; b.ws.on('close', () => console.log(b.name + ' closed'));
    setInterval(() => { t += .05; if (gm) { const a = t * .3; b.giant([Math.cos(a) * 40, 0, Math.sin(a) * 40], { yaw: a + Math.PI / 2, hy: a + Math.PI / 2 }); return; }
      const g = b.snap?.g, cx = g ? g.p[0] : 0, cz = g ? g.p[2] : 0; b.soldier([cx + Math.cos(t + i) * 30, 15 + Math.sin(t * 2) * 8, cz + Math.sin(t + i) * 30], { yaw: t }); }, 50);
    console.log(b.name + ' joined ' + code);
  }
}
(arg('selftest') ? selftest() : swarm()).catch(e => { console.error(e.message); process.exit(1); });
