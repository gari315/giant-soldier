'use strict';
// オンライン通信とロビー。ゲーム本体(index.html のインラインscript)の後に読み込まれる。
const NET_BUILD = '2026-11-07c'; // 読み込まれている net.js の版（ロビー画面の下に表示）
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
  { let sx = 0, sy = 0, ok = false; const go = $('goOn'); // iOS等で click が届かない環境向け: 指があまり動かなければタップとして扱う
    go.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; ok = true; }, { passive: true });
    go.addEventListener('touchmove', e => { const t = e.changedTouches[0]; if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) ok = false; }, { passive: true });
    go.addEventListener('touchend', e => { if (!ok) return; ok = false; e.preventDefault(); e.stopPropagation(); N.openLobby(); }, { passive: false }); }
  $('lbCreate').onclick = () => { N.wasIn = 'fresh'; N.send({ t: 'create', name: name() }); };
  $('lbJoin').onclick = () => { N.wasIn = 'fresh'; N.send({ t: 'join', code: $('lbCode').value.trim().toUpperCase(), name: name() }); };
  $('roleG').onclick = () => N.send({ t: 'role', role: 'giant' });
  $('roleS').onclick = () => N.send({ t: 'role', role: 'soldier' });
  $('lbStart').onclick = () => N.send({ t: 'start' });
  $('lbBack').onclick = () => { if (N.room) { N.send({ t: 'leave' }); sessionStorage.removeItem(SK); N.room = null; N.wasIn = false; N.want = false; } N.closeLobby(); };
  $('lbName').addEventListener('change', () => N.send({ t: 'name', name: name() }));
  $('lbBack').insertAdjacentHTML('afterend', '<div style="width:100%;font-size:11px;opacity:.55;text-align:right">build ' + NET_BUILD + '</div>'); console.log('[GvS] net.js build', NET_BUILD);
  return N;
})();

