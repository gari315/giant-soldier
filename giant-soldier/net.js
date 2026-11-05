'use strict';
// オンライン通信とロビー。ゲーム本体(index.html のインラインscript)の後に読み込まれる。
const NET = (() => {
  const $ = id => document.getElementById(id), SK = 'gvsSeat';
  const N = { ws: null, open: false, id: null, code: null, token: null, room: null, match: null, rtt: 0, handlers: {}, want: false, retry: 0, wasIn: false };
  const ERR = { noRoom: '部屋が見つかりません', full: '満員です（最大5人）', inProgress: '試合中のため参加できません', noSeat: '席に復帰できませんでした',
    giantTaken: '巨人はすでに埋まっています', soldiersFull: '兵士は4人までです', needGiant: '巨人役が必要です', needSoldier: '兵士が1人以上必要です' };
  const stat = t => { $('lobbyStat').textContent = t || ''; };
  const banner = t => { const b = $('netBanner'); b.textContent = t || ''; b.style.display = t ? 'block' : 'none'; };
  N.on = (t, f) => { N.handlers[t] = f; };
  N.send = o => { if (N.open) N.ws.send(JSON.stringify(o)); };
  N.saved = () => { try { return JSON.parse(sessionStorage.getItem(SK)); } catch (e) { return null; } };

  function connect() {
    if (N.ws && N.ws.readyState <= 1) return;
    const first = !N.wasIn;
    if (first) stat('サーバーに接続中…（無料プランは起動に最大1分ほどかかります）'); else banner('接続が切れました。再接続中…');
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    N.ws = ws; const to = setTimeout(() => { if (ws.readyState === 0) ws.close(); }, 15000);
    ws.onopen = () => {
      clearTimeout(to); N.open = true; N.retry = 0; banner(''); stat('');
      const s = N.saved(); if (s && N.wasIn !== 'fresh') { N.send({ t: 'resume', code: s.code, token: s.token }); }
      N.hb = setInterval(() => N.send({ t: 'ping', ts: Date.now() }), 10000);
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = () => {
      clearTimeout(to); clearInterval(N.hb); N.open = false;
      if (!N.want) return;
      N.retry++; if (N.wasIn) banner('接続が切れました。再接続中…（30秒以内なら席に戻れます）'); else stat('サーバーに接続中…（起動待ち）');
      setTimeout(connect, Math.min(5000, 800 * N.retry));
    };
  }
  function onMsg(m) {
    if (m.t === 'pong') { N.rtt = Date.now() - m.ts; return; }
    if (m.t === 'joined') { Object.assign(N, { id: m.id, token: m.token, code: m.code, wasIn: true }); sessionStorage.setItem(SK, JSON.stringify({ code: m.code, token: m.token })); }
    else if (m.t === 'err') { if (m.m === 'noSeat') { sessionStorage.removeItem(SK); N.wasIn = false; banner(''); stat(ERR.noSeat); showEntry(); } else stat(ERR[m.m] || m.m); }
    else if (m.t === 'room') { N.room = m; renderRoom(); }
    else if (m.t === 'start') { N.match = m; $('lobby').style.display = 'none'; }
    if (N.handlers[m.t]) N.handlers[m.t](m);
  }
  const me = () => N.room && N.room.players.find(p => p.id === N.id);
  function showEntry() { $('lobbyEntry').style.display = ''; $('lobbyRoom').style.display = 'none'; }
  function renderRoom() {
    const r = N.room; if (!r) return;
    $('lobbyEntry').style.display = 'none'; $('lobbyRoom').style.display = ''; $('lbRoomCode').textContent = r.code;
    if (r.phase === 'lobby') $('lobby').style.display = $('lobby').style.display === 'none' ? 'none' : 'flex';
    $('lobbyList').innerHTML = r.players.map(p => `<div class="${p.on ? '' : 'off'}"><span>${p.id === r.host ? '★ ' : ''}${esc(p.name)}${p.id === N.id ? '（あなた）' : ''}${p.on ? '' : '（切断中）'}</span><b>${p.role === 'giant' ? '巨人' : '兵士'}</b></div>`).join('');
    $('lbStart').style.display = r.host === N.id ? '' : 'none';
    const m = me(); if (m) { $('roleG').classList.toggle('on', m.role === 'giant'); $('roleS').classList.toggle('on', m.role === 'soldier'); }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  N.openLobby = () => { N.want = true; $('ov').style.display = 'none'; $('lobby').style.display = 'flex';
    $('lbName').value = $('lbName').value || localStorage.getItem('gvsName') || ''; if (N.room) renderRoom(); else showEntry(); connect(); };
  N.closeLobby = () => { $('lobby').style.display = 'none'; $('ov').style.display = ''; };
  const name = () => { const v = $('lbName').value.trim() || '兵士'; try { localStorage.setItem('gvsName', v); } catch (e) {} return v; };
  $('goOn').onclick = N.openLobby;
  $('lbCreate').onclick = () => { N.wasIn = 'fresh'; N.send({ t: 'create', name: name() }); };
  $('lbJoin').onclick = () => { N.wasIn = 'fresh'; N.send({ t: 'join', code: $('lbCode').value.trim().toUpperCase(), name: name() }); };
  $('roleG').onclick = () => N.send({ t: 'role', role: 'giant' });
  $('roleS').onclick = () => N.send({ t: 'role', role: 'soldier' });
  $('lbStart').onclick = () => N.send({ t: 'start' });
  $('lbBack').onclick = () => { if (N.room) { N.send({ t: 'leave' }); sessionStorage.removeItem(SK); N.room = null; N.wasIn = false; N.want = false; } N.closeLobby(); };
  $('lbName').addEventListener('change', () => N.send({ t: 'name', name: name() }));
  return N;
})();

// ---- 試合中: 同期 / 巨人の手動操作 / 掴み・踏みつぶし・うなじ / 観戦 / 結果 ----
const ONL = (() => {
  const O = { active: false, snaps: [], off: null, rem: new Map(), acc: 0, me: null, DELAY: 100, SEND_HZ: 20, FIG: null, FEET: 0, runBtn: false, guard: false,
    TURN_MUL: 1.6, SPD_MUL: 1,                                            // 巨人の旋回・速度の調整用
    GRAB_REACH: 12, CRUSH_CD: 4000, GUARD_CD: 10000, STOMP_T: .45,         // サーバー(server.js の C)と合わせる
    grab: null, guardUntil: 0, stompT: 0, cd: { grab: 0, crush: 0, guard: 0 }, dead: false, giantDead: false, al: 0, specIdx: 0, napeCd: 0, applying: false, gas: [], ui: [] };
  const $$ = id => document.getElementById(id);
  const st = document.createElement('style');
  st.textContent = `.ntag{position:fixed;z-index:2;pointer-events:none;display:none;font:700 12px "Noto Serif JP",serif;color:#fff;text-shadow:0 1px 3px #000;transform:translate(-50%,-100%);white-space:nowrap}.ntag.off{color:#f88}
.gbt{position:fixed;z-index:6;display:none;width:76px;height:76px;border-radius:50%;font:700 14px sans-serif;background:#0007;color:#fff;border:2px solid #fff8;touch-action:none}
#resOv{display:none;position:fixed;inset:0;z-index:12;background:#000c;color:#efe6da;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:"Noto Serif JP",serif;text-align:center;padding:16px}
#resOv h1{font-size:34px;margin:0}#resOv p{margin:0;opacity:.85}#resOv .r{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
#specBar{display:none;position:fixed;z-index:6;left:50%;bottom:14px;transform:translateX(-50%);background:#000a;color:#fff;padding:6px 12px;border-radius:20px;font:14px sans-serif;gap:10px;align-items:center}`;
  document.head.appendChild(st);
  document.body.insertAdjacentHTML('beforeend', '<div id="resOv"><h1 id="resT"></h1><p id="resS"></p><div class="r" id="resB"></div></div><div id="specBar"><span id="specTxt"></span><button class="b" id="specBtn">次へ</button></div>');
  const mkBtn = (id, label, right, bottom, fn) => { const b = document.createElement('button'); b.id = id; b.className = 'gbt'; b.textContent = label; b.style.right = right + 'px'; b.style.bottom = bottom + 'px';
    const h = v => e => { e.preventDefault(); e.stopPropagation(); fn(v); };
    ['pointerdown', 'touchstart'].forEach(t => b.addEventListener(t, h(true), { passive: false })); ['pointerup', 'pointercancel', 'pointerleave', 'touchend', 'touchcancel'].forEach(t => b.addEventListener(t, h(false), { passive: false }));
    document.body.appendChild(b); return b; };
  const bRun = mkBtn('gRun', '走る', 18, 30, v => { O.runBtn = v; });
  const bGrab = mkBtn('gGrab', '掴む', 110, 30, v => { if (v) actGrab(); });
  const bCrush = mkBtn('gCrush', '踏みつぶし', 18, 120, v => { if (v) actCrush(); });
  const bGuard = mkBtn('gGuard', 'うなじ守り', 110, 120, v => { if (v) actGuard(); });
  const GBTN = [bRun, bGrab, bCrush, bGuard];

  const V = new THREE.Vector3(), r2 = n => Math.round(n * 100) / 100, ad = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b)), lp = (a, b, k) => a + (b - a) * k;
  const SPAWN = [[-6, 60], [6, 60], [-6, 72], [6, 72]];
  const nameOf = id => ((NET.match && NET.match.players.find(p => p.id === id)) || {}).name || '?';
  const isG = () => O.me && O.me.role === 'giant';
  O.giants = () => []; // ソロのAI巨人の処理は止め、巨人は giantStep / 通信で動かす

  // ---- 建物の崩壊 ----
  O.collapse = bi => {
    const b = buildingList[bi]; if (!b || b.collapsing || b.destroyed) return;
    b.collapsing = true; b.collapseT = 0; b.boxes.forEach(bx => { bx.min.set(9999, 9999, 9999); bx.max.set(9999, 9999, 9999); });
    WIRES.forEach(w => { if (w.a && w.a.b === bi) w.a = null; });
    for (let q = 0; q < 10; q++) steam.emit(new THREE.Vector3(b.px + (Math.random() - .5) * b.w, b.h / 2, b.pz + (Math.random() - .5) * b.w), new THREE.Vector3((Math.random() - .5) * 12, 6 + Math.random() * 6, (Math.random() - .5) * 12), 1.8, 10);
    spark(new THREE.Vector3(b.px, b.h / 2, b.pz), 0xddaa77); shake = Math.max(shake, .5);
  };

  // ---- 姿勢（既存の歩行・走行・四肢欠損・這いに、掴み/守り/踏みつぶしを追加）----
  O.pose = (o, dt) => {
    useG(o); const now = Date.now(), gr = O.grab, guarding = now < O.guardUntil;
    gs.c += ((gr ? .6 : 0) - gs.c) * Math.min(1, 3 * dt); const cr = gs.c, wk = 1 - cr, ys = [], ph = gs.phase;
    gs.rn += (((gs.run > 0) && !gs.dead && (gs.spd || 0) > 2 ? 1 : 0) - gs.rn) * Math.min(1, 4 * dt);
    const swf = Math.min(1, Math.max(0, ((gs.spd || 0) - .4) / 2.6)), ll = legLossOf(gs), hk = gs.stag > 0 ? Math.min(1, gs.stag / 1.4) : gs.hurt > 0 ? .15 : 0;
    if (ll === 0) {
      legs.forEach((L, i) => { const ps = ph + (i ? Math.PI : 0); let a = Math.sin(ps) * (.42 + .33 * gs.rn) * wk * swf - cr * 1.1, b = Math.pow(Math.max(0, -Math.cos(ps)), 1.5) * (.6 + .8 * gs.rn) * wk * swf + cr * 1.9;
        a = Math.max(-1.3, Math.min(.9, a)); b = Math.max(0, Math.min(2.3, b));
        if (O.stompT > 0 && i === 0) { const u = Math.sin(Math.PI * (1 - O.stompT / O.STOMP_T)); a = -1.15 * u; b = 1.3 * u; } // 踏みつぶし: 片脚を上げて下ろす
        L.th.rotation.x = a; L.kn.rotation.x = b; L.an.rotation.x = -(a + b); L.an.rotation.z = 0; ys.push(1 + 9 * Math.cos(a) + 8.4 * Math.cos(a + b) + .6); });
      const ny = (ys[0] + ys[1] + Math.sqrt((ys[0] - ys[1]) ** 2 + .3)) / 2 - .27; gs.yUp = ny;
      pelvis.position.set(0, ny, 0); pelvis.rotation.set(0, Math.sin(ph) * .1 * wk, 0);
      spine.rotation.set(cr * .9 + hk * .8 + .3 * gs.rn * wk, -Math.sin(ph) * .12 * wk + Math.sin(tw * 9) * .12 * (gs.stag > 0 ? hk : 0), 0); chest.rotation.set(cr * .4 + hk * .5, 0, 0); neck.rotation.x = -cr * .9 - hk * .5;
    } else leglessPose(dt, cr, hk);
    G.updateMatrixWorld(true);
    let tgt = null; gs.grab = gr ? 2 : 0;
    if (gr) { gs.arm = gr.arm; gs.hs = gr.hs; gs.eatT = (now - gr.t0) / 1000; const k = Math.min(1, gs.eatT / 2), W = arms[gr.arm].wr, hc2 = W.localToWorld(new THREE.Vector3(0, -1.2, 0)), off = W.localToWorld(new THREE.Vector3(gr.hs * .85, -1, .9)).sub(hc2);
      tgt = gr.cp.clone().lerp(headG.localToWorld(new THREE.Vector3(0, -1.2, 2.7)).sub(off), k * k * (3 - 2 * k)); }
    const np = guarding && !gr ? nape.getWorldPosition(new THREE.Vector3()) : null; // うなじ守り: 両手でうなじを覆う
    arms.forEach((A, i) => {
      let qs, qe;
      if (tgt && i === gs.arm) { const q2 = ikArm(A, chest.worldToLocal(tgt.clone()), gs.prone > .5 ? pronePole(A) : null); qs = q2[0]; qe = q2[1]; }
      else if (np && !(gs.prone > .12)) { const q2 = ikArm(A, chest.worldToLocal(np.clone().add(new THREE.Vector3(0, -.8, 0))), null); qs = q2[0]; qe = q2[1]; }
      else if (gs.prone > .12) { const q2 = ikArm(A, chest.worldToLocal(crawlHand(A, i)), pronePole(A)); qs = q2[0]; qe = q2[1]; }
      else if (ll >= 1) { const fl = gs.hph ? 1 : 0, fall = ll === 2 ? 1 : 0, aa = -.2 + .45 * gs.comp - 1.0 * fl - 1.1 * fall + Math.sin(tw * 7 + i * 2) * .15 * fall;
        qs = new THREE.Quaternion().setFromEuler(new THREE.Euler(aa, 0, A.s * (.5 + .5 * fl + Math.abs(gs.tilt) * .8 + .6 * fall))); qe = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.55 - .5 * fl, 0, 0)); }
      else { const aa = -Math.sin(ph + (i ? Math.PI : 0)) * (.4 + .75 * gs.rn) * wk * swf; qs = new THREE.Quaternion().setFromEuler(new THREE.Euler(aa, 0, A.s * .08)); qe = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.3 - .9 * gs.rn * wk - Math.max(0, aa) * .3, 0, 0)); }
      if (gs.stag > 0 && !gr && gs.prone < .5) qs = qs.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.3 * gs.stag / 1.4, 0, A.s * .6 * gs.stag / 1.4)));
      const kk = Math.min(1, (gs.prone > .12 ? 18 : (gr && i === gs.arm ? 14 : 8)) * dt); A.sh.quaternion.slerp(qs, kk); A.el.quaternion.slerp(qe, kk); clampArm(A); A.fg.forEach(f => f.rotation.x = (gr && i === gs.arm) ? -1.4 : -.25);
    });
    if (gs.dead) deadPose(dt);
    G.updateMatrixWorld(true);
    if (gr) { const e = gs.eatT, W = arms[gr.arm].wr, hc = W.localToWorld(new THREE.Vector3(0, -1.2, 0));
      if (gr.id === NET.id) { P.pos.copy(hc); fig.visible = false; }
      jaw.rotation.x = .8 * (e < .7 ? e / .7 : e < 2.8 ? 1 : Math.max(0, 1 - (e - 2.8) / .2));
      const ml = W.worldToLocal(headG.localToWorld(new THREE.Vector3(0, -1.2, 2.7))); if (Math.abs(ml.x) > .6) gr.hs = Math.sign(ml.x);
      held.position.lerp(new THREE.Vector3(0, -1, .9), Math.min(1, 10 * dt)); held.rotation.set(Math.sin(e * 20) * .25 * (e < 2.1 ? 1 : .4), 0, -gr.hs * Math.PI / 2); held.userData.head.visible = e < 3; shake = Math.max(shake, .08); }
  };

  // ---- 巨人プレイヤーの行動 ----
  function actGrab() {
    if (!isG() || over || O.grab || Date.now() < O.cd.grab || Date.now() < O.guardUntil) return;
    const o = GI[0]; useG(o); if (gs.parts.leftArm.severed && gs.parts.rightArm.severed) { popup('両腕がなく掴めない', 'big'); return; }
    const sc = G.scale.x, fx = Math.sin(gs.yaw), fz = Math.cos(gs.yaw); let best = null, bd = 1e9;
    O.rem.forEach((r, id) => { if (!r.mesh.visible) return; const dx = r.mesh.position.x - G.position.x, dz = r.mesh.position.z - G.position.z, d = Math.hypot(dx, dz);
      if (d <= O.GRAB_REACH * sc + 1 && dx * fx + dz * fz > 0 && d < bd) { bd = d; best = id; } }); // 前方のみ
    O.cd.grab = Date.now() + 700; if (best) NET.send({ t: 'event', k: 'grab', id: best });
  }
  function actCrush() { if (!isG() || over || Date.now() < O.cd.crush) return; O.cd.crush = Date.now() + O.CRUSH_CD; NET.send({ t: 'event', k: 'crush' }); }
  function actGuard() { if (!isG() || over || O.grab || Date.now() < O.cd.guard) return; O.cd.guard = Date.now() + O.GUARD_CD; NET.send({ t: 'event', k: 'guard' }); }
  addEventListener('mousedown', e => { if (!O.active || !isG() || over || !(document.pointerLockElement || mode === 'PC')) return; if (e.target.closest && e.target.closest('button,#lobby,#resOv')) return; if (e.button === 0) actGrab(); else if (e.button === 2) actCrush(); });
  addEventListener('contextmenu', e => { if (O.active) e.preventDefault(); });
  addEventListener('keydown', e => { if (!O.active) return;
    if (isG()) { if (e.code === 'Space') { actCrush(); e.preventDefault(); } else if (e.code === 'KeyC') actGuard(); }
    else if (O.dead && e.code === 'Tab') { O.specIdx++; e.preventDefault(); } });
  $$('specBtn').onclick = () => { O.specIdx++; };

  function giantStep(dt) {
    const o = GI[0]; useG(o); P.pitch = Math.max(-.9, Math.min(.5, P.pitch));
    const c = Math.cos(P.yaw), sn = Math.sin(P.yaw);
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joy.x, mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - joy.y; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    const dx = c * mx - sn * mz, dz = -sn * mx - c * mz, moving = l > .15, run = !!(keys.ShiftLeft || keys.ShiftRight || O.runBtn);
    gs.hurt = Math.max(0, gs.hurt - dt); gs.stag = Math.max(0, gs.stag - dt); Object.values(gs.parts).forEach(q => q.cooldown = Math.max(0, q.cooldown - dt));
    gs.mode = 'chase'; gs.run = run ? 5 : 0; gs.dead = 0; O.guard = Date.now() < O.guardUntil;
    const legLoss = legLossOf(gs), armLoss = (gs.parts.leftArm.severed ? 1 : 0) + (gs.parts.rightArm.severed ? 1 : 0), limbless = legLoss === 2 && armLoss === 2, tr = gs.trait;
    const hd = moving ? Math.atan2(dx, dz) : gs.yaw, da = ad(hd, gs.yaw);
    const turnMul = limbless ? 0 : legLoss === 2 ? .35 : legLoss === 1 ? (gs.hph ? 0 : .6) : 1;
    const turnStep = (gs.run > 0 ? tr.turnRate * 1.2 : tr.turnRate * .85) * dt * turnMul * O.TURN_MUL; gs.yaw += Math.max(-turnStep, Math.min(turnStep, da)); G.rotation.y = gs.yaw;
    if (limbless) headG.rotation.y += (.6 * gs.limbSide - headG.rotation.y) * Math.min(1, 3 * dt);
    else { const ty = Math.max(-.7, Math.min(.7, ad(Math.atan2(-sn, -c), gs.yaw))); headG.rotation.y += (ty - headG.rotation.y) * Math.min(1, 8 * dt); }
    const canGo = moving && gs.stag <= 0 && !limbless && !O.guard && !O.grab; gs.mv = canGo; // 守り中・掴み中は動けない
    const base = (gs.run > 0 ? tr.chaseSpeed : tr.walkSpeed) * (gs.hurt > 0 ? .45 : 1) * O.SPD_MUL;
    if (legLoss === 0) {
      G.position.y = 0; gs.spd = (gs.spd || 0) + ((canGo ? base : 0) - (gs.spd || 0)) * Math.min(1, (canGo ? 3.5 : 9) * dt);
      const v = gs.spd * dt; if (v > 1e-4) { G.position.x += Math.sin(gs.yaw) * v; G.position.z += Math.cos(gs.yaw) * v; pushOut(G.position, 4); gs.phase += v * 1.8 / (17.4 * (.42 + .33 * gs.rn) * G.scale.x); }
    } else updateLegless(dt, canGo, base);
    const gx = G.position.x, gz = G.position.z, fr = gs.prone > .5 ? 10 : 0, gx2 = gx + Math.sin(gs.yaw) * fr, gz2 = gz + Math.cos(gs.yaw) * fr;
    buildingList.forEach((b, bi) => { if (!b.collapsing && !b.destroyed && (Math.hypot(b.px - gx, b.pz - gz) < b.w / 2 + 9 * G.scale.x || (fr && Math.hypot(b.px - gx2, b.pz - gz2) < b.w / 2 + 9 * G.scale.x))) { O.collapse(bi); NET.send({ t: 'event', k: 'collapse', b: bi }); } });
    O.pose(o, dt);
  }
  function giantCam() {
    const o = GI[0]; useG(o); const sc = G.scale.x, T = new THREE.Vector3(G.position.x, 24 * sc, G.position.z), cp = Math.cos(P.pitch), dist = 72 * sc;
    cam.position.set(T.x + Math.sin(P.yaw) * cp * dist, Math.max(4, T.y - Math.sin(P.pitch) * dist + 12 * sc), T.z + Math.cos(P.yaw) * cp * dist);
    cam.lookAt(T); if (cam.fov !== 74) { cam.fov = 74; cam.updateProjectionMatrix(); } sky.position.copy(cam.position);
  }
  function specTargets() { const t = [{ g: 1 }]; O.rem.forEach((r, id) => { if (r.mesh.visible) t.push({ id, r }); }); return t; }
  function specCam() { // 脱落後の観戦: 巨人 / 生存兵士の視点を切り替え
    const ts = specTargets(), t = ts[O.specIdx % ts.length]; $$('specTxt').textContent = '観戦中: ' + (t.g ? '巨人' : nameOf(t.id));
    if (t.g) return giantCam();
    P.pitch = Math.max(-.9, Math.min(1.2, P.pitch)); const pos = t.r.mesh.position, cp = Math.cos(P.pitch), T = new THREE.Vector3(pos.x, pos.y + 1.7 + O.FEET, pos.z);
    cam.position.set(T.x + Math.sin(P.yaw) * cp * 14, Math.max(1.5, T.y - Math.sin(P.pitch) * 14 + 3), T.z + Math.cos(P.yaw) * cp * 14); cam.lookAt(T); sky.position.copy(cam.position);
  }

  // ---- イベント ----
  function startGrab(id) {
    if (O.grab) return; const o = GI[0]; useG(o); let cp;
    if (id === NET.id) cp = P.pos.clone(); else { const r = O.rem.get(id); if (!r) return; cp = new THREE.Vector3(r.mesh.position.x, r.mesh.position.y + 1.7 + O.FEET, r.mesh.position.z); }
    const pl = G.worldToLocal(cp.clone()), L = !gs.parts.leftArm.severed, R = !gs.parts.rightArm.severed, pf = pl.x >= 0 ? 1 : 0, arm = (pf === 1 && R) || (pf === 0 && L) ? pf : (L ? 0 : 1);
    const W = arms[arm].wr, mp0 = headG.localToWorld(new THREE.Vector3(0, -1.2, 2.7)); W.add(held); held.position.copy(W.worldToLocal(cp.clone())); held.visible = true; held.userData.head.visible = true;
    O.grab = { id, t0: Date.now(), arm, hs: W.worldToLocal(mp0).x >= 0 ? 1 : -1, cp };
    if (id === NET.id) { P.eaten = true; releaseWires(); P.stuck = false; P.vel.set(0, 0, 0); popup('掴まれた！', 'big'); }
  }
  function endGrab(eaten) {
    const g = O.grab; if (!g) return; O.grab = null; held.visible = false; useG(GI[0]); jaw.rotation.x = 0; gs.grab = 0;
    if (eaten) { const mw = headG.localToWorld(new THREE.Vector3(0, -1.2, 1.9)); shake = 1; for (let q = 0; q < 4; q++) spark(mw, 0xaa1010); }
  }
  function onDead(id, by) {
    if (O.grab && O.grab.id === id) endGrab(by === 'eat');
    if (by === 'crush') { const r = O.rem.get(id); if (r) { for (let q = 0; q < 3; q++) spark(r.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xaa1010); } }
    if (id === NET.id) { O.dead = true; P.eaten = true; P.vel.set(0, 0, 0); fig.visible = false; releaseWires(); O.specIdx = 0; $$('specBar').style.display = 'flex';
      popup(by === 'eat' ? '食べられた…観戦に切り替えます' : by === 'crush' ? '踏みつぶされた…観戦に切り替えます' : '脱落', 'big'); }
  }
  function stomp() {
    O.stompT = O.STOMP_T; useG(GI[0]); const sc = G.scale.x, near = Math.hypot(P.pos.x - G.position.x, P.pos.z - G.position.z) < 90 || isG();
    setTimeout(() => { for (let q = 0; q < 16; q++) { const a = Math.random() * 6.283, r = (4 + Math.random() * 4) * sc;
      steam.emit(new THREE.Vector3(G.position.x + Math.cos(a) * r, .6, G.position.z + Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * 10, 4 + Math.random() * 4, Math.sin(a) * 10), 1.6, 10); }
      spark(new THREE.Vector3(G.position.x, .5, G.position.z), 0xddaa77); shake = Math.max(shake, near ? 1 : .3); }, O.STOMP_T * 500);
  }
  function applyLimb(key) {
    const o = GI[0]; if (o.gs.parts[key] && !o.gs.parts[key].severed) { O.applying = true; try { severLimb(o, key, new THREE.Vector3(o.G.position.x, o.G.position.y + 10, o.G.position.z), true); } finally { O.applying = false; } }
  }
  function onEvent(m) {
    switch (m.k) {
      case 'collapse': O.collapse(m.b | 0); break;
      case 'grab': startGrab(m.id); break;
      case 'release': endGrab(false); if (m.id === NET.id) { P.eaten = false; fig.visible = true; } break;
      case 'eat': endGrab(true); break;
      case 'crush': stomp(); break;
      case 'guard': O.guardUntil = Date.now() + m.ms; break;
      case 'dead': onDead(m.id, m.by); break;
      case 'limb': applyLimb(m.key); break;
    }
  }
  O.sever = key => NET.send({ t: 'event', k: 'limb', key });            // 自分の刃で切断した → サーバー経由で全員へ
  O.nape = () => { P.slash = false; P.slashT = 0; P.sw2 = false; if (Date.now() < O.napeCd) return; O.napeCd = Date.now() + 1200; NET.send({ t: 'event', k: 'nape' }); }; // うなじ斬りの申告（確定はサーバー）

  // ---- 結果画面 ----
  function onResult(m) {
    over = true; O.result = m; try { audioStop(); } catch (e) {} document.exitPointerLock && document.exitPointerLock(); GBTN.forEach(b => b.style.display = 'none'); $$('specBar').style.display = 'none';
    if (m.winner === 'soldiers') { O.giantDead = true; useG(GI[0]); gs.deadT = 0; }
    const win = m.winner === 'soldiers' ? !isG() : m.winner === 'giant' ? isG() : null;
    $$('resT').textContent = m.winner === null ? '試合終了' : win ? '勝利' : '敗北';
    $$('resS').textContent = (m.winner === 'soldiers' ? '兵士が巨人のうなじを斬った' : m.winner === 'giant' ? '兵士は全滅した' : '巨人が退出したため試合を終了しました') + `（${m.secs}秒）`;
    const host = NET.room && NET.room.host === NET.id, B = $$('resB'); B.innerHTML = '';
    const add = (t, f, c) => { const b = document.createElement('button'); b.className = 'b ' + (c || ''); b.textContent = t; b.onclick = f; B.appendChild(b); };
    if (host && m.reason !== 'giantLeft') { add('もう一度（役割交代あり）', () => NET.send({ t: 'again', swap: true }), 'go'); add('もう一度（役割交代なし）', () => NET.send({ t: 'again', swap: false })); }
    else if (!host) $$('resS').textContent += ' ／ ホストの選択を待っています…';
    add('タイトルへ', () => { NET.send({ t: 'leave' }); sessionStorage.removeItem('gvsSeat'); location.reload(); });
    $$('resOv').style.display = 'flex';
  }
  NET.on('result', onResult);

  // ---- 開始 / 再戦 / 再接続 ----
  O.clear = () => { O.rem.forEach(r => { S.remove(r.mesh); S.remove(r.line); r.tag.remove(); }); O.rem.clear(); };
  function gasStations() { // ガス補給所: 背の高い建物の屋上に2か所（崩れたら消える）
    if (O.gas.length) return; const top = buildingList.map((b, i) => ({ b, i })).sort((a, b) => b.b.h - a.b.h);
    const pick = []; for (const t of top) { if (pick.every(q => Math.hypot(q.b.px - t.b.px, q.b.pz - t.b.pz) > 80)) pick.push(t); if (pick.length >= 2) break; }
    pick.forEach(t => { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, .8, 20), new THREE.MeshBasicMaterial({ color: 0x55ff99 })); m.position.set(t.b.px, t.b.h + .6, t.b.pz); S.add(m);
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 14, 8), new THREE.MeshBasicMaterial({ color: 0x55ff99, transparent: true, opacity: .35 })); pl.position.y = 7; m.add(pl); O.gas.push({ m, b: t.b }); });
  }
  O.start = m => {
    $$('resOv').style.display = 'none'; $$('specBar').style.display = 'none'; GBTN.forEach(b => b.style.display = 'none');
    O.ui.forEach(([e, d]) => { e.style.display = d; }); O.ui = [];
    Object.assign(O, { me: m.players.find(p => p.id === NET.id), snaps: [], off: null, grab: null, guardUntil: 0, stompT: 0, dead: false, giantDead: false, result: null, al: 0, specIdx: 0, cd: { grab: 0, crush: 0, guard: 0 }, napeCd: 0 }); O.clear();
    NET.on('snap', onSnap); NET.on('event', onEvent); O.active = true; PREF.map = false; PREF.arrow = false;
    if (!O.me) return;
    startGame(); held.visible = false; fig.visible = true; cam.fov = 70; cam.updateProjectionMatrix();
    GI.forEach(o => { o.G.visible = false; o.G.position.set(9000, 0, 9000); });
    if (!O.FIG) { O.FIG = fig.clone(true); O.FIG.visible = true; O.FIG.position.set(0, 0, 0); O.FIG.rotation.set(0, 0, 0); O.FIG.scale.setScalar(1);
      O.FIG.updateMatrixWorld(true); O.FEET = new THREE.Box3().setFromObject(O.FIG).min.y; } // 足元を基準に置くための補正
    gasStations();
    if (!isG()) { const s = SPAWN[O.me.idx % 4]; P.pos.set(s[0], 1.7, s[1]); P.yaw = 0; P.pitch = 0; return; }
    P.eaten = true; P.pos.set(0, 400, 0); P.yaw = Math.PI; P.pitch = -.25; // 兵士用の物理は止め、入力は巨人に使う
    const o = GI[0]; useG(o); G.visible = true; G.position.set(0, 0, 0); gs.yaw = 0; G.rotation.y = 0; gs.dead = 0; gs.spd = 0;
    ['fire', 'rel', 'sbtn', 'spc', 'gas', 'gbtn'].forEach(id => { const e = $$(id); if (e) { O.ui.push([e, e.style.display]); e.style.display = 'none'; } });
    if (mode === 'SP') GBTN.forEach(b => b.style.display = 'block');
    popup(mode === 'SP' ? '巨人: 左スティック移動 / 右のボタンで走る・掴む・踏みつぶし・うなじ守り' : '巨人: WASD移動 / マウスで向き / Shift走る / 左クリック掴む / 右クリック・Space踏みつぶし / Cうなじ守り', 'big');
  };
  const mk = id => {
    const mesh = O.FIG.clone(true); mesh.visible = true; S.add(mesh);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xdadee4 })); line.frustumCulled = false; S.add(line);
    const tag = document.createElement('div'); tag.className = 'ntag'; document.body.appendChild(tag);
    const r = { mesh, line, tag }; O.rem.set(id, r); return r;
  };
  function onSnap(m) {
    const d = Date.now() - m.ts; O.off = O.off == null ? d : (d < O.off ? d : O.off + (d - O.off) * .02); O.al = m.al;
    O.snaps.push(m); if (O.snaps.length > 30) O.snaps.shift();
  }
  const find = (b, id) => b.s.find(x => x.id === id);

  O.update = (dt, realDt) => {
    if (!O.me) return;
    const giant = isG(), now = Date.now(); O.stompT = Math.max(0, O.stompT - realDt);
    if (giant) { if (!over) giantStep(dt); else { useG(GI[0]); gs.dead = O.giantDead ? 1 : 0; O.pose(GI[0], dt); } }
    // 送信（20Hz）。脱落した兵士は送らない
    O.acc += realDt;
    if (O.acc >= 1 / O.SEND_HZ && !over && !O.dead) {
      O.acc = 0;
      if (giant) { const o = GI[0]; useG(o); NET.send({ t: 'state', p: [r2(G.position.x), r2(G.position.y), r2(G.position.z)], yaw: r2(gs.yaw), hy: r2(gs.yaw + headG.rotation.y), sp: r2(gs.spd || 0), run: gs.run > 0 ? 1 : 0,
        sc: G.scale.x, hd: r2(headG.rotation.y), nh: r2(nape.getWorldPosition(V).y - G.position.y), limbs: LIMB_KEYS.map(k => gs.parts[k].severed ? 1 : 0) }); }
      else NET.send({ t: 'state', p: [r2(P.pos.x), r2(P.pos.y), r2(P.pos.z)], yaw: r2(P.yaw), pitch: r2(P.pitch), v: [r2(P.vel.x), r2(P.vel.y), r2(P.vel.z)],
        w: WIRES.map(w => w.a ? aw(w.a, V).toArray().map(r2) : (w.fly ? w.fly.pos.toArray().map(r2) : null)),
        f: (P.stuck ? 1 : 0) | (P.gr ? 2 : 0) | (P.dash ? 4 : 0) | (P.slash ? 8 : 0), g: r2(P.gasAmt || 0) });
    }
    // ガス補給所（生存兵士のみ補給）
    O.gas.forEach(g => { g.m.visible = !g.b.collapsing && !g.b.destroyed; if (g.m.visible && !giant && !O.dead && !over && P.pos.distanceTo(g.m.position) < 8) P.gasAmt = Math.min(100, (P.gasAmt || 0) + 70 * dt); });
    // 補間表示（相手は約100ms遅れで描画）
    const n = O.snaps.length; if (n && O.off != null) {
      const rt = now - O.off - O.DELAY; let i = n - 1; while (i > 0 && O.snaps[i - 1].ts > rt) i--;
      const A = O.snaps[Math.max(0, Math.min(n - 2, i - 1))], B = O.snaps[Math.max(1, Math.min(n - 1, i))] || A;
      const k = B.ts > A.ts ? Math.max(0, Math.min(1.5, (rt - A.ts) / (B.ts - A.ts))) : 1; // 1.5まで先読み(外挿)を許す
      const seen = new Set();
      for (const sb of B.s) {
        if (sb.id === NET.id) continue; const sa = find(A, sb.id) || sb; seen.add(sb.id);
        let r = O.rem.get(sb.id); if (!sb.a || (O.grab && O.grab.id === sb.id)) { if (r) { r.mesh.visible = false; r.line.visible = false; r.tag.style.display = 'none'; } continue; }
        if (!r) r = mk(sb.id); r.mesh.visible = r.line.visible = true;
        const x = lp(sa.p[0], sb.p[0], k), y = lp(sa.p[1], sb.p[1], k), z = lp(sa.p[2], sb.p[2], k), yaw = sa.yaw + ad(sb.yaw, sa.yaw) * k;
        r.mesh.position.set(x, y - 1.7 - O.FEET, z); r.mesh.rotation.set(sb.f & 1 ? .3 : 0, yaw, 0);
        const ws = (k > .5 ? sb : sa).w, ps = r.line.geometry.attributes.position, hip = [x, y - .8, z];
        for (let j = 0; j < 2; j++) { const q = ws[j] || hip; ps.setXYZ(j * 2, hip[0], hip[1], hip[2]); ps.setXYZ(j * 2 + 1, q[0], q[1], q[2]); }
        ps.needsUpdate = true;
        V.set(x, y + 1.2, z).project(cam); const tg = r.tag, vis = V.z < 1 && Math.hypot(x - cam.position.x, z - cam.position.z) < 300;
        tg.style.display = vis ? 'block' : 'none'; tg.className = 'ntag' + (sb.c ? '' : ' off'); tg.textContent = nameOf(sb.id) + (sb.c ? '' : '（切断中）');
        tg.style.left = (V.x * .5 + .5) * innerWidth + 'px'; tg.style.top = (-V.y * .5 + .5) * innerHeight + 'px';
      }
      O.rem.forEach((r, id) => { if (!seen.has(id)) { r.mesh.visible = r.line.visible = false; r.tag.style.display = 'none'; } });
      // 相手の巨人（兵士側で表示）: 位置・向き・頭・速度を補間し、歩行アニメは既存の姿勢計算で再生。欠損は申告に合わせる
      const ga = A.g || B.g, gb = B.g || A.g;
      if (!giant && gb) {
        const o = GI[0]; useG(o); G.visible = true; if (Math.abs(G.scale.x - gb.sc) > .01) G.scale.setScalar(gb.sc);
        LIMB_KEYS.forEach((key, li) => { if (gb.limbs[li] && !gs.parts[key].severed) applyLimb(key); });
        gs.yaw = ga.yaw + ad(gb.yaw, ga.yaw) * k; headG.rotation.y = lp(ga.hd, gb.hd, k); gs.spd = lp(ga.sp, gb.sp, k); gs.run = gb.run ? 5 : 0; gs.dead = O.giantDead ? 1 : 0; gs.mode = 'chase';
        if (legLossOf(gs) > 0) updateLegless(realDt, gs.spd > .4, gs.trait.walkSpeed); else { gs.phase += gs.spd * realDt * 1.8 / (17.4 * (.42 + .33 * gs.rn) * G.scale.x); }
        G.position.set(lp(ga.p[0], gb.p[0], k), lp(ga.p[1], gb.p[1], k), lp(ga.p[2], gb.p[2], k)); G.rotation.y = gs.yaw; O.pose(o, realDt);
      }
    }
    // HUD とカメラ
    const cdS = t => Math.max(0, Math.ceil((t - now) / 1000));
    const msg = over ? '' : giant ? `残り兵士 ${O.al}人 ｜ 踏みつぶし ${cdS(O.cd.crush) || '可'} ｜ うなじ守り ${cdS(O.cd.guard) || '可'}${O.guard ? '（発動中）' : ''}`
      : O.dead ? '観戦中（クリック/Tabで視点切替）' : `生存兵士 ${O.al}人 ｜ 巨人のうなじを背後から斬れ${O.gas.some(g => g.m.visible && P.pos.distanceTo(g.m.position) < 8) ? ' ｜ ガス補給中' : ''}`;
    hud.msg.textContent = msg;
    if (giant) giantCam(); else if (O.dead && !over) specCam();
  };
  addEventListener('click', e => { if (O.dead && !over && !(e.target.closest && e.target.closest('button'))) O.specIdx++; });
  NET.on('start', m => {
    if (m.resumed && O.active && O.me) { O.me = m.players.find(p => p.id === NET.id) || O.me; if ((m.dead || []).includes(NET.id) && !O.dead) onDead(NET.id, 'left'); return; } // 再接続: 試合を巻き戻さず復帰
    O.start(m);
  });
  return O;
})();
