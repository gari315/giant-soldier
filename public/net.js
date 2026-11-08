'use strict';
// オンライン通信とロビー。ゲーム本体(index.html のインラインscript)の後に読み込まれる。
const NET_BUILD = '2026-11-09a'; // 読み込まれている net.js の版（ロビー画面の下に表示）
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
    GRAB_REACH: 12, KICK_R: 16, KICK_H: 22, KICK_T: 1.6, KICK_HIT: 1.13, crouchBtn: false, grabTry: 0, ROAR_CD: 14000, kickT: 0, roarUntil: 0, roarMouth: 0, armId: null, armStick: { x: 0, y: 0, sx: 0, sy: 0 },         // サーバー(server.js の C)と合わせる
    grab: null, camD: 60, camH: 12, zoomOn: false, zk: 1, camBtn: { d: 0, h: 0 }, armT: null, guardUntil: 0, cd: { roar: 0 }, dead: false, giantDead: false, al: 0, specIdx: 0, napeCd: 0, applying: false, gas: [], ui: [] };
  const $$ = id => document.getElementById(id);
  try { const j = JSON.parse(localStorage.getItem('gvsGiantCam') || 'null'); if (j) { O.camD = Math.max(18, Math.min(220, +j.d || 72)); O.camH = Math.max(-10, Math.min(90, isNaN(+j.h) ? 12 : +j.h)); } } catch (e) {}
  const camSave = () => { try { localStorage.setItem('gvsGiantCam', JSON.stringify({ d: O.camD, h: O.camH })); } catch (e) {} };
  const st = document.createElement('style');
  st.textContent = `.ntag{position:fixed;z-index:2;pointer-events:none;display:none;font:700 12px "Noto Serif JP",serif;color:#fff;text-shadow:0 1px 3px #000;transform:translate(-50%,-100%);white-space:nowrap;text-align:center;will-change:left,top}.ntag.off{color:#f88}
.ntag::after{content:"▼";display:block;line-height:.9;font-size:12px;color:#ffd27a;text-shadow:0 1px 2px #000}.ntag.big{font-size:15px}.ntag.big::after{font-size:16px}.ntag.edge{transform:translate(-50%,-50%);background:#000a;border-radius:10px;padding:2px 8px}.ntag.edge::after{display:none}
.gbt{position:fixed;z-index:4;display:none;width:78px;height:78px;border-radius:50%;font:700 13px sans-serif;line-height:1.2;background:#000a;color:#fff;border:2px solid #fff9;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.gbt.sm{width:44px;height:44px;border-radius:10px;font-size:15px}
.gbt.on{background:#d9822bdd;border-color:#fff}.gbt.cd{opacity:.5}
#joyA{position:fixed;z-index:4;display:none;border-radius:50%;background:#fff1;border:2px solid #fff4;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}#joyA b{position:absolute;width:38%;height:38%;left:31%;top:31%;border-radius:50%;background:#fff6}#joyA.on{background:#ffb04033;border-color:#ffd28a}#joyA i{position:absolute;left:0;right:0;top:-17px;text-align:center;font:700 11px sans-serif;font-style:normal;color:#fffc;text-shadow:0 1px 2px #000}.ntag.rev{color:#ff9a8a;font-size:16px}
#deathBn{position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);z-index:7;text-align:center;pointer-events:none;display:none;color:#fff;text-shadow:0 2px 8px #000;max-width:88vw}#deathBn h2{margin:0 0 8px;font:900 clamp(26px,7vw,52px) "Noto Serif JP",serif;color:#ff6a5a;letter-spacing:.08em}#deathBn p{margin:3px 0;font:700 clamp(12px,3.2vw,16px) "Noto Serif JP",serif;background:#000b;padding:4px 10px;border-radius:8px;display:inline-block}
#hitFlash{position:fixed;inset:0;z-index:6;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,#ff2a1a00 25%,#ff2a1acc 100%)}#hitFlash.w{background:radial-gradient(circle at 50% 50%,#ffffff55 0%,#fffffff0 100%)}
#mm{position:fixed;left:8px;top:56px;z-index:3;display:none;pointer-events:none;border-radius:50%;border:2px solid #fff6;background:#0009}.nring{position:fixed;z-index:1;pointer-events:none;display:none;border:2px solid #ffb454;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 6px #000,0 0 8px currentColor inset}
#kf{position:fixed;left:8px;top:96px;z-index:3;pointer-events:none;font:700 12px sans-serif;color:#fff;text-shadow:0 1px 3px #000}#kf div{background:#000a;margin:2px 0;padding:2px 8px;border-radius:6px;width:fit-content}
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
  const bRun = mkBtn('gRun', '走る', 14, 24, v => { O.runBtn = v; });
  const bCrouch = mkBtn('gCrouch', 'しゃがむ', 14, 24, v => { O.crouchBtn = v; });
  const bKick = mkBtn('gKick', '蹴り', 14, 24, v => { if (v) actKick(); });
  const bGuard = mkBtn('gGuard', 'うなじ守り', 14, 24, v => { if (v) actGuard(); });
  const bRoar = mkBtn('gRoar', '咆哮', 14, 24, v => { if (v) actRoar(); });
  const bZoom = mkBtn('gZoom', '寄る', 14, 24, v => { if (v) zoomToggle(); });
  const zoomToggle = () => { O.zoomOn = !O.zoomOn; bZoom.classList.toggle('on', O.zoomOn); toast(O.zoomOn ? 'カメラを寄せました（もう一度で戻る）' : 'カメラを戻しました'); };
  const bCamIn = mkBtn('gCamIn', '拡', 0, 0, v => { O.camBtn.d = v ? -1 : 0; }, 'sm', 50);
  const bCamOut = mkBtn('gCamOut', '縮', 0, 0, v => { O.camBtn.d = v ? 1 : 0; }, 'sm', 50);
  const bCamUp = mkBtn('gCamUp', '上', 0, 0, v => { O.camBtn.h = v ? 1 : 0; }, 'sm', 50);
  const bCamDn = mkBtn('gCamDn', '下', 0, 0, v => { O.camBtn.h = v ? -1 : 0; }, 'sm', 50);
  const mm = document.createElement('canvas'); mm.id = 'mm'; document.body.appendChild(mm); let mmS = 100; const mmc = mm.getContext('2d');
  const aj = document.createElement('div'); aj.id = 'joyA'; aj.innerHTML = '<i>腕</i><b></b>'; document.body.appendChild(aj); const ajThumb = aj.querySelector('b'); // 腕スティック（右下）
  const GBTN = [bRun, bCrouch, bKick, bGuard, bRoar, bZoom, bCamIn, bCamOut, bCamUp, bCamDn, aj];
  function layout() { // 画面の高さに合わせてボタンと腕スティックを配置（横向きスマホでも重ならないように）
    const H = innerHeight, u = Math.round(Math.max(52, Math.min(78, H * .17))), g = 8, r0 = 14, b0 = 24, D = Math.round(Math.max(88, Math.min(124, H * .28)));
    const place = (b, col, row) => { b.style.width = b.style.height = u + 'px'; b.style.right = (r0 + col * (u + g)) + 'px'; b.style.bottom = (b0 + row * (u + g)) + 'px'; b.style.top = 'auto'; b.style.fontSize = u < 64 ? '11px' : '13px'; };
    place(bRun, 0, 0); place(bCrouch, 1, 0); place(bRoar, 2, 0); place(bKick, 0, 1); place(bGuard, 1, 1); place(bZoom, 2, 1);
    mm.width = mm.height = mmS = Math.round(Math.max(84, Math.min(120, H * .26))); mm.style.width = mm.style.height = mmS + 'px';
    aj.style.width = aj.style.height = D + 'px'; aj.style.right = (r0 + (2 * u + g - D) / 2) + 'px'; aj.style.bottom = (b0 + 2 * (u + g) + 6) + 'px';
    [bCamDn, bCamUp, bCamOut, bCamIn].forEach((b, k) => { b.style.width = b.style.height = '40px'; b.style.right = (8 + k * 46) + 'px'; b.style.top = '50px'; b.style.bottom = 'auto'; });
  }
  layout(); addEventListener('resize', layout); addEventListener('orientationchange', () => setTimeout(layout, 300));

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
    gs.c += ((gr ? .6 : gs.cq ? .85 : 0) - gs.c) * Math.min(1, 3 * dt); const cr = gs.c, wk = 1 - cr, ys = [], ph = gs.phase;
    gs.rn += (((gs.run > 0) && !gs.dead && (gs.spd || 0) > 2 ? 1 : 0) - gs.rn) * Math.min(1, 4 * dt);
    const swf = Math.min(1, Math.max(0, ((gs.spd || 0) - .4) / 2.6)), ll = legLossOf(gs), hk = gs.stag > 0 ? Math.min(1, gs.stag / 1.4) : gs.hurt > 0 ? .15 : 0;
    if (ll === 0) {
      legs.forEach((L, i) => { const ps = ph + (i ? Math.PI : 0); let a = Math.sin(ps) * (.42 + .33 * gs.rn) * wk * swf - cr * 1.1, b = Math.pow(Math.max(0, -Math.cos(ps)), 1.5) * (.6 + .8 * gs.rn) * wk * swf + cr * 1.9;
        a = Math.max(-1.3, Math.min(.9, a)); b = Math.max(0, Math.min(2.3, b));
        if (O.kickT > 0 && i === 0) { const u = 1 - O.kickT / O.KICK_T, K = (p, q, t) => p + (q - p) * t; let ka, kb; // 蹴り: 脚を引く → 前へ蹴り出す → 戻す（可動域: 股関節 -1.35〜.5 / 膝 0〜1.5）
          if (u < .65) { const t = u / .65, e = t * t * (3 - 2 * t); ka = K(0, .55, e); kb = K(0, 1.5, e); } // 予備動作: 約1秒かけて脚をゆっくり引く（腕を広げ、上体をそらす）
          else if (u < .72) { const t = (u - .65) / .07; ka = K(.55, -1.35, t); kb = K(1.5, .15, t); } // 蹴り出し（約0.1秒）
          else { const t = (u - .72) / .28, e = t * t * (3 - 2 * t); ka = K(-1.35, 0, e); kb = K(.15, 0, e); }
          a = ka; b = kb; }
        L.th.rotation.x = a; L.kn.rotation.x = b; L.an.rotation.x = -(a + b); L.an.rotation.z = 0; ys.push(1 + 9 * Math.cos(a) + 8.4 * Math.cos(a + b) + .6); });
      if (O.kickT > 0) ys[0] = ys[1]; // 蹴り中は支え脚の高さに腰を保つ（沈み込み防止）
      const ny = (ys[0] + ys[1] + Math.sqrt((ys[0] - ys[1]) ** 2 + .3)) / 2 - .27; gs.yUp = ny;
      pelvis.position.set(0, ny, 0); pelvis.rotation.set(0, Math.sin(ph) * .1 * wk, 0);
      const kl = O.kickT > 0 ? (() => { const u = 1 - O.kickT / O.KICK_T; return u < .65 ? .3 * (u / .65) : u < .72 ? .3 : .3 * (1 - (u - .72) / .28); })() : 0; // 蹴りの予備動作で上体をそらす
      spine.rotation.set(cr * .9 + hk * .8 + .3 * gs.rn * wk - kl, -Math.sin(ph) * .12 * wk + Math.sin(tw * 9) * .12 * (gs.stag > 0 ? hk : 0), 0); chest.rotation.set(cr * .4 + hk * .5, 0, 0); neck.rotation.x = -cr * .9 - hk * .5;
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
  function autoGrab() { // 巨人の手に兵士が触れたら、いつでも（向き・状況を問わず）掴む。判定はサーバーが手の位置で検証
    if (O.grab || O.dead || over || isPaused) return; const now = Date.now(); if (now - O.grabTry < 150) return;
    const o = GI[0]; useG(o); const sc = G.scale.x, hp = new THREE.Vector3(); let best = null, bd = 1e9;
    arms.forEach((A, i) => { if (gs.parts[i === 0 ? 'leftArm' : 'rightArm'].severed) return; A.wr.getWorldPosition(hp);
      O.rem.forEach((r, id) => { if (!r.mesh.visible || !r.tp) return; const d = Math.hypot(hp.x - r.tp[0], hp.y - r.cy, hp.z - r.tp[2]); if (d < 4 * sc && d < bd) { bd = d; best = id; } }); });
    if (best) { O.grabTry = now; NET.send({ t: 'event', k: 'grab', id: best }); }
  }
  function actKick() { // 蹴り: 周囲すべて（全方向）が対象。クールダウンなし（モーション中は連打不可）。脚を失うと蹴れない
    if (!canAct() || O.kickT > 0) return; const now = Date.now(); useG(GI[0]);
    if (now < O.guardUntil) return toast('うなじ守り中は蹴れません');
    if (legLossOf(gs) > 0) return toast('脚がないと蹴れません'); if (gs.cq) return toast('しゃがみ中は蹴れません');
    NET.send({ t: 'event', k: 'kick' }); toast('蹴り！（周囲すべてが対象）');
  }
  function actGuard() {
    if (!canAct() || O.grab) return; const now = Date.now(); if (now < O.guardUntil) return;
    NET.send({ t: 'event', k: 'guard' }); toast('うなじ守り！（動けません）');
  }
  function actRoar() { // 咆哮: 数秒間、全兵士の位置が巨人の画面に表示される
    if (!canAct()) return; const now = Date.now();
    if (now < O.cd.roar) return toast('咆哮は あと' + Math.ceil((O.cd.roar - now) / 1000) + '秒');
    O.cd.roar = now + O.ROAR_CD; NET.send({ t: 'event', k: 'roar' });
  }
  const vwToggle = () => { const n = Date.now(); if (!O.active || !isG() || n - (O.vwT || 0) < 350) return; O.vwT = n; O.fp = !O.fp; $$('vw').textContent = O.fp ? '三人称へ (V)' : '一人称へ (V)'; toast(O.fp ? '一人称（巨人の目線）' : '三人称'); };
  ['click', 'touchstart'].forEach(t => $$('vw').addEventListener(t, vwToggle, { passive: true }));
  addEventListener('mousedown', e => { if (!O.active || !isG() || over || isPaused || !(document.pointerLockElement || mode === 'PC')) return; if (e.target.closest && e.target.closest('button,#lobby,#resOv,#pauseOv')) return; if (e.button === 2) actKick(); });
  addEventListener('contextmenu', e => { if (O.active) e.preventDefault(); });
  addEventListener('wheel', e => { if (O.active && isG() && !isPaused) { O.camD = Math.max(18, Math.min(220, O.camD + Math.sign(e.deltaY) * 6)); camSave(); } }, { passive: true });
  addEventListener('keydown', e => { if (!O.active || isPaused) return;
    if (isG()) { if (e.code === 'Space') { actKick(); e.preventDefault(); } else if (e.code === 'KeyC') actGuard(); else if (e.code === 'KeyV') vwToggle(); else if (e.code === 'KeyT') actRoar(); else if (e.code === 'KeyB') zoomToggle(); }
    else if (O.dead && e.code === 'Tab') { O.specIdx++; e.preventDefault(); } });
  $$('specBtn').onclick = () => { O.specIdx++; };

  // ---- スマホ: タップ座標と「見えている矩形」で当たり判定する ----
  // ブラウザのDOM当たり判定が、上下バーの出入りなどで見た目とずれる環境があるため、
  // オンライン中のスマホでは、ボタンをタップ座標と矩形の比較で判定する（実際に見えている位置が基準）。
  const synth = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  const TAP = [
    { el: bRun, down: bRun._down, up: bRun._up }, { el: bCrouch, down: bCrouch._down, up: bCrouch._up },
    { el: bKick, down: bKick._down, up: bKick._up }, { el: bGuard, down: bGuard._down, up: bGuard._up },
    ...[bRoar, bZoom, bCamIn, bCamOut, bCamUp, bCamDn].map(b => ({ el: b, down: b._down, up: b._up })),
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
    if (O.armId != null && !ids.has(O.armId)) ajEnd();
  }, { capture: true, passive: true });
  // 腕スティック: 指の位置から (x:右+, y:上+) を求める。離したら元の姿勢に戻る
  const ajUpdate = t => { const r = aj.getBoundingClientRect(), R = r.width / 2; let x = (t.clientX - (r.left + R)) / R, y = -(t.clientY - (r.top + r.height / 2)) / R; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    O.armStick.x = x; O.armStick.y = y; ajThumb.style.transform = `translate(${x * R * .62}px,${-y * R * .62}px)`; };
  const ajEnd = () => { O.armId = null; O.armStick.x = O.armStick.y = O.armStick.sx = O.armStick.sy = 0; ajThumb.style.transform = ''; aj.classList.remove('on'); };
  const ajStart = t => { if (O.armId != null || !isG() || !shown(aj)) return false; const r = aj.getBoundingClientRect(), R = r.width / 2;
    if (Math.hypot(t.clientX - (r.left + R), t.clientY - (r.top + r.height / 2)) > R + 10) return false; O.armId = t.identifier; aj.classList.add('on'); ajUpdate(t); return true; };
  addEventListener('touchmove', e => { if (O.armId == null) return; for (const t of e.changedTouches) if (t.identifier === O.armId) ajUpdate(t); }, { capture: true, passive: true });
  O.resetTouch = () => { act.forEach(hit => { if (hit.el.classList) hit.el.classList.remove('on'); if (hit.up) try { hit.up(); } catch (x) {} }); act.clear(); O.runBtn = false; O.camBtn = { d: 0, h: 0 }; bRun.classList.remove('on'); ajEnd(); };
  addEventListener('touchstart', e => {
    if (!O.active) return; let used = false;
    for (const t of e.changedTouches) { if (ajStart(t)) { used = true; continue; } const hit = hitTap(t.clientX, t.clientY);
      if (dbg) { const d = document.elementFromPoint(t.clientX, t.clientY), vv = window.visualViewport; dbg.textContent = `touch ${t.clientX | 0},${t.clientY | 0}  inner ${innerWidth}x${innerHeight}` + (vv ? `  vv ${vv.width | 0}x${vv.height | 0} off ${vv.offsetLeft | 0},${vv.offsetTop | 0} s${vv.scale.toFixed(2)}` : '') + `\nDOM:${d && (d.id || d.tagName)}  自前:${hit ? (hit.el.id || '?') : '-'}`; }
      if (hit) { act.set(t.identifier, hit); if (hit.el.classList) hit.el.classList.add('on'); hit.down(); used = true; } }
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); } // 元の視点/スティック処理にはこのタッチを渡さない
  }, { capture: true, passive: false });
  const tapEnd = e => { if (O.armId != null) { for (const t of e.changedTouches) if (t.identifier === O.armId) ajEnd(); if (!e.touches.length) ajEnd(); } for (const t of e.changedTouches) { const hit = act.get(t.identifier); if (hit) { act.delete(t.identifier); if (hit.el.classList) hit.el.classList.remove('on'); if (hit.up) hit.up(); } } };
  addEventListener('touchend', tapEnd, true); addEventListener('touchcancel', tapEnd, true);
  addEventListener('gesturestart', e => { if (O.active) e.preventDefault(); }); // iOS: ピンチ拡大でレイアウトがずれるのを防ぐ

  // 視覚効果: 踏みつぶしの衝撃波 / うなじ守りのバリア
  O.fx = []; let shield = null;
  function ring() { const sc = GI[0].G.scale.x, m = new THREE.Mesh(new THREE.RingGeometry(.9, 1.3, 48), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(GI[0].G.position.x, .5, GI[0].G.position.z); S.add(m); O.fx.push({ m, t: 0, R: (O.KICK_R || 16) * sc }); }
  function fxStep(dt) {
    const wf = O.waveFx; if (wf) { wf.t += dt; const k = Math.min(1, wf.t / .35), e = 1 - (1 - k) * (1 - k); // 衝撃波: 約0.35秒で全範囲に広がる（ドームの高さ=当たる高さ）
      wf.wr.scale.setScalar(Math.max(.01, wf.R * e)); wf.wr.material.opacity = 1 - .85 * k; wf.dome.scale.set(Math.max(.01, wf.R * e), Math.max(.01, wf.H * e), Math.max(.01, wf.R * e)); wf.dome.material.opacity = .45 * (1 - k);
      if (wf.t > .6) { S.remove(wf.wr); S.remove(wf.dome); O.waveFx = null; } }
    { // 巨人の手の危険範囲（触れると掴まれる半径）を赤い光で表示。兵士が近づくと強く光る
      if (!O.halo) O.halo = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: .2, depthWrite: false })); m.visible = false; m.renderOrder = 5; S.add(m); return m; });
      const o0 = GI[0], sc0 = o0.G.scale.x, tp = Date.now() / 1000, vis = O.active && !over && o0.G.visible && !o0.gs.dead && !O.giantDead;
      O.halo.forEach((m, i) => { const sev = o0.gs.parts[i === 0 ? 'leftArm' : 'rightArm'].severed; m.visible = vis && !sev; if (!m.visible) return; o0.arms[i].wr.getWorldPosition(m.position);
        const close = !isG() && !O.dead && Math.hypot(P.pos.x - m.position.x, P.pos.y - m.position.y, P.pos.z - m.position.z) < 14 * sc0;
        m.scale.setScalar(4 * sc0 * (1 + .04 * Math.sin(tp * 6))); m.material.opacity = .15 + .1 * Math.sin(tp * 5 + i) + (close ? .25 : 0); m.material.color.setHex(close ? 0xff2200 : 0xff5a3a); });
    }
    const kf = O.kickFx; if (kf) { kf.t += dt; const k = Math.min(1, kf.t / kf.T), gp = GI[0].G.position; // 赤い円が中心から満ちていき、満ちた瞬間に判定
      kf.fill.position.set(gp.x, .7, gp.z); kf.edge.position.set(gp.x, .7, gp.z); kf.fill.scale.setScalar(Math.max(.01, kf.R * k)); kf.fill.material.opacity = .18 + .3 * k; kf.edge.material.opacity = .6 + .4 * Math.abs(Math.sin(kf.t * 10));
      if (kf.t > kf.T + .15) { S.remove(kf.fill); S.remove(kf.edge); O.kickFx = null; } }
    for (let i = O.fx.length - 1; i >= 0; i--) { const f = O.fx[i]; f.t += dt; const k = Math.min(1, f.t / .6); f.m.scale.setScalar(1 + k * f.R); f.m.material.opacity = .85 * (1 - k); if (k >= 1) { S.remove(f.m); O.fx.splice(i, 1); } }
    const on = Date.now() < O.guardUntil; if (on && !shield) { shield = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: .4, depthWrite: false })); GI[0].nape.add(shield); }
    if (shield) { shield.visible = on; if (on) shield.scale.setScalar(1 + .08 * Math.sin(Date.now() / 60)); }
  }

  function giantStep(dt) {
    const o = GI[0]; useG(o); P.pitch = Math.max(-.9, Math.min(.5, P.pitch));
    const c = Math.cos(P.yaw), sn = Math.sin(P.yaw);
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joy.x, mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - joy.y; let l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    const hold = [!!keys.KeyE, !!keys.KeyQ]; // PC: E=右腕, Q=左腕 を押しながら WASD
    // 腕の可動域: 外側へは大きく、体の内側へは 0.6 倍まで（反対側へ突き抜けない）、下方向は 0.75 倍まで。前方向（z>0）へのみ伸びるので背中側には回らない
    const armLimit = (i, ax, ay) => { const out = i === 0 ? 1 : -1; if (ax * out < 0) ax *= .6; if (ay < 0) ay *= .75; return [ax, ay]; };
    if (O.armId != null && !O.grab) { const a = O.armStick, kk = Math.min(1, 14 * dt); a.sx += (a.x - a.sx) * kk; a.sy += (a.y - a.sy) * kk; O.armT = [armLimit(0, a.sx, a.sy), armLimit(1, a.sx, a.sy)]; } // 腕スティック: 両腕がスティックの向きへ
    else if ((hold[0] || hold[1]) && !O.grab) { O.armT = hold.map((h, i) => h ? armLimit(i, mx, mz) : null); mx = 0; mz = 0; l = 0; } else O.armT = null;
    if (O.kickT > 0 && O.armId == null && !O.grab) O.armT = [[.9, .5], [-.9, .5]]; // 蹴りの予備動作: 両腕を広げて上げる（兵士に分かりやすく）
    if (O.kickT > 0) { mx = 0; mz = 0; l = 0; } // 蹴り中は動けない
    const dx = c * mx - sn * mz, dz = -sn * mx - c * mz, moving = l > .15, run = !!(keys.ShiftLeft || keys.ShiftRight || O.runBtn);
    gs.hurt = Math.max(0, gs.hurt - dt); gs.stag = Math.max(0, gs.stag - dt); Object.values(gs.parts).forEach(q => q.cooldown = Math.max(0, q.cooldown - dt));
    gs.mode = 'chase'; gs.run = run ? 5 : 0; gs.dead = 0; O.guard = Date.now() < O.guardUntil;
    const legLoss = legLossOf(gs), armLoss = (gs.parts.leftArm.severed ? 1 : 0) + (gs.parts.rightArm.severed ? 1 : 0), limbless = legLoss === 2 && armLoss === 2, tr = gs.trait;
    gs.cq = (keys.KeyG || O.crouchBtn) && legLoss === 0 && !O.grab && O.kickT <= 0 ? 1 : 0; // しゃがみ（PC: Gキー押しっぱなし / スマホ: 「しゃがむ」ボタン）。速度は半分
    const hd = moving ? Math.atan2(dx, dz) : gs.yaw, da = ad(hd, gs.yaw);
    const turnMul = limbless ? 0 : legLoss === 2 ? .35 : legLoss === 1 ? (gs.hph ? 0 : .6) : 1;
    const turnStep = (gs.run > 0 ? tr.turnRate * 1.2 : tr.turnRate * .85) * dt * turnMul * O.TURN_MUL; gs.yaw += Math.max(-turnStep, Math.min(turnStep, da)); G.rotation.y = gs.yaw;
    if (limbless) headG.rotation.y += (.6 * gs.limbSide - headG.rotation.y) * Math.min(1, 3 * dt);
    else { const ty = Math.max(-.7, Math.min(.7, ad(Math.atan2(-sn, -c), gs.yaw))); headG.rotation.y += (ty - headG.rotation.y) * Math.min(1, 8 * dt); }
    const canGo = moving && gs.stag <= 0 && !limbless && !O.guard && !O.grab; gs.mv = canGo; // 守り中・掴み中は動けない
    const base = (gs.run > 0 ? tr.chaseSpeed : tr.walkSpeed) * (gs.hurt > 0 ? .45 : 1) * O.SPD_MUL * (gs.cq ? .5 : 1);
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
    const T = new THREE.Vector3(G.position.x, 24 * sc, G.position.z), cp = Math.cos(P.pitch), dist = Math.max(22, O.camD * O.zk) * sc;
    cam.position.set(T.x + Math.sin(P.yaw) * cp * dist, Math.max(4, T.y - Math.sin(P.pitch) * dist + O.camH * sc), T.z + Math.cos(P.yaw) * cp * dist);
    cam.lookAt(T); if (cam.fov !== 74) { cam.fov = 74; cam.updateProjectionMatrix(); } sky.position.copy(cam.position);
  }
  // 名前タグ: カメラの位置が確定した後に、最新のカメラ行列で投影して配置する（以前は1フレーム前の行列でずれていた）
  const V2 = new THREE.Vector3(); let mmT = 0;
  function mapStep(rdt) { // 巨人用ミニマップ: 画面の上方向=カメラの向き。家・兵士（色・高さ）・蹴りの範囲を表示
    const show = isG() && !over; mm.style.display = show ? 'block' : 'none'; kf.style.left = show ? (mmS + 20) + 'px' : '8px'; kf.style.top = show ? '56px' : '96px'; if (!show) return;
    mmT += rdt; if (mmT < .08) return; mmT = 0;
    const o = GI[0], gp = o.G.position, sc = o.G.scale.x, dir = cam.getWorldDirection(new THREE.Vector3()); let fx = dir.x, fz = dir.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const half = mmS / 2, RM = 130, k = (half - 3) / RM, c = mmc; c.clearRect(0, 0, mmS, mmS); c.save(); c.beginPath(); c.arc(half, half, half - 1, 0, 6.283); c.clip();
    c.save(); c.setTransform(-fz * k, -fx * k, fx * k, -fz * k, half, half);
    c.fillStyle = '#6a625a'; for (const b of buildingList) { if (b.destroyed) continue; const dx = b.px - gp.x, dz = b.pz - gp.z; if (Math.abs(dx) > RM * 1.5 || Math.abs(dz) > RM * 1.5) continue; c.fillRect(dx - b.w / 2, dz - b.w / 2, b.w, b.w); }
    c.restore();
    c.strokeStyle = '#ff6a4a99'; c.lineWidth = 1; c.beginPath(); c.arc(half, half, O.KICK_R * sc * k, 0, 6.283); c.stroke(); // 蹴りの範囲
    O.rem.forEach(r => { if (!r.tvis || !r.mesh.visible || !r.rp) return; let dx = r.rp[0] - gp.x, dz = r.rp[2] - gp.z, sx = -fz * dx + fx * dz, sy = -fx * dx - fz * dz; const dd = Math.hypot(sx, sy), lim = half - 5; let rad = 3 + (r.cy > 25 ? 1.5 : 0);
      if (dd * k > lim) { sx = sx / dd * lim / k; sy = sy / dd * lim / k; rad = 2.2; } c.fillStyle = r.col || '#ffd24a'; c.beginPath(); c.arc(half + sx * k, half + sy * k, rad, 0, 6.283); c.fill(); if (r.cy > 25) { c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); } }); // 高い所にいる兵士は白縁つき
    const gx = Math.sin(o.gs.yaw), gz = Math.cos(o.gs.yaw), ax = -fz * gx + fx * gz, ay = -fx * gx - fz * gz, px = -ay, py = ax; // 巨人（向きの三角）
    c.fillStyle = '#ff4a3a'; c.beginPath(); c.moveTo(half + ax * 7, half + ay * 7); c.lineTo(half - ax * 4 + px * 4.5, half - ay * 4 + py * 4.5); c.lineTo(half - ax * 4 - px * 4.5, half - ay * 4 - py * 4.5); c.closePath(); c.fill(); c.restore();
  }
  function tagStep() {
    const cv = (typeof R !== 'undefined' && R.domElement) ? R.domElement.getBoundingClientRect() : null, W = (cv && cv.width) || innerWidth, H = (cv && cv.height) || innerHeight, L0 = cv ? cv.left : 0, T0 = cv ? cv.top : 0, giant = isG();
    cam.updateMatrixWorld(true); const gp = GI[0].G.position, tnow = Date.now();
    O.rem.forEach(r => {
      const tg = r.tag; if (!r.tvis || !r.mesh.visible || !r.tp) { tg.style.display = 'none'; if (r.ring) r.ring.style.display = 'none'; return; }
      const dc = Math.hypot(r.tp[0] - cam.position.x, r.tp[2] - cam.position.z); if (dc > 300 && !giant) { tg.style.display = 'none'; if (r.ring) r.ring.style.display = 'none'; return; }
      V.set(r.tp[0], r.tp[1], r.tp[2]).project(cam); let x = V.x, y = V.y; const behind = V.z > 1, out = behind || Math.abs(x) > .94 || Math.abs(y) > .9; let arrow = '';
      if (out) { if (r.ring) r.ring.style.display = 'none'; if (!giant) { tg.style.display = 'none'; return; } // 巨人側: 画面外の兵士は端に矢印つきで表示して位置を見失わない
        if (behind) { x = -x; y = -y; } if (Math.abs(x) < .001 && Math.abs(y) < .001) y = -1;
        const s = Math.max(Math.abs(x) / .9, Math.abs(y) / .82); x /= s; y /= s; arrow = Math.abs(x) / .9 > Math.abs(y) / .82 ? (x < 0 ? '◀ ' : '▶ ') : (y > 0 ? '▲ ' : '▼ '); }
      const dg = Math.round(Math.hypot(r.tp[0] - gp.x, r.tp[2] - gp.z)), rg = r.ring || (r.ring = (() => { const e = document.createElement('div'); e.className = 'nring'; document.body.appendChild(e); return e; })());
      if (!out && (giant || dc > 30)) { V2.set(r.rp[0], r.rp[1], r.rp[2]).project(cam); const sz = giant ? 40 : 30; rg.style.display = 'block'; rg.style.width = rg.style.height = sz + 'px'; rg.style.borderColor = r.col || '#ffb454'; rg.style.color = r.col || '#ffb454';
        rg.style.left = (L0 + (V2.x * .5 + .5) * W) + 'px'; rg.style.top = (T0 + (-V2.y * .5 + .5) * H) + 'px'; } else rg.style.display = 'none';
      tg.style.display = 'block'; tg.className = 'ntag' + (r.tc ? '' : ' off') + (giant ? ' big' : '') + (giant && tnow < O.roarUntil ? ' rev' : '') + (out ? ' edge' : '');
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
  function startGrab(id, armHint) {
    if (O.grab) return; const o = GI[0]; useG(o); let cp;
    if (id === NET.id) cp = P.pos.clone(); else { const r = O.rem.get(id); if (!r) return; cp = new THREE.Vector3(r.mesh.position.x, r.mesh.position.y + 1.7 + O.FEET, r.mesh.position.z); }
    const pl = G.worldToLocal(cp.clone()), L = !gs.parts.leftArm.severed, R = !gs.parts.rightArm.severed, pf = pl.x >= 0 ? 1 : 0, arm = (armHint === 0 && L) || (armHint === 1 && R) ? armHint : (pf === 1 && R) || (pf === 0 && L) ? pf : (L ? 0 : 1);
    const W = arms[arm].wr, mp0 = headG.localToWorld(new THREE.Vector3(0, -1.2, 2.7)); W.add(held); held.position.copy(W.worldToLocal(cp.clone())); held.visible = true; held.userData.head.visible = true;
    O.grab = { id, t0: Date.now(), arm, hs: W.worldToLocal(mp0).x >= 0 ? 1 : -1, cp };
    if (id === NET.id) { P.eaten = true; releaseWires(); P.stuck = false; P.vel.set(0, 0, 0); popup('掴まれた！', 'big'); }
  }
  function endGrab(eaten) {
    const g = O.grab; if (!g) return; O.grab = null; held.visible = false; useG(GI[0]); jaw.rotation.x = 0; gs.grab = 0;
    if (eaten) { const mw = headG.localToWorld(new THREE.Vector3(0, -1.2, 1.9)); shake = 1; for (let q = 0; q < 4; q++) spark(mw, 0xaa1010); }
  }
  // ---- やられた原因の表示（本人: 画面中央の大きな表示 / 全員: 左上のキルログ）----
  const deathBn = document.createElement('div'); deathBn.id = 'deathBn'; document.body.appendChild(deathBn); let deathT = 0;
  const kf = document.createElement('div'); kf.id = 'kf'; document.body.appendChild(kf);
  const hf = document.createElement('div'); hf.id = 'hitFlash'; document.body.appendChild(hf);
  function flash(white) { hf.className = white ? 'w' : ''; hf.style.transition = 'none'; hf.style.opacity = white ? '.95' : '.9'; void hf.offsetWidth; hf.style.transition = 'opacity ' + (white ? 1.1 : .8) + 's ease-out'; hf.style.opacity = '0'; }
  const slowmo = sec => { try { limbCutSlowMoTimer = Math.max(limbCutSlowMoTimer, sec); } catch (e) {} }; // 既存のスローモーション（世界の時間が 0.2 倍）
  const CAUSE = { kick: ['蹴り飛ばされた', '🦵 蹴り'], eat: ['食べられた', '🍖 食べられた'], left: ['退出した', '🚪 退出'] };
  function deathInfo(by) { // 本人向け: 何が起きたか・自分の状況・次の対策
    useG(GI[0]); const sc = G.scale.x, gd = Math.round(Math.hypot(P.pos.x - G.position.x, P.pos.z - G.position.z)), h = Math.round(P.pos.y - G.position.y);
    if (by === 'kick') return ['蹴り飛ばされた', ['巨人の蹴りは周囲すべて（全方向）が対象です', `あなたの位置: 巨人から ${gd}m・高さ ${h}m（蹴りの範囲: 半径 ${Math.round(O.KICK_R * sc)}m・高さ ${Math.round(O.KICK_H * sc)}m 以内）`, '対策: 腕を広げて脚を引く構えと、足元の赤い円が見えたら円の外へ逃げる。高い位置にいれば当たりません']];
    if (by === 'eat') return ['食べられた', ['巨人の手に触れて掴まれ、約2.5秒後に食べられました', '対策: 手のまわりの赤い光に近づかない。手は腕スティックで素早く動きます']];
    return ['脱落', []];
  }
  function showDeath(by) { const [t, ls] = deathInfo(by); deathBn.innerHTML = '<h2></h2>'; deathBn.firstChild.textContent = t; ls.concat(['このあとは観戦に切り替わります']).forEach(x => { const p = document.createElement('p'); p.textContent = x; deathBn.appendChild(p); deathBn.appendChild(document.createElement('br')); });
    deathBn.style.display = 'block'; clearTimeout(deathT); deathT = setTimeout(() => { deathBn.style.display = 'none'; }, 6000); }
  function killFeed(id, by) { const c = CAUSE[by]; if (!c) return; const d = document.createElement('div'); d.textContent = nameOf(id) + '  ' + c[1]; kf.appendChild(d); while (kf.children.length > 4) kf.removeChild(kf.firstChild); setTimeout(() => d.remove(), 6000); }
  function onDead(id, by) {
    if (O.grab && O.grab.id === id) endGrab(by === 'eat');
    const dly = by === 'kick' ? ((O.kickDelay && O.kickDelay[id]) || 0) : 0; // 蹴りの衝撃波が兵士に届くまでの時間
    if (by === 'kick') setTimeout(() => { const r = O.rem.get(id); if (r) { for (let q = 0; q < 4; q++) spark(r.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xaa1010); } }, dly * 1000);
    killFeed(id, by);
    if (id === NET.id) { O.dead = true; P.eaten = true; P.vel.set(0, 0, 0); releaseWires(); O.specIdx = 0; $$('specBar').style.display = 'flex';
      setTimeout(() => { fig.visible = false; if (by === 'kick') { flash(false); shake = Math.max(shake, 1.2); slowmo(1.4); } showDeath(by); }, dly * 1000); } // 蹴り: 波が届いた瞬間に赤フラッシュ・揺れ・スロー → 原因表示。観戦は巨人視点
  }
  function kick() { // 蹴り: 予備動作（約1.1秒）→ 蹴り出し → 全方向の衝撃波。予備動作中は足元に赤い危険範囲を表示
    O.kickT = O.KICK_T; useG(GI[0]); const sc = G.scale.x, R = O.KICK_R * sc, gd = Math.hypot(P.pos.x - G.position.x, P.pos.z - G.position.z), near = gd < 90 || isG();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff3b2a, transparent: true, opacity: .25, side: THREE.DoubleSide, depthWrite: false }));
    const edge = new THREE.Mesh(new THREE.RingGeometry(.95, 1, 64), new THREE.MeshBasicMaterial({ color: 0xff7a5a, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }));
    [fill, edge].forEach(m => { m.rotation.x = -Math.PI / 2; m.position.set(G.position.x, .7, G.position.z); S.add(m); }); edge.scale.setScalar(R); fill.scale.setScalar(.01);
    O.kickFx = { fill, edge, t: 0, R, T: O.KICK_HIT };
    if (!isG() && !O.dead && gd < R * 2.5) popup('⚠ 巨人が蹴りの構え！ 赤い円の外へ逃げろ', 'big');
    setTimeout(() => { ring(); for (let q = 0; q < 24; q++) { const a = q / 24 * 6.283, r = (6 + Math.random() * 8) * sc;
      steam.emit(new THREE.Vector3(G.position.x + Math.cos(a) * r, .6 + Math.random() * 3, G.position.z + Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * 12, 3 + Math.random() * 4, Math.sin(a) * 12), 1.6, 10); }
      spark(new THREE.Vector3(G.position.x, 1, G.position.z), 0xddaa77); shake = Math.max(shake, near ? 1 : .3);
      const wr = new THREE.Mesh(new THREE.RingGeometry(.86, 1, 72), new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: .4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      wr.rotation.x = -Math.PI / 2; [wr, dome].forEach(m => { m.position.set(G.position.x, .8, G.position.z); S.add(m); }); O.waveFx = { wr, dome, t: 0, R, H: O.KICK_H * sc }; }, O.KICK_HIT * 1000);
  }
  function applyLimb(key) {
    const o = GI[0]; if (o.gs.parts[key] && !o.gs.parts[key].severed) { O.applying = true; try { severLimb(o, key, new THREE.Vector3(o.G.position.x, o.G.position.y + 10, o.G.position.z), true); } finally { O.applying = false; } }
  }
  function onEvent(m) {
    switch (m.k) {
      case 'collapse': O.collapse(m.b | 0); break;
      case 'grab': startGrab(m.id, m.arm); break;
      case 'release': endGrab(false); if (m.id === NET.id) { P.eaten = false; fig.visible = true; } break;
      case 'eat': endGrab(true); break;
      case 'kick': kick(); break;
      case 'kicked': { useG(GI[0]); const R = O.KICK_R * G.scale.x; O.kickDelay = {}; (m.victims || []).forEach(id => { const r = O.rem.get(id), pp = id === NET.id ? P.pos : r && r.mesh.position; if (pp) O.kickDelay[id] = Math.min(.35, Math.hypot(pp.x - G.position.x, pp.z - G.position.z) / R * .35); }); break; }
      case 'nape': O.napeBy = m.id; flash(true); shake = Math.max(shake, 1.5); slowmo(2.6); break; // うなじを斬った瞬間（結果は直後に届く）
      case 'guard': O.guardUntil = Date.now() + m.ms; if (!isG() && P.slash) { P.slash = false; P.slashT = 0; P.sw2 = false; toast('うなじ守りで弾かれた！'); } break;
      case 'dead': onDead(m.id, m.by); break;
      case 'limb': applyLimb(m.key); break;
      case 'roar': { O.roarUntil = Date.now() + (m.ms || 4000); O.roarMouth = Date.now() + 1400; shake = Math.max(shake, .8);
        if (isG()) toast('咆哮！ 全員の位置が見える'); else if (!O.dead) popup('巨人の咆哮！ 位置を知られた', 'big'); break; }
    }
  }
  O.sever = key => NET.send({ t: 'event', k: 'limb', key });            // 自分の刃で切断した → サーバー経由で全員へ
  O.nape = () => { P.slash = false; P.slashT = 0; P.sw2 = false; if (Date.now() < O.napeCd) return; O.napeCd = Date.now() + 1200; NET.send({ t: 'event', k: 'nape' }); }; // うなじ斬りの申告（確定はサーバー）

  // ---- 結果画面 ----
  function showFinish(m, win) { // 決着の大きな表示（誰が・どうやって）
    const nm = O.napeBy ? nameOf(O.napeBy) : '', t = m.reason === 'nape' ? (win ? 'うなじを斬った！' : 'うなじを斬られた…') : (win ? '兵士を全滅させた！' : '全滅…');
    const ls = m.reason === 'nape' ? [nm + ' が背後からうなじを斬り、巨人が倒れた'] : ['最後の兵士が脱落した'];
    deathBn.innerHTML = '<h2></h2>'; deathBn.firstChild.textContent = t; deathBn.firstChild.style.color = win ? '#ffd86a' : '#ff6a5a';
    ls.forEach(x => { const p = document.createElement('p'); p.textContent = x; deathBn.appendChild(p); }); deathBn.style.display = 'block'; clearTimeout(deathT);
  }
  function cineCam(rdt) { // 決着カメラ: うなじ（または巨人の頭）のまわりをゆっくり回る
    useG(GI[0]); G.updateMatrixWorld(true); const T = new THREE.Vector3(), sc = G.scale.x; (O.cineR === 'nape' ? nape : head).getWorldPosition(T);
    if (O.cineA == null) O.cineA = gs.yaw + Math.PI + .5; O.cineA += rdt * .5; const d = (O.cineR === 'nape' ? 24 : 36) * sc;
    cam.position.set(T.x + Math.sin(O.cineA) * d, T.y + 3 * sc, T.z + Math.cos(O.cineA) * d); cam.lookAt(T); sky.position.copy(cam.position);
  }
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
    const cine = (m.reason === 'nape' || m.reason === 'allDown') ? 2.6 : 0;
    if (cine) { O.cineUntil = Date.now() + cine * 1000; O.cineA = null; O.cineR = m.reason; slowmo(cine); showFinish(m, win); setTimeout(() => { deathBn.style.display = 'none'; $$('resOv').style.display = 'flex'; }, cine * 1000); }
    else $$('resOv').style.display = 'flex';
  }
  NET.on('result', onResult);

  // ---- 開始 / 再戦 / 再接続 ----
  O.clear = () => { O.rem.forEach(r => { S.remove(r.mesh); S.remove(r.line); if (r.beam) S.remove(r.beam); r.tag.remove(); if (r.ring) r.ring.remove(); }); O.rem.clear(); };
  function gasStations() { // ガス補給所: 背の高い建物の屋上に2か所（崩れたら消える）
    if (O.gas.length) return; const top = buildingList.map((b, i) => ({ b, i })).sort((a, b) => b.b.h - a.b.h);
    const pick = []; for (const t of top) { if (pick.every(q => Math.hypot(q.b.px - t.b.px, q.b.pz - t.b.pz) > 80)) pick.push(t); if (pick.length >= 2) break; }
    pick.forEach(t => { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, .8, 20), new THREE.MeshBasicMaterial({ color: 0x55ff99 })); m.position.set(t.b.px, t.b.h + .6, t.b.pz); S.add(m);
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 14, 8), new THREE.MeshBasicMaterial({ color: 0x55ff99, transparent: true, opacity: .35 })); pl.position.y = 7; m.add(pl); O.gas.push({ m, b: t.b }); });
  }
  O.start = m => {
    $$('resOv').style.display = 'none'; $$('specBar').style.display = 'none'; GBTN.forEach(b => b.style.display = 'none');
    O.ui.forEach(([e, d]) => { e.style.display = d; }); O.ui = [];
    deathBn.style.display = 'none'; kf.innerHTML = ''; Object.assign(O, { me: m.players.find(p => p.id === NET.id), snaps: [], off: null, armT: null, armId: null, armStick: { x: 0, y: 0, sx: 0, sy: 0 }, camBtn: { d: 0, h: 0 }, grab: null, guardUntil: 0, kickT: 0, roarUntil: 0, roarMouth: 0, dead: false, giantDead: false, result: null, al: 0, specIdx: 0, cd: { roar: 0 }, napeCd: 0 }); O.clear();
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
    popup(mode === 'SP' ? '巨人: 左スティック移動 / 右のボタンで走る・しゃがむ・蹴り（周囲すべて）・うなじ守り・咆哮 / 手に触れた兵士は自動で掴む / 右の「腕」スティックで両腕を動かす / 右上の 拡縮上下 でカメラ調整' : '巨人: WASD移動 / マウスで向き / Shift走る / G長押しでしゃがむ / 手に触れた兵士は自動で掴む / 右クリック・Space蹴り（周囲すべて） / Cうなじ守り / T咆哮（位置を強調）', 'big');
  };
  const PCOL = ['#ff6b6b', '#5ec8ff', '#7dff7a', '#ffd24a', '#d28bff'];
  const colorOf = id => { const p = NET.match && NET.match.players.find(x => x.id === id); return PCOL[((p && p.idx) || 0) % PCOL.length]; };
  const mk = id => {
    const mesh = O.FIG.clone(true); mesh.visible = true; S.add(mesh);
    const col = colorOf(id); mesh.traverse(o => { if (o.isMesh && o.material && o.material.emissive) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(col); o.material.emissiveIntensity = .3; } }); // 兵士ごとの色（味方も見分けやすい）
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xfff1c0 })); line.frustumCulled = false; S.add(line);
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
    const giant = isG(), now = Date.now(); O.kickT = Math.max(0, O.kickT - realDt);
    if (giant) { if (!over) { giantStep(dt); autoGrab(); } else { useG(GI[0]); gs.dead = O.giantDead ? 1 : 0; O.pose(GI[0], dt); } }
    // 送信（20Hz）。脱落した兵士は送らない
    O.acc += realDt;
    if (O.acc >= 1 / O.SEND_HZ && !over && !O.dead) {
      O.acc = 0;
      if (giant) { const o = GI[0]; useG(o); const hnd = arms.map((A, i) => gs.parts[i === 0 ? 'leftArm' : 'rightArm'].severed ? null : A.wr.getWorldPosition(new THREE.Vector3()).toArray().map(r2)); // 手のワールド位置（掴み判定用）
        NET.send({ t: 'state', cq: gs.cq ? 1 : 0, hnd, p: [r2(G.position.x), r2(G.position.y), r2(G.position.z)], yaw: r2(gs.yaw), hy: r2(gs.yaw + headG.rotation.y), sp: r2(gs.spd || 0), run: gs.run > 0 ? 1 : 0,
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
        let r = O.rem.get(sb.id); if (!sb.a || (O.grab && O.grab.id === sb.id)) { if (r) { r.mesh.visible = false; r.line.visible = false; r.tvis = false; r.tag.style.display = 'none'; if (r.beam) r.beam.visible = false; } continue; }
        if (!r) r = mk(sb.id); r.mesh.visible = r.line.visible = true;
        const x = lp(sa.p[0], sb.p[0], k), y = lp(sa.p[1], sb.p[1], k), z = lp(sa.p[2], sb.p[2], k), yaw = sa.yaw + ad(sb.yaw, sa.yaw) * k;
        const dcam = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z), ms = giant ? Math.max(2, Math.min(9, dcam / 22)) : Math.max(1, Math.min(4, dcam / 55)); // 遠いほど大きく描く（判定は変わらない）
        r.mesh.scale.setScalar(ms); r.mesh.position.set(x, y - 1.7 - O.FEET * ms, z); r.mesh.rotation.set(sb.f & 1 ? .3 : 0, yaw, 0); // 巨人からは兵士が小さすぎるので2倍で表示
        const ws = (k > .5 ? sb : sa).w, ps = r.line.geometry.attributes.position, hip = [x, y - .8, z];
        for (let j = 0; j < 2; j++) { const q = ws[j] || hip; ps.setXYZ(j * 2, hip[0], hip[1], hip[2]); ps.setXYZ(j * 2 + 1, q[0], q[1], q[2]); }
        ps.needsUpdate = true;
        const nv = sb.v || [0, 0, 0], nsp = Math.hypot(nv[0], nv[1], nv[2]), tn = Date.now(); // 音: ダッシュ/斬撃中や高速移動中は居場所がバレる（蒸気の軌跡＋巨人の画面に名前が出る）
        if ((sb.f & 12) || nsp > 15) r.noisyUntil = tn + 1500;
        if (tn < (r.noisyUntil || 0) && Math.random() < .35) steam.emit(new THREE.Vector3(x, y - .6, z), new THREE.Vector3((Math.random() - .5) * 2, 1 + Math.random() * 2, (Math.random() - .5) * 2), giant ? 2.8 : 1.4, 0);
        if (giant) { if (!r.beam) { r.beam = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: .3, depthTest: false, depthWrite: false })); r.beam.renderOrder = 999; r.beam.frustumCulled = false; S.add(r.beam); }
          const ro = tn < O.roarUntil, bh = ro ? 140 : 50; r.beam.visible = true; r.beam.scale.set(ro ? 2.2 : 1, bh, ro ? 2.2 : 1); r.beam.position.set(x, y - 1.7 + bh / 2, z); r.beam.material.color.setHex(ro ? 0xff4a3a : 0xffb454); r.beam.material.opacity = ro ? .6 : .3; // 巨人の画面では、兵士の位置に光の柱（壁越しでも見える）。咆哮中は太く赤く
        } else if (r.beam) r.beam.visible = false;
        r.tp = [x, y - 1.5 + 1.9 * ms, z]; r.rp = [x, y - 1.7 + .9 * ms, z]; r.cy = y - .6; r.col = colorOf(sb.id); r.tn = nameOf(sb.id) + (sb.c ? '' : '（切断中）'); r.tc = sb.c ? 1 : 0; r.tvis = true; // 名前タグは頭のすぐ上（カメラ確定後に配置）
      }
      O.rem.forEach((r, id) => { if (!seen.has(id)) { r.mesh.visible = r.line.visible = false; r.tvis = false; r.tag.style.display = 'none'; if (r.beam) r.beam.visible = false; } });
      // 相手の巨人（兵士側で表示）: 位置・向き・頭・速度を補間し、歩行アニメは既存の姿勢計算で再生。欠損は申告に合わせる
      const ga = A.g || B.g, gb = B.g || A.g;
      if (!giant && gb) {
        const o = GI[0]; useG(o); G.visible = true; if (Math.abs(G.scale.x - gb.sc) > .01) G.scale.setScalar(gb.sc);
        LIMB_KEYS.forEach((key, li) => { if (gb.limbs[li] && !gs.parts[key].severed) applyLimb(key); });
        gs.yaw = ga.yaw + ad(gb.yaw, ga.yaw) * k; headG.rotation.y = lp(ga.hd, gb.hd, k); gs.spd = lp(ga.sp, gb.sp, k); gs.run = gb.run ? 5 : 0; gs.cq = gb.cq ? 1 : 0; gs.dead = O.giantDead ? 1 : 0; gs.mode = 'chase';
        if (legLossOf(gs) > 0) updateLegless(realDt, gs.spd > .4, gs.trait.walkSpeed); else { gs.phase += gs.spd * realDt * 1.8 / (17.4 * (.42 + .33 * gs.rn) * G.scale.x); }
        G.position.set(lp(ga.p[0], gb.p[0], k), lp(ga.p[1], gb.p[1], k), lp(ga.p[2], gb.p[2], k)); G.rotation.y = gs.yaw; O.armT = gb.ar || null; O.pose(o, realDt);
      }
    }
    fxStep(realDt);
    if (giant) bRun.classList.toggle('on', O.runBtn);
    // HUD とカメラ
    const cdS = t => Math.max(0, Math.ceil((t - now) / 1000));
    if (giant) { const c4 = cdS(O.cd.roar); bRoar.textContent = c4 ? '咆哮 ' + c4 : '咆哮'; bRoar.classList.toggle('cd', c4 > 0); }
    let watched = false; // 巨人の視線（正面±約33°・距離110以内・建物に遮られない）に入ると警告
    if (!giant && !O.dead && !over) { const o = GI[0], ya = o.gs.yaw + o.headG.rotation.y, wx = P.pos.x - o.G.position.x, wz = P.pos.z - o.G.position.z, wd = Math.hypot(wx, wz);
      if (o.G.visible && wd > 1 && wd < 110 * o.G.scale.x && (wx * Math.sin(ya) + wz * Math.cos(ya)) / wd > .84) { useG(o); watched = los(); } }
    const msg = over ? '' : giant ? `残り兵士 ${O.al}人 ｜ 咆哮 ${cdS(O.cd.roar) || '可'}${O.guard ? ' ｜ うなじ守り発動中' : ''}${mode === 'PC' ? ' ｜ 手に触れると掴む / 右クリック・Space蹴り(全方向) / Cうなじ守り / T咆哮 / Bカメラ寄り / G長押しでしゃがむ / Shift走る / V視点 / Q・E+WASDで腕 / Z・Xズーム R・F高さ' : ''}`
      : O.dead ? '観戦中（クリック/Tabで視点切替）' : `生存兵士 ${O.al}人 ｜ 巨人のうなじを背後から斬れ${O.gas.some(g => g.m.visible && P.pos.distanceTo(g.m.position) < 8) ? ' ｜ ガス補給中' : ''}${watched ? ' ｜ ⚠ 巨人に見られている！' : ''}`;
    hud.msg.textContent = msg;
    if (giant && !isPaused) { // カメラ距離/高さ: Z/X=ズーム, R/F=高さ, ホイール=ズーム, 画面の「拡縮上下」ボタン
      const dz = (keys.KeyX || O.camBtn.d > 0 ? 1 : 0) - (keys.KeyZ || O.camBtn.d < 0 ? 1 : 0), dh = (keys.KeyR || O.camBtn.h > 0 ? 1 : 0) - (keys.KeyF || O.camBtn.h < 0 ? 1 : 0);
      if (dz || dh) { O.camD = Math.max(18, Math.min(220, O.camD + dz * 70 * realDt)); O.camH = Math.max(-10, Math.min(90, O.camH + dh * 35 * realDt)); O.camDirty = true; } else if (O.camDirty) { O.camDirty = false; camSave(); }
    }
    O.zk += ((O.zoomOn ? .45 : 1) - O.zk) * Math.min(1, 6 * realDt);
    if (giant) giantCam(); else if (O.dead && !over) specCam();
    if (over && O.cineUntil && Date.now() < O.cineUntil) cineCam(realDt);
    tagStep(); mapStep(realDt);
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