// ---- 試合中: 同期 / 巨人の手動操作 / 掴み・踏みつぶし・うなじ / 観戦 / 結果 ----
const ONL = (() => {
  const O = { active: false, snaps: [], off: null, rem: new Map(), acc: 0, me: null, DELAY: 100, SEND_HZ: 20, FIG: null, FEET: 0, runBtn: false, guard: false,
    TURN_MUL: 1.6, SPD_MUL: 1,                                            // 巨人の旋回・速度の調整用
    GRAB_REACH: 12, CRUSH_R: 8, CRUSH_CD: 4000, GUARD_CD: 10000, STOMP_T: .45, SWEEP_CD: 6000, ROAR_CD: 14000, SWEEP_ANIM: .7, sweepT: 0, roarUntil: 0, roarMouth: 0,         // サーバー(server.js の C)と合わせる
    grab: null, camD: 72, camH: 12, camBtn: { d: 0, h: 0 }, armBtn: [false, false], armT: null, guardUntil: 0, stompT: 0, cd: { grab: 0, crush: 0, guard: 0, sweep: 0, roar: 0 }, dead: false, giantDead: false, al: 0, specIdx: 0, napeCd: 0, applying: false, gas: [], ui: [] };
  const $$ = id => document.getElementById(id);
  try { const j = JSON.parse(localStorage.getItem('gvsGiantCam') || 'null'); if (j) { O.camD = Math.max(18, Math.min(220, +j.d || 72)); O.camH = Math.max(-10, Math.min(90, isNaN(+j.h) ? 12 : +j.h)); } } catch (e) {}
  const camSave = () => { try { localStorage.setItem('gvsGiantCam', JSON.stringify({ d: O.camD, h: O.camH })); } catch (e) {} };
  const st = document.createElement('style');
  st.textContent = `.ntag{position:fixed;z-index:2;pointer-events:none;display:none;font:700 12px "Noto Serif JP",serif;color:#fff;text-shadow:0 1px 3px #000;transform:translate(-50%,-100%);white-space:nowrap;text-align:center;will-change:left,top}.ntag.off{color:#f88}
.ntag::after{content:"▼";display:block;line-height:.9;font-size:12px;color:#ffd27a;text-shadow:0 1px 2px #000}.ntag.big{font-size:15px}.ntag.big::after{font-size:16px}.ntag.edge{transform:translate(-50%,-50%);background:#000a;border-radius:10px;padding:2px 8px}.ntag.edge::after{display:none}
.gbt{position:fixed;z-index:4;display:none;width:78px;height:78px;border-radius:50%;font:700 13px sans-serif;line-height:1.2;background:#000a;color:#fff;border:2px solid #fff9;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.gbt.sm{width:44px;height:44px;border-radius:10px;font-size:15px}
.gbt.on{background:#d9822bdd;border-color:#fff}.gbt.cd{opacity:.5}
#pauseBtn,#vw,#lockRetry{z-index:20!important}
@media (pointer:coarse){html,body{position:fixed!important;inset:0;width:100%;height:100%;overflow:hidden!important;overscroll-behavior:none}}
#tdbg{position:fixed;z-index:30;left:4px;top:60px;max-width:70vw;padding:4px 6px;background:#000c;color:#0f0;font:11px/1.3 monospace;white-space:pre-wrap;pointer-events:none}
#gToast{position:fixed;z-index:8;left:50%;top:22%;transform:translateX(-50%);max-width:90vw;padding:8px 16px;border-radius:20px;background:#000b;color:#fff;font:700 15px sans-serif;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s}
#resOv{display:none;position:fixed;inset:0;z-index:12;background:#000c;color:#efe6da;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:"Noto Serif JP",serif;text-align:center;padding:16px}
#resOv h1{font-size:34px;margin:0}#resOv p{margin:0;opacity:.85}#resOv .r{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
#specBar{display:none;position:fixed;z-index:6;left:50%;bottom:14px;transform:translateX(-50%);background:#000a;color:#fff;padding:6px 12px;border-radius:20px;font:14px sans-serif;gap:10px;align-items:center}`;
  document.head.appendChild(st);
  document.body.insertAdjacentHTML('beforeend', '<div id="resOv"><h1 id="resT"></h1><p id="resS"></p><div class="r" id="resB"></div></div><div id="specBar"><span id="specTxt"></span><button class="b" id="specBtn">次へ</button></div>');
  const mkBtn = (id, label, right, bottom, fn, cls, top) => { const b = document.createElement('button'); b.id = id; b.className = 'gbt ' + (cls || ''); b.textContent = label; b.style.right = right + 'px'; if (top != null) b.style.top = top + 'px'; else b.style.bottom = bottom + 'px';
    const h = v => e => { e.preventDefault(); e.stopPropagation(); fn(v); };
    b.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; b.classList.add('on'); h(true)(e); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, e => { if (e.pointerType === 'touch') return; b.classList.remove('on'); h(false)(e); }));
    b.addEventListener('contextmenu', e => e.preventDefault());
    b._down = () => { b.classList.add('on'); fn(true); }; b._up = () => { b.classList.remove('on'); fn(false); };
    document.body.appendChild(b); return b; };
  const bRun = mkBtn('gRun', '走る', 18, 30, v => { O.runBtn = v; });
  const bGrab = mkBtn('gGrab', '掴む', 110, 30, v => { if (v) actGrab(); });
  const bCrush = mkBtn('gCrush', '踏みつぶし', 18, 120, v => { if (v) actCrush(); });
  const bGuard = mkBtn('gGuard', 'うなじ守り', 110, 120, v => { if (v) actGuard(); });
  // 腕の操作（押している間、スティックが「移動」から「その腕の動き」に切り替わる）。右腕=巨人の右、左腕=巨人の左
  const bArmR = mkBtn('gArmR', '右腕', 18, 210, v => { O.armBtn[0] = v; });
  const bArmL = mkBtn('gArmL', '左腕', 110, 210, v => { O.armBtn[1] = v; });
  // 三人称カメラの調整（押している間、距離/高さが変わる）
  const bCamIn = mkBtn('gCamIn', '拡', 8 + 3 * 50, 0, v => { O.camBtn.d = v ? -1 : 0; }, 'sm', 56);
  const bCamOut = mkBtn('gCamOut', '縮', 8 + 2 * 50, 0, v => { O.camBtn.d = v ? 1 : 0; }, 'sm', 56);
  const bCamUp = mkBtn('gCamUp', '上', 8 + 50, 0, v => { O.camBtn.h = v ? 1 : 0; }, 'sm', 56);
  const bCamDn = mkBtn('gCamDn', '下', 8, 0, v => { O.camBtn.h = v ? -1 : 0; }, 'sm', 56);
  const bSweep = mkBtn('gSweep', '薙ぎ払い', 202, 30, v => { if (v) actSweep(); });
  const bRoar = mkBtn('gRoar', '咆哮', 202, 120, v => { if (v) actRoar(); });
  const GBTN = [bRun, bGrab, bCrush, bGuard, bArmR, bArmL, bSweep, bRoar, bCamIn, bCamOut, bCamUp, bCamDn];

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
      else if (O.armT && O.armT[i] && !(gs.prone > .12) && !gr) { const R = 13, ax = O.armT[i][0], ay = O.armT[i][1]; // スティック右=巨人の右へ（モデルでは -x）
        const Tt = A.sh.position.clone().add(new THREE.Vector3(-ax * R * .9, ay * R * .9 + 1, R * .75 * (1 - .25 * Math.abs(ay)))); const q2 = ikArm(A, Tt, null); qs = q2[0]; qe = q2[1]; }
      else if (gs.prone > .12) { const q2 = ikArm(A, chest.worldToLocal(crawlHand(A, i)), pronePole(A)); qs = q2[0]; qe = q2[1]; }
      else if (ll >= 1) { const fl = gs.hph ? 1 : 0, fall = ll === 2 ? 1 : 0, aa = -.2 + .45 * gs.comp - 1.0 * fl - 1.1 * fall + Math.sin(tw * 7 + i * 2) * .15 * fall;
        qs = new THREE.Quaternion().setFromEuler(new THREE.Euler(aa, 0, A.s * (.5 + .5 * fl + Math.abs(gs.tilt) * .8 + .6 * fall))); qe = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.55 - .5 * fl, 0, 0)); }
      else { const aa = -Math.sin(ph + (i ? Math.PI : 0)) * (.4 + .75 * gs.rn) * wk * swf; qs = new THREE.Quaternion().setFromEuler(new THREE.Euler(aa, 0, A.s * .08)); qe = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.3 - .9 * gs.rn * wk - Math.max(0, aa) * .3, 0, 0)); }
      if (gs.stag > 0 && !gr && gs.prone < .5) qs = qs.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.3 * gs.stag / 1.4, 0, A.s * .6 * gs.stag / 1.4)));
      const kk = Math.min(1, (gs.prone > .12 ? 18 : (gr && i === gs.arm ? 14 : (O.armT && O.armT[i] ? 12 : 8))) * dt); A.sh.quaternion.slerp(qs, kk); A.el.quaternion.slerp(qe, kk); clampArm(A); A.fg.forEach(f => f.rotation.x = (gr && i === gs.arm) ? -1.4 : -.25);
    });
    if (gs.dead) deadPose(dt);
    if (!gr && !gs.dead) { if (now < O.roarMouth) { jaw.rotation.x = .9; O.mouthOpen = true; } else if (O.mouthOpen) { O.mouthOpen = false; jaw.rotation.x = 0; } } // 咆哮中は口を開ける
    G.updateMatrixWorld(true);
    if (gr) { const e = gs.eatT, W = arms[gr.arm].wr, hc = W.localToWorld(new THREE.Vector3(0, -1.2, 0));
      if (gr.id === NET.id) { P.pos.copy(hc); fig.visible = false; }
      jaw.rotation.x = .8 * (e < .7 ? e / .7 : e < 2.8 ? 1 : Math.max(0, 1 - (e - 2.8) / .2));
      const ml = W.worldToLocal(headG.localToWorld(new THREE.Vector3(0, -1.2, 2.7))); if (Math.abs(ml.x) > .6) gr.hs = Math.sign(ml.x);
      held.position.lerp(new THREE.Vector3(0, -1, .9), Math.min(1, 10 * dt)); held.rotation.set(Math.sin(e * 20) * .25 * (e < 2.1 ? 1 : .4), 0, -gr.hs * Math.PI / 2); held.userData.head.visible = e < 3; shake = Math.max(shake, .08); }
  };

  // ---- 巨人プレイヤーの行動 ----
  const toastEl = document.createElement('div'); toastEl.id = 'gToast'; document.body.appendChild(toastEl); let toastT = 0;
  const toast = t => { toastEl.textContent = t; toastEl.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.opacity = 0; }, 1500); };
  const canAct = () => isG() && !over && !isPaused && !O.dead;
  function actGrab() {
    if (!canAct() || O.grab) return; const now = Date.now(); if (now < O.cd.grab) return;
    if (now < O.guardUntil) return toast('うなじ守り中は掴めません');
    const o = GI[0]; useG(o); if (gs.parts.leftArm.severed && gs.parts.rightArm.severed) return toast('両腕がなく掴めません');
    const sc = G.scale.x, fx = Math.sin(gs.yaw), fz = Math.cos(gs.yaw); let best = null, bd = 1e9;
    O.rem.forEach((r, id) => { if (!r.mesh.visible) return; const dx = r.mesh.position.x - G.position.x, dz = r.mesh.position.z - G.position.z, d = Math.hypot(dx, dz);
      if (d <= O.GRAB_REACH * sc + 1 && dx * fx + dz * fz > 0 && d < bd) { bd = d; best = id; } }); // 前方のみ
    O.cd.grab = now + 700;
    if (best) { NET.send({ t: 'event', k: 'grab', id: best }); toast('掴む！'); } else toast('前方に掴める兵士がいません（正面・近くに捉える）');
  }
  function actCrush() {
    if (!canAct()) return; const now = Date.now();
    if (now < O.cd.crush) return toast('踏みつぶしは あと' + Math.ceil((O.cd.crush - now) / 1000) + '秒');
    O.cd.crush = now + O.CRUSH_CD; NET.send({ t: 'event', k: 'crush' }); toast('踏みつぶし！');
  }
  function actGuard() {
    if (!canAct() || O.grab) return; const now = Date.now();
    if (now < O.cd.guard) return toast('うなじ守りは あと' + Math.ceil((O.cd.guard - now) / 1000) + '秒');
    O.cd.guard = now + O.GUARD_CD; NET.send({ t: 'event', k: 'guard' }); toast('うなじ守り！（動けません）');
  }
  function actSweep() { // 薙ぎ払い: 前方の半円を腕で払う。空中の兵士にも当たり、ワイヤーを外してガスを削る
    if (!canAct() || O.grab) return; const now = Date.now(), o = GI[0]; useG(o);
    if (now < O.cd.sweep) return toast('薙ぎ払いは あと' + Math.ceil((O.cd.sweep - now) / 1000) + '秒');
    if (now < O.guardUntil) return toast('うなじ守り中は使えません'); if (O.sweepT > 0) return;
    if (gs.parts.leftArm.severed && gs.parts.rightArm.severed) return toast('両腕がなく薙ぎ払えません');
    O.cd.sweep = now + O.SWEEP_CD; O.sweepT = O.SWEEP_ANIM; NET.send({ t: 'event', k: 'sweep' }); toast('薙ぎ払い！（空中の兵士にも当たる）');
  }
  function actRoar() { // 咆哮: 数秒間、全兵士の位置が巨人の画面に表示される
    if (!canAct()) return; const now = Date.now();
    if (now < O.cd.roar) return toast('咆哮は あと' + Math.ceil((O.cd.roar - now) / 1000) + '秒');
    O.cd.roar = now + O.ROAR_CD; NET.send({ t: 'event', k: 'roar' });
  }
  const vwToggle = () => { const n = Date.now(); if (!O.active || !isG() || n - (O.vwT || 0) < 350) return; O.vwT = n; O.fp = !O.fp; $$('vw').textContent = O.fp ? '三人称へ (V)' : '一人称へ (V)'; toast(O.fp ? '一人称（巨人の目線）' : '三人称'); };
  ['click', 'touchstart'].forEach(t => $$('vw').addEventListener(t, vwToggle, { passive: true }));
  addEventListener('mousedown', e => { if (!O.active || !isG() || over || isPaused || !(document.pointerLockElement || mode === 'PC')) return; if (e.target.closest && e.target.closest('button,#lobby,#resOv,#pauseOv')) return; if (e.button === 0) actGrab(); else if (e.button === 2) actCrush(); });
  addEventListener('contextmenu', e => { if (O.active) e.preventDefault(); });
  addEventListener('wheel', e => { if (O.active && isG() && !isPaused) { O.camD = Math.max(18, Math.min(220, O.camD + Math.sign(e.deltaY) * 6)); camSave(); } }, { passive: true });
  addEventListener('keydown', e => { if (!O.active || isPaused) return;
    if (isG()) { if (e.code === 'Space') { actCrush(); e.preventDefault(); } else if (e.code === 'KeyC') actGuard(); else if (e.code === 'KeyV') vwToggle(); else if (e.code === 'KeyB') actSweep(); else if (e.code === 'KeyT') actRoar(); }
    else if (O.dead && e.code === 'Tab') { O.specIdx++; e.preventDefault(); } });
  $$('specBtn').onclick = () => { O.specIdx++; };

  // ---- スマホ: タップ座標と「見えている矩形」で当たり判定する ----
  // ブラウザのDOM当たり判定が、上下バーの出入りなどで見た目とずれる環境があるため、
  // オンライン中のスマホでは、ボタンをタップ座標と矩形の比較で判定する（実際に見えている位置が基準）。
  const synth = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  const TAP = [
    { el: bRun, down: bRun._down, up: bRun._up }, { el: bGrab, down: bGrab._down, up: bGrab._up },
    { el: bCrush, down: bCrush._down, up: bCrush._up }, { el: bGuard, down: bGuard._down, up: bGuard._up },
    ...[bArmR, bArmL, bSweep, bRoar, bCamIn, bCamOut, bCamUp, bCamDn].map(b => ({ el: b, down: b._down, up: b._up })),
    { el: $$('pauseBtn'), down: () => togglePause() },
    { el: $$('vw'), down: () => { if (isG()) vwToggle(); else setView(!tp); } },
    ...['fire', 'rel', 'sbtn', 'gbtn'].map(id => ({ el: $$(id), down: () => synth($$(id), 'touchstart'), up: () => { synth($$(id), 'touchend'); } }))]; // 兵士用の既存ボタンは、元の処理にそのままイベントを渡す
  const shown = e => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const hitTap = (x, y) => { let best = null, bd = 1e9; for (const t of TAP) { if (!t.el || !shown(t.el)) continue; const r = t.el.getBoundingClientRect(); if (!r.width) continue;
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) { const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2); if (d < bd) { bd = d; best = t; } } } return best; };
  const act = new Map(), dbg = /[?&]dbg/.test(location.search) ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'tdbg' })) : null;
  addEventListener('touchstart', e => { // 指がすでに離れているのに終了イベントが来なかったボタン操作を解除（押しっぱなし固着の対策）
    const ids = new Set([...e.touches].map(t => t.identifier));
    act.forEach((hit, id) => { if (!ids.has(id)) { act.delete(id); if (hit.el.classList) hit.el.classList.remove('on'); if (hit.up) try { hit.up(); } catch (x) {} } });
  }, { capture: true, passive: true });
  O.resetTouch = () => { act.forEach(hit => { if (hit.el.classList) hit.el.classList.remove('on'); if (hit.up) try { hit.up(); } catch (x) {} }); act.clear(); O.runBtn = false; O.armBtn = [false, false]; O.camBtn = { d: 0, h: 0 }; bRun.classList.remove('on'); };
  addEventListener('touchstart', e => {
    if (!O.active) return; let used = false;
    for (const t of e.changedTouches) { const hit = hitTap(t.clientX, t.clientY);
      if (dbg) { const d = document.elementFromPoint(t.clientX, t.clientY), vv = window.visualViewport; dbg.textContent = `touch ${t.clientX | 0},${t.clientY | 0}  inner ${innerWidth}x${innerHeight}` + (vv ? `  vv ${vv.width | 0}x${vv.height | 0} off ${vv.offsetLeft | 0},${vv.offsetTop | 0} s${vv.scale.toFixed(2)}` : '') + `\nDOM:${d && (d.id || d.tagName)}  自前:${hit ? (hit.el.id || '?') : '-'}`; }
      if (hit) { act.set(t.identifier, hit); if (hit.el.classList) hit.el.classList.add('on'); hit.down(); used = true; } }
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); } // 元の視点/スティック処理にはこのタッチを渡さない
  }, { capture: true, passive: false });
  const tapEnd = e => { for (const t of e.changedTouches) { const hit = act.get(t.identifier); if (hit) { act.delete(t.identifier); if (hit.el.classList) hit.el.classList.remove('on'); if (hit.up) hit.up(); } } };
  addEventListener('touchend', tapEnd, true); addEventListener('touchcancel', tapEnd, true);
  addEventListener('gesturestart', e => { if (O.active) e.preventDefault(); }); // iOS: ピンチ拡大でレイアウトがずれるのを防ぐ

  // 視覚効果: 踏みつぶしの衝撃波 / うなじ守りのバリア
  O.fx = []; let shield = null;
  function ring() { const sc = GI[0].G.scale.x, m = new THREE.Mesh(new THREE.RingGeometry(.9, 1.3, 48), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(GI[0].G.position.x, .5, GI[0].G.position.z); S.add(m); O.fx.push({ m, t: 0, R: (O.CRUSH_R || 8) * sc }); }
  function fxStep(dt) {
    for (let i = O.fx.length - 1; i >= 0; i--) { const f = O.fx[i]; f.t += dt; const k = Math.min(1, f.t / .6); f.m.scale.setScalar(1 + k * f.R); f.m.material.opacity = .85 * (1 - k); if (k >= 1) { S.remove(f.m); O.fx.splice(i, 1); } }
    const on = Date.now() < O.guardUntil; if (on && !shield) { shield = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: .4, depthWrite: false })); GI[0].nape.add(shield); }
    if (shield) { shield.visible = on; if (on) shield.scale.setScalar(1 + .08 * Math.sin(Date.now() / 60)); }
  }

  function giantStep(dt) {
    const o = GI[0]; useG(o); P.pitch = Math.max(-.9, Math.min(.5, P.pitch));
    const c = Math.cos(P.yaw), sn = Math.sin(P.yaw);
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joy.x, mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - joy.y; let l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    const hold = [!!(keys.KeyE || O.armBtn[0]), !!(keys.KeyQ || O.armBtn[1])]; // E/右腕ボタン=右腕, Q/左腕ボタン=左腕
    if (O.sweepT > 0 && !O.grab) { O.sweepT = Math.max(0, O.sweepT - dt); const u = 1 - O.sweepT / O.SWEEP_ANIM, ax = u < .35 ? u / .35 : u < .8 ? 1 - 2 * (u - .35) / .45 : -1 + (u - .8) / .2; // 右へ引いて → 左へ薙ぐ → 戻す（腕の姿勢は 'ar' で全員に同期）
      O.armT = [[ax, .1], [ax, .1]]; mx = 0; mz = 0; l = 0; }
    else if ((hold[0] || hold[1]) && !O.grab) { O.armT = hold.map(h => h ? [mx, mz] : null); mx = 0; mz = 0; l = 0; } else O.armT = null; // 横=左右, 縦=上下
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
  function giantCam() { // 巨人の後ろ上方の三人称（視界は広め）/ Vで一人称（巨人の目線）
    const o = GI[0]; useG(o); const sc = G.scale.x, fp = O.fp && isG(); head.visible = !fp;
    if (fp) { const hp = headG.getWorldPosition(new THREE.Vector3()), cp = Math.cos(P.pitch), fx = -Math.sin(P.yaw) * cp, fz = -Math.cos(P.yaw) * cp, fy = Math.sin(P.pitch);
      cam.position.set(hp.x + fx * 2.5 * sc, hp.y + .8 * sc, hp.z + fz * 2.5 * sc); cam.lookAt(cam.position.x + fx * 10, cam.position.y + fy * 10, cam.position.z + fz * 10);
      if (cam.fov !== 82) { cam.fov = 82; cam.updateProjectionMatrix(); } sky.position.copy(cam.position); return; }
    const T = new THREE.Vector3(G.position.x, 24 * sc, G.position.z), cp = Math.cos(P.pitch), dist = O.camD * sc;
    cam.position.set(T.x + Math.sin(P.yaw) * cp * dist, Math.max(4, T.y - Math.sin(P.pitch) * dist + O.camH * sc), T.z + Math.cos(P.yaw) * cp * dist);
    cam.lookAt(T); if (cam.fov !== 74) { cam.fov = 74; cam.updateProjectionMatrix(); } sky.position.copy(cam.position);
  }
  // 名前タグ: カメラの位置が確定した後に、最新のカメラ行列で投影して配置する（以前は1フレーム前の行列でずれていた）
  function tagStep() {
    const cv = (typeof R !== 'undefined' && R.domElement) ? R.domElement.getBoundingClientRect() : null, W = (cv && cv.width) || innerWidth, H = (cv && cv.height) || innerHeight, L0 = cv ? cv.left : 0, T0 = cv ? cv.top : 0, giant = isG();
    cam.updateMatrixWorld(true); const gp = GI[0].G.position, tnow = Date.now();
    O.rem.forEach(r => {
      const tg = r.tag; if (!r.tvis || !r.mesh.visible || !r.tp) { tg.style.display = 'none'; return; }
      const dc = Math.hypot(r.tp[0] - cam.position.x, r.tp[2] - cam.position.z); if (dc > 300 && !giant) { tg.style.display = 'none'; return; }
      if (giant) { const dg0 = Math.hypot(r.tp[0] - gp.x, r.tp[2] - gp.z); // 巨人からは、静かに潜む兵士は見えない: 咆哮中 / 音を立てた直後 / ヒット直後 / 至近距離のみ表示
        if (!(tnow < O.roarUntil || tnow < (r.noisyUntil || 0) || tnow < (r.revealUntil || 0) || dg0 < 45 * GI[0].G.scale.x)) { tg.style.display = 'none'; return; } }
      V.set(r.tp[0], r.tp[1], r.tp[2]).project(cam); let x = V.x, y = V.y; const behind = V.z > 1, out = behind || Math.abs(x) > .94 || Math.abs(y) > .9; let arrow = '';
      if (out) { if (!giant) { tg.style.display = 'none'; return; } // 巨人側: 画面外の兵士は端に矢印つきで表示して位置を見失わない
        if (behind) { x = -x; y = -y; } if (Math.abs(x) < .001 && Math.abs(y) < .001) y = -1;
        const s = Math.max(Math.abs(x) / .9, Math.abs(y) / .82); x /= s; y /= s; arrow = Math.abs(x) / .9 > Math.abs(y) / .82 ? (x < 0 ? '◀ ' : '▶ ') : (y > 0 ? '▲ ' : '▼ '); }
      const dg = Math.round(Math.hypot(r.tp[0] - gp.x, r.tp[2] - gp.z));
      tg.style.display = 'block'; tg.className = 'ntag' + (r.tc ? '' : ' off') + (giant ? ' big' : '') + (out ? ' edge' : '');
      tg.textContent = arrow + r.tn + (giant ? '  ' + dg + 'm' : '');
      tg.style.left = (L0 + (x * .5 + .5) * W) + 'px'; tg.style.top = (T0 + (-y * .5 + .5) * H) + 'px';
    });
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
    O.stompT = O.STOMP_T; useG(GI[0]); ring(); const sc = G.scale.x, near = Math.hypot(P.pos.x - G.position.x, P.pos.z - G.position.z) < 90 || isG();
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
      case 'guard': O.guardUntil = Date.now() + m.ms; if (!isG() && P.slash) { P.slash = false; P.slashT = 0; P.sw2 = false; toast('うなじ守りで弾かれた！'); } break;
      case 'dead': onDead(m.id, m.by); break;
      case 'limb': applyLimb(m.key); break;
      case 'sweep': { useG(GI[0]); sfx('chop', G.position, 2, .12); shake = Math.max(shake, isG() ? .4 : .2); break; }
      case 'swept': { const ids = m.ids || [], now = Date.now();
        ids.forEach(id => { const r = O.rem.get(id); if (r) { r.revealUntil = now + 3000; for (let q = 0; q < 3; q++) spark(r.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xffe2a8); } });
        if (ids.includes(NET.id) && !O.dead && !isG()) { releaseWires(); P.stuck = false; const dx = P.pos.x - m.from[0], dz = P.pos.z - m.from[1], d = Math.hypot(dx, dz) || 1; // 吹き飛ばし・ワイヤー解除・ガス減少・しばらくワイヤー不可
          P.vel.set(dx / d * 45, 14, dz / d * 45); P.gasAmt = Math.max(0, (P.gasAmt || 0) - 35); cd = Math.max(cd, 1.2); shake = 1; popup('薙ぎ払われた！ ワイヤーが外れた', 'big'); }
        break; }
      case 'roar': { O.roarUntil = Date.now() + (m.ms || 4000); O.roarMouth = Date.now() + 1400; shake = Math.max(shake, .8);
        if (isG()) toast('咆哮！ 全員の位置が見える'); else if (!O.dead) popup('巨人の咆哮！ 位置を知られた', 'big'); break; }
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
    Object.assign(O, { me: m.players.find(p => p.id === NET.id), snaps: [], off: null, armT: null, armBtn: [false, false], camBtn: { d: 0, h: 0 }, grab: null, guardUntil: 0, stompT: 0, sweepT: 0, roarUntil: 0, roarMouth: 0, dead: false, giantDead: false, result: null, al: 0, specIdx: 0, cd: { grab: 0, crush: 0, guard: 0, sweep: 0, roar: 0 }, napeCd: 0 }); O.clear();
    NET.on('snap', onSnap); NET.on('event', onEvent); O.active = true; PREF.map = false; PREF.arrow = false;
    if (!O.me) return;
    startGame(); held.visible = false; fig.visible = true; cam.fov = 70; cam.updateProjectionMatrix();
    GI.forEach(o => { o.G.visible = false; o.G.position.set(9000, 0, 9000); });
    if (!O.FIG) { O.FIG = fig.clone(true); O.FIG.visible = true; O.FIG.position.set(0, 0, 0); O.FIG.rotation.set(0, 0, 0); O.FIG.scale.setScalar(1);
      O.FIG.updateMatrixWorld(true); O.FEET = new THREE.Box3().setFromObject(O.FIG).min.y; } // 足元を基準に置くための補正
    gasStations();
    if (!isG()) { const s = SPAWN[O.me.idx % 4]; P.pos.set(s[0], 1.7, s[1]); P.yaw = 0; P.pitch = 0; return; }
    O.fp = false; $$('vw').textContent = '一人称へ (V)'; P.eaten = true; P.pos.set(0, 400, 0); P.yaw = Math.PI; P.pitch = -.25; // 兵士用の物理は止め、入力は巨人に使う
    const o = GI[0]; useG(o); G.visible = true; G.position.set(0, 0, 0); gs.yaw = 0; G.rotation.y = 0; gs.dead = 0; gs.spd = 0;
    ['fire', 'rel', 'sbtn', 'spc', 'gas', 'gbtn'].forEach(id => { const e = $$(id); if (e) { O.ui.push([e, e.style.display]); e.style.display = 'none'; } });
    if (mode === 'SP') GBTN.forEach(b => b.style.display = 'block');
    popup(mode === 'SP' ? '巨人: 左スティック移動 / 右のボタンで走る・掴む・踏みつぶし・うなじ守り・薙ぎ払い・咆哮 / 「右腕」「左腕」を押しながらスティックで腕を動かす / 右上の 拡縮上下 でカメラ調整' : '巨人: WASD移動 / マウスで向き / Shift走る / 左クリック掴む / 右クリック・Space踏みつぶし / Cうなじ守り / B薙ぎ払い（空中にも届く） / T咆哮（全員の位置が見える）', 'big');
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
        sc: G.scale.x, hd: r2(headG.rotation.y), nh: r2(nape.getWorldPosition(V).y - G.position.y), ar: O.armT ? O.armT.map(a => a ? [r2(a[0]), r2(a[1])] : null) : null, limbs: LIMB_KEYS.map(k => gs.parts[k].severed ? 1 : 0) }); }
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
        let r = O.rem.get(sb.id); if (!sb.a || (O.grab && O.grab.id === sb.id)) { if (r) { r.mesh.visible = false; r.line.visible = false; r.tvis = false; r.tag.style.display = 'none'; } continue; }
        if (!r) r = mk(sb.id); r.mesh.visible = r.line.visible = true;
        const x = lp(sa.p[0], sb.p[0], k), y = lp(sa.p[1], sb.p[1], k), z = lp(sa.p[2], sb.p[2], k), yaw = sa.yaw + ad(sb.yaw, sa.yaw) * k;
        r.mesh.position.set(x, y - 1.7 - O.FEET, z); r.mesh.rotation.set(sb.f & 1 ? .3 : 0, yaw, 0);
        const ws = (k > .5 ? sb : sa).w, ps = r.line.geometry.attributes.position, hip = [x, y - .8, z];
        for (let j = 0; j < 2; j++) { const q = ws[j] || hip; ps.setXYZ(j * 2, hip[0], hip[1], hip[2]); ps.setXYZ(j * 2 + 1, q[0], q[1], q[2]); }
        ps.needsUpdate = true;
        const nv = sb.v || [0, 0, 0], nsp = Math.hypot(nv[0], nv[1], nv[2]), tn = Date.now(); // 音: ダッシュ/斬撃中や高速移動中は居場所がバレる（蒸気の軌跡＋巨人の画面に名前が出る）
        if ((sb.f & 12) || nsp > 15) r.noisyUntil = tn + 1500;
        if (tn < (r.noisyUntil || 0) && Math.random() < .35) steam.emit(new THREE.Vector3(x, y - .6, z), new THREE.Vector3((Math.random() - .5) * 2, 1 + Math.random() * 2, (Math.random() - .5) * 2), 1.4, 0);
        r.tp = [x, y + .45, z]; r.tn = nameOf(sb.id) + (sb.c ? '' : '（切断中）'); r.tc = sb.c ? 1 : 0; r.tvis = true; // 名前タグは頭のすぐ上（カメラ確定後に配置）
      }
      O.rem.forEach((r, id) => { if (!seen.has(id)) { r.mesh.visible = r.line.visible = false; r.tvis = false; r.tag.style.display = 'none'; } });
      // 相手の巨人（兵士側で表示）: 位置・向き・頭・速度を補間し、歩行アニメは既存の姿勢計算で再生。欠損は申告に合わせる
      const ga = A.g || B.g, gb = B.g || A.g;
      if (!giant && gb) {
        const o = GI[0]; useG(o); G.visible = true; if (Math.abs(G.scale.x - gb.sc) > .01) G.scale.setScalar(gb.sc);
        LIMB_KEYS.forEach((key, li) => { if (gb.limbs[li] && !gs.parts[key].severed) applyLimb(key); });
        gs.yaw = ga.yaw + ad(gb.yaw, ga.yaw) * k; headG.rotation.y = lp(ga.hd, gb.hd, k); gs.spd = lp(ga.sp, gb.sp, k); gs.run = gb.run ? 5 : 0; gs.dead = O.giantDead ? 1 : 0; gs.mode = 'chase';
        if (legLossOf(gs) > 0) updateLegless(realDt, gs.spd > .4, gs.trait.walkSpeed); else { gs.phase += gs.spd * realDt * 1.8 / (17.4 * (.42 + .33 * gs.rn) * G.scale.x); }
        G.position.set(lp(ga.p[0], gb.p[0], k), lp(ga.p[1], gb.p[1], k), lp(ga.p[2], gb.p[2], k)); G.rotation.y = gs.yaw; O.armT = gb.ar || null; O.pose(o, realDt);
      }
    }
    fxStep(realDt);
    if (giant) { const c1 = Math.ceil((O.cd.crush - now) / 1000), c2 = Math.ceil((O.cd.guard - now) / 1000);
      bCrush.textContent = c1 > 0 ? '踏みつぶし ' + c1 : '踏みつぶし'; bCrush.classList.toggle('cd', c1 > 0); bGuard.textContent = c2 > 0 ? 'うなじ守り ' + c2 : 'うなじ守り'; bGuard.classList.toggle('cd', c2 > 0); bRun.classList.toggle('on', O.runBtn); }
    // HUD とカメラ
    const cdS = t => Math.max(0, Math.ceil((t - now) / 1000));
    if (giant) { const c3 = cdS(O.cd.sweep), c4 = cdS(O.cd.roar); bSweep.textContent = c3 ? '薙ぎ払い ' + c3 : '薙ぎ払い'; bSweep.classList.toggle('cd', c3 > 0); bRoar.textContent = c4 ? '咆哮 ' + c4 : '咆哮'; bRoar.classList.toggle('cd', c4 > 0); }
    let watched = false; // 巨人の視線（正面±約33°・距離110以内・建物に遮られない）に入ると警告
    if (!giant && !O.dead && !over) { const o = GI[0], ya = o.gs.yaw + o.headG.rotation.y, wx = P.pos.x - o.G.position.x, wz = P.pos.z - o.G.position.z, wd = Math.hypot(wx, wz);
      if (o.G.visible && wd > 1 && wd < 110 * o.G.scale.x && (wx * Math.sin(ya) + wz * Math.cos(ya)) / wd > .84) { useG(o); watched = los(); } }
    const msg = over ? '' : giant ? `残り兵士 ${O.al}人 ｜ 踏みつぶし ${cdS(O.cd.crush) || '可'} ｜ うなじ守り ${cdS(O.cd.guard) || '可'}${O.guard ? '（発動中）' : ''} ｜ 薙ぎ払い ${cdS(O.cd.sweep) || '可'} ｜ 咆哮 ${cdS(O.cd.roar) || '可'}${mode === 'PC' ? ' ｜ 左クリック掴む / 右クリック・Space踏みつぶし / Cうなじ守り / B薙ぎ払い / T咆哮 / Shift走る / V視点 / Q・E+WASDで腕 / Z・Xズーム R・F高さ' : ''}`
      : O.dead ? '観戦中（クリック/Tabで視点切替）' : `生存兵士 ${O.al}人 ｜ 巨人のうなじを背後から斬れ${O.gas.some(g => g.m.visible && P.pos.distanceTo(g.m.position) < 8) ? ' ｜ ガス補給中' : ''}${watched ? ' ｜ ⚠ 巨人に見られている！' : ''}`;
    hud.msg.textContent = msg;
    if (giant && !isPaused) { // カメラ距離/高さ: Z/X=ズーム, R/F=高さ, ホイール=ズーム, 画面の「拡縮上下」ボタン
      const dz = (keys.KeyX || O.camBtn.d > 0 ? 1 : 0) - (keys.KeyZ || O.camBtn.d < 0 ? 1 : 0), dh = (keys.KeyR || O.camBtn.h > 0 ? 1 : 0) - (keys.KeyF || O.camBtn.h < 0 ? 1 : 0);
      if (dz || dh) { O.camD = Math.max(18, Math.min(220, O.camD + dz * 70 * realDt)); O.camH = Math.max(-10, Math.min(90, O.camH + dh * 35 * realDt)); O.camDirty = true; } else if (O.camDirty) { O.camDirty = false; camSave(); }
    }
    if (giant) giantCam(); else if (O.dead && !over) specCam();
    tagStep();
  };
  addEventListener('click', e => { if (O.dead && !over && !(e.target.closest && e.target.closest('button'))) O.specIdx++; });
  NET.on('start', m => {
    if (m.resumed && O.active && O.me) { O.me = m.players.find(p => p.id === NET.id) || O.me; if ((m.dead || []).includes(NET.id) && !O.dead) onDead(NET.id, 'left'); return; } // 再接続: 試合を巻き戻さず復帰
    O.start(m);
  });
  return O;
})();
// index.html のフックは window.ONL を見るため、const 宣言のままでは見えない。明示的に公開する
window.NET = NET; window.ONL = ONL;

// ---- 画面リセット / タッチ入力の固着対策（ソロ・オンライン共通）----
(() => {
  const $ = id => document.getElementById(id), jz = $('joy');
  const resetStick = () => { try { jid = null; lid = null; joy = { x: 0, y: 0 }; } catch (e) {} if (jz && jz.firstChild) jz.firstChild.style.transform = ''; };
  function resetZoom() { // viewport を作り直してピンチ拡大を元に戻す
    document.querySelectorAll('meta[name=viewport]').forEach(m => m.remove());
    const n = document.createElement('meta'); n.name = 'viewport'; n.content = 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover'; document.head.appendChild(n);
    scrollTo(0, 0); setTimeout(() => { scrollTo(0, 0); dispatchEvent(new Event('resize')); }, 350);
  }
  function resetAll() {
    resetStick(); for (const k in keys) delete keys[k];
    try { gasHold = false; fireDown = false; } catch (e) {}
    try { ONL.resetTouch(); } catch (e) {}
    resetZoom();
  }
  // 固着の原因対策: システムジェスチャー等で touchend が来ずに touchcancel になる／識別子が食い違う場合でもスティックを解除する
  addEventListener('touchcancel', e => { for (const t of e.changedTouches) { try { if (t.identifier == jid) { jid = null; joy = { x: 0, y: 0 }; if (jz.firstChild) jz.firstChild.style.transform = ''; } if (t.identifier == lid) lid = null; } catch (x) {} } }, true);
  addEventListener('touchstart', e => { const ids = new Set([...e.touches].map(t => t.identifier)); try { if (jid !== null && !ids.has(jid)) { jid = null; joy = { x: 0, y: 0 }; if (jz.firstChild) jz.firstChild.style.transform = ''; } if (lid !== null && !ids.has(lid)) lid = null; } catch (x) {} }, { capture: true, passive: true });
  addEventListener('touchend', e => { if (!e.touches.length) resetStick(); }, true);
  addEventListener('blur', () => { resetStick(); for (const k in keys) delete keys[k]; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { resetStick(); for (const k in keys) delete keys[k]; try { ONL.resetTouch(); } catch (e) {} } });
  // ピンチ拡大・ダブルタップ拡大を常に抑止（iOS の gesture* と、2本指の touchmove）
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => addEventListener(t, e => e.preventDefault(), { passive: false }));
  addEventListener('touchmove', e => { if (e.touches.length > 1 && !(e.target.closest && e.target.closest('#lobby,#ov,#setOv,#achOv'))) e.preventDefault(); }, { passive: false });
  // ポーズ画面の「画面リセット」ボタン
  const rb = $('resetViewBtn'); if (rb) { let t0 = 0, sx = 0, sy = 0, ok = false;
    const fire = () => { const n = Date.now(); if (n - t0 < 400) return; t0 = n; resetAll(); rb.textContent = '✓ リセットしました'; setTimeout(() => { rb.textContent = '画面リセット'; }, 1600); };
    rb.addEventListener('click', fire);
    rb.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; ok = true; }, { passive: true });
    rb.addEventListener('touchmove', e => { const t = e.changedTouches[0]; if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) ok = false; }, { passive: true });
    rb.addEventListener('touchend', e => { if (!ok) return; ok = false; e.preventDefault(); fire(); }, { passive: false }); }
})();
