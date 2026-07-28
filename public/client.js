// ============================================================
//  Phase 10 – Client
// ============================================================
const socket = io();

// Dauerhafte Spieler-ID pro Gerät (= "Login")
let playerId = localStorage.getItem('p10-id');
if (!playerId) {
  playerId = 'p' + Math.random().toString(36).slice(2, 11);
  localStorage.setItem('p10-id', playerId);
}
let myName = localStorage.getItem('p10-name') || '';
// Der aktive Raum wird NUR im Speicher gehalten (nicht in localStorage):
// So startet ein Seiten-Neuladen immer frisch auf dem Login und man kann
// einen neuen Raum erstellen. Der Auto-Rejoin (siehe unten) greift nur bei
// echten Verbindungsabbrüchen, während die Seite geöffnet bleibt.
let myRoom = null;
localStorage.removeItem('p10-room'); // alte, evtl. gespeicherte Werte entfernen

function rememberRoom(code) { myRoom = code; }
function forgetRoom() { myRoom = null; }

let state = null;          // letzter Serverzustand
let mode = 'idle';         // 'idle' | 'lay' | 'hit'
let selected = new Set();  // markierte Handkarten
let lastTap = { id: null, t: 0 }; // für Doppeltipp-Ablegen
let buildGroups = [];      // beim Auslegen: Karten-IDs je Anforderung
let activeGroup = 0;

const $ = (id) => document.getElementById(id);

// ---------- Screens ----------
function show(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screen).classList.add('active');
  $('btn-leave').classList.toggle('hidden', screen === 'screen-login');
}

function toast(msg, info) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (info ? ' info' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
}

// ---------- Verbindungsstatus ----------
// Zeigt an, ob die Echtzeit-Verbindung steht. Beim ersten Öffnen der
// deployten Seite braucht der Server evtl. einen Moment zum Hochfahren –
// erst dann lassen sich Räume erstellen/beitreten. Buttons bleiben so
// lange deaktiviert und der Status erklärt die Wartezeit.
function setConn(connected) {
  const el = $('conn-status');
  $('btn-create').disabled = !connected;
  $('btn-join').disabled = !connected;
  if (connected) {
    el.className = 'conn-status'; el.textContent = '';
  } else {
    el.className = 'conn-status wait';
    el.textContent = '● Verbindung zum Server wird hergestellt … (kann beim ersten Aufruf ~30 Sek. dauern)';
  }
}
socket.on('connect', () => setConn(true));
socket.on('disconnect', () => setConn(false));
socket.on('connect_error', () => setConn(false));
if (socket.io) socket.io.on('reconnect_attempt', () => setConn(false));
setConn(socket.connected);

// ---------- Login ----------
$('input-name').value = myName;
$('btn-create').onclick = () => {
  const name = $('input-name').value.trim();
  if (!name) return ($('login-error').textContent = 'Bitte gib einen Namen ein.');
  if (!socket.connected) return ($('login-error').textContent = 'Verbindung wird noch hergestellt – gleich nochmal versuchen.');
  myName = name; localStorage.setItem('p10-name', name);
  $('login-error').textContent = '';
  setBusy('btn-create', true);
  socket.timeout(9000).emit('createRoom', { name, playerId }, (err, res) => {
    setBusy('btn-create', false);
    if (err) return ($('login-error').textContent = 'Server antwortet nicht. Bitte erneut versuchen (Dienst startet evtl. gerade).');
    if (res.error) return ($('login-error').textContent = res.error);
    if (res.ok) rememberRoom(res.code);
  });
};
$('btn-join').onclick = () => {
  const name = $('input-name').value.trim();
  const code = $('input-code').value.trim().toUpperCase();
  if (!name) return ($('login-error').textContent = 'Bitte gib einen Namen ein.');
  if (!code) return ($('login-error').textContent = 'Bitte gib einen Raum-Code ein.');
  if (!socket.connected) return ($('login-error').textContent = 'Verbindung wird noch hergestellt – gleich nochmal versuchen.');
  myName = name; localStorage.setItem('p10-name', name);
  $('login-error').textContent = '';
  setBusy('btn-join', true);
  socket.timeout(9000).emit('joinRoom', { code, name, playerId }, (err, res) => {
    setBusy('btn-join', false);
    if (err) return ($('login-error').textContent = 'Server antwortet nicht. Bitte erneut versuchen (Dienst startet evtl. gerade).');
    if (res.error) return ($('login-error').textContent = res.error);
    if (res.ok) rememberRoom(res.code);
  });
};

// Button während einer laufenden Anfrage kurz sperren
function setBusy(id, busy) {
  const b = $(id);
  if (busy) { b.dataset.label = b.textContent; b.textContent = '…'; b.disabled = true; }
  else { if (b.dataset.label) b.textContent = b.dataset.label; b.disabled = !socket.connected; }
}

// ---------- Lobby ----------
$('btn-start').onclick = () => socket.emit('startGame');

// ---------- Raum verlassen ----------
$('btn-leave').onclick = () => {
  if (!confirm('Raum wirklich verlassen?')) return;
  socket.emit('leaveRoom');
  forgetRoom();
  location.reload();
};

// ---------- Automatisch wieder verbinden ----------
// Nur bei einer echten Wiederverbindung (Netz-Wackler, während die Seite offen
// bleibt) zurück in den Raum. Beim ersten Laden/Neuladen NICHT – dann bleibt
// man auf dem Login und kann einen neuen Raum erstellen oder beitreten.
let hasConnectedOnce = false;
socket.on('connect', () => {
  if (hasConnectedOnce && myRoom && myName) {
    socket.emit('joinRoom', { code: myRoom, name: myName, playerId }, (res) => {
      if (res && res.error) forgetRoom();
    });
  }
  hasConnectedOnce = true;
});

// ---------- Sortieren ----------
$('btn-sort').onclick = () => {
  if (!state) return;
  const order = (c) => (typeof c.value === 'number' ? c.value : c.value === 'joker' ? 100 : 200);
  state.myHand.sort((a, b) => order(a) - order(b) || String(a.color).localeCompare(String(b.color)));
  renderHand();
};

// ---------- Piles: ziehen ----------
$('draw-pile').onclick = () => tryDraw('draw');
$('discard-pile').onclick = () => tryDraw('discard');
function tryDraw(source) {
  if (!isMyTurn() || state.myHasDrawn || state.myPendingDraw) return;
  socket.emit('draw', { source });
}

// ---------- Verbindungsabbruch-Hinweis (im Spiel) ----------
socket.on('disconnect', () => { if (state && state.started) $('reconnect-bar').classList.remove('hidden'); });
socket.on('connect', () => $('reconnect-bar').classList.add('hidden'));

function updateRoomBadge() {
  const b = $('room-badge');
  if (state && state.code) { b.textContent = 'Raum ' + state.code; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

// ============================================================
//  Socket-Events
// ============================================================
socket.on('errorMsg', (m) => toast(m));

socket.on('state', (s) => {
  const prevStarted = state && state.started;
  state = s;

  if (!s.started) { show('screen-lobby'); renderLobby(); updateRoomBadge(); return; }

  if (!prevStarted) { mode = 'idle'; selected.clear(); }
  show('screen-game');
  updateRoomBadge();
  renderGame();

  if (s.gameOver) return renderGameOver();
  if (s.roundOver) return renderRoundOver();
  if (s.give5) return renderGive5();
  if (s.myPendingDraw) return renderPendingDraw();
  $('overlay').classList.add('hidden');
});

// ============================================================
//  Hilfen
// ============================================================
function isMyTurn() { return state && state.turnPlayerId === playerId; }
function me() { return state.players.find(p => p.id === playerId); }

function initials(name) {
  const p = name.trim().split(/\s+/);
  return (((p[0] || '')[0] || '?') + (p[1] ? (p[1][0] || '') : '')).toUpperCase();
}
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 45) % 360} 65% 42%))`;
}

// ---------- Karten ----------
function cardEl(card, small) {
  const d = document.createElement('div');
  const classes = ['card']; if (small) classes.push('small');
  let center, idx, cap = '';
  if (card.value === 'joker') {
    classes.push('wild');
    const r = card.range === 'lo' ? '1–6' : '7–12';
    center = '★'; idx = r; cap = 'JOKER ' + r;
  } else if (card.value === 'skip') { classes.push('act', 'skip'); center = '⊘'; idx = '⊘'; cap = 'AUSSETZEN'; }
  else if (card.value === 'draw2') { classes.push('act', 'draw2'); center = '+2'; idx = '+2'; cap = 'NIMM ZWEI'; }
  else if (card.value === 'keepall') { classes.push('act', 'keepall'); center = '♥'; idx = '♥'; cap = 'ALLES MEINS'; }
  else if (card.value === 'give5') { classes.push('act', 'give5'); center = '✋'; idx = '5'; cap = 'GIVE FIVE'; }
  else { classes.push(card.color); center = card.value; idx = card.value; }
  d.className = classes.join(' ');
  if (small) {
    d.innerHTML = `<span class="c-center">${center}</span>`;
  } else {
    d.innerHTML =
      `<span class="c-idx tl">${idx}</span>` +
      `<span class="c-center">${center}</span>` +
      (cap ? `<span class="c-cap">${cap}</span>` : '') +
      `<span class="c-idx br">${idx}</span>` +
      `<span class="c-gloss"></span>`;
  }
  return d;
}

function isActionCard(card) { return ['skip', 'draw2', 'keepall', 'give5'].includes(card.value); }

// kleine Badges für Front-Aktionskarten / Aussetzen-Status
function frontTags(p) {
  let s = '';
  if (p.draw2) s += ' <span class="front-tag draw2">+2</span>';
  if (p.keepAll) s += ' <span class="front-tag keepall">♥ Alles meins</span>';
  if (p.willSkip) s += ' <span class="front-tag skip">⊘ setzt aus</span>';
  return s;
}

// ============================================================
//  Lobby
// ============================================================
function renderLobby() {
  $('lobby-code').textContent = state.code;
  const ul = $('lobby-players'); ul.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="avatar sm" style="background:${colorFor(p.name)}">${initials(p.name)}</span>` +
      `<span class="dot ${p.connected ? '' : 'off'}"></span><span>${escapeHtml(p.name)}</span>`;
    if (p.id === state.hostId) {
      const tag = document.createElement('span'); tag.className = 'host-tag'; tag.textContent = 'Host'; li.appendChild(tag);
    }
    ul.appendChild(li);
  }
  const isHost = state.hostId === playerId;
  const startBtn = $('btn-start');
  startBtn.style.display = isHost ? 'block' : 'none';
  startBtn.disabled = state.players.length < 2;
  $('lobby-hint').textContent = isHost
    ? (state.players.length < 2 ? 'Mindestens 2 Spieler nötig.' : `${state.players.length} Spieler bereit.`)
    : 'Warte auf den Host …';
}

// ============================================================
//  Spielbrett
// ============================================================
function renderGame() {
  // Zug-Banner
  const banner = $('turn-banner');
  const turnP = state.players.find(p => p.id === state.turnPlayerId);
  if (isMyTurn()) {
    banner.classList.add('my-turn');
    banner.textContent = state.myHasDrawn ? '● Du bist dran – lege eine Karte ab' : '● Du bist dran – ziehe eine Karte';
  } else {
    banner.classList.remove('my-turn');
    banner.textContent = turnP ? `${turnP.name} ist am Zug …` : '';
  }

  // Gegner-Pods
  const opp = $('opponents'); opp.innerHTML = '';
  for (const p of state.players) {
    if (p.id === playerId) continue;
    const div = document.createElement('div');
    div.className = 'opp' + (p.id === state.turnPlayerId ? ' active' : '');
    div.innerHTML =
      `<div class="opp-head">
         <div class="avatar" style="background:${colorFor(p.name)}">${initials(p.name)}</div>
         <div class="opp-info">
           <div class="name">${escapeHtml(p.name)}${p.connected ? '' : ' <span class="off-tag">offline</span>'}</div>
           <div class="meta">${p.handCount} Karten · ${p.score} P.</div>
         </div>
       </div>
       <div class="opp-phase">Phase ${p.phase + 1}${p.laidThisRound ? ' <span class="laid-tag">✓ ausgelegt</span>' : ''}${frontTags(p)}</div>`;
    opp.appendChild(div);
  }

  // Eigene Phase + Fortschritt
  $('my-phase-num').textContent = state.myPhaseIndex + 1;
  $('my-phase-desc').textContent = state.phases[state.myPhaseIndex].desc;
  const pips = $('phase-pips'); pips.innerHTML = '';
  for (let i = 0; i < state.phases.length; i++) {
    const s = document.createElement('span');
    s.className = 'pip' + (i < state.myPhaseIndex ? ' done' : i === state.myPhaseIndex ? ' cur' : '');
    pips.appendChild(s);
  }
  const meP = me();
  $('my-front').innerHTML = meP ? frontTags(meP).trim() : '';

  // Stapel
  $('draw-count').textContent = state.drawCount;
  const dc = $('discard-card');
  if (state.discardTop) {
    const el = cardEl(state.discardTop);
    dc.className = el.className; dc.innerHTML = el.innerHTML;
  } else { dc.className = 'card empty'; dc.innerHTML = ''; }

  $('action-log').textContent = state.lastAction || '';

  renderMeldsTable();
  renderHand();
  renderControls();
}

// Zentrale Tisch-Auslage: alle ausgelegten Phasen
function renderMeldsTable() {
  const t = $('melds-table'); t.innerHTML = '';
  const withMelds = state.players.filter(p => p.laidGroups && p.laidGroups.length);
  if (!withMelds.length) {
    t.innerHTML = '<div class="melds-empty">Noch keine Phasen ausgelegt – der Tisch ist frei.</div>';
    return;
  }
  for (const p of withMelds) {
    const block = document.createElement('div');
    block.className = 'meld-block' + (p.id === playerId ? ' mine' : '');
    const head = document.createElement('div'); head.className = 'meld-head';
    head.innerHTML = `<span class="avatar sm" style="background:${colorFor(p.name)}">${initials(p.name)}</span>` +
      `${escapeHtml(p.name)}${p.id === playerId ? ' <span class="you-tag">(du)</span>' : ''}`;
    block.appendChild(head);
    const groups = document.createElement('div'); groups.className = 'meld-groups';
    p.laidGroups.forEach((g, gi) => {
      const gd = document.createElement('div'); gd.className = 'meld-group';
      g.cards.forEach(c => gd.appendChild(cardEl(c, true)));
      if (mode === 'hit') { gd.classList.add('hittable'); gd.onclick = () => doHit(p.id, gi); }
      groups.appendChild(gd);
    });
    block.appendChild(groups);
    t.appendChild(block);
  }
}

function renderHand() {
  const hand = $('my-hand'); hand.innerHTML = '';
  $('hand-count').textContent = state.myHand.length;
  const usedInBuild = new Set(buildGroups.flat());

  for (const card of state.myHand) {
    const el = cardEl(card);
    if (mode === 'lay' && usedInBuild.has(card.id)) el.classList.add('disabled');
    if (selected.has(card.id)) el.classList.add('selected');
    el.onclick = () => onCardTap(card);
    hand.appendChild(el);
  }
}

function onCardTap(card) {
  if (!isMyTurn() || !state.myHasDrawn) {
    if (!state.myHasDrawn && isMyTurn()) toast('Erst eine Karte ziehen.', true);
    return;
  }
  if (mode === 'lay') {
    const g = buildGroups[activeGroup];
    const i = g.indexOf(card.id);
    if (i >= 0) g.splice(i, 1);
    else {
      buildGroups.forEach(gr => { const k = gr.indexOf(card.id); if (k >= 0) gr.splice(k, 1); });
      g.push(card.id);
    }
    renderBuildArea(); renderHand();
    return;
  }
  if (mode === 'hit') {
    if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id);
    renderHand(); renderControls();
    return;
  }
  // idle: Doppeltipp = direkt ablegen/spielen (flüssig); Einzeltipp = auswählen
  const now = Date.now();
  if (lastTap.id === card.id && now - lastTap.t < 400) {
    lastTap = { id: null, t: 0 };
    endTurnWithCard(card.id);
    return;
  }
  lastTap = { id: card.id, t: now };
  selected.clear(); selected.add(card.id);
  renderHand(); renderControls();
}

// Zug beenden: Zahl/Joker ablegen oder Aktionskarte spielen
function endTurnWithCard(cardId) {
  const card = state.myHand.find(c => c.id === cardId);
  if (!card) return;
  if (card.value === 'skip') return chooseSkipTarget(cardId);
  selected.clear(); lastTap = { id: null, t: 0 };
  if (isActionCard(card)) socket.emit('playAction', { cardId });
  else socket.emit('discard', { cardId });
  renderHand();
}

function renderControls() {
  const c = $('controls'); c.innerHTML = '';
  const build = $('build-area');

  if (!isMyTurn()) { build.classList.add('hidden'); return; }
  if (!state.myHasDrawn) { build.classList.add('hidden'); c.innerHTML = '<p class="hint">Tippe auf „Nachziehen" oder die Ablage.</p>'; return; }

  if (mode === 'idle') {
    build.classList.add('hidden');
    if (!state.myLaidThisRound) c.appendChild(btn('Phase auslegen', 'primary', startLay));
    if (state.myLaidThisRound) c.appendChild(btn('Anlegen', '', startHit));
    const sel = selected.size === 1 ? state.myHand.find(x => x.id === [...selected][0]) : null;
    const actSel = sel && isActionCard(sel);
    const b = btn(actSel ? '▶ Aktion spielen' : 'Karte ablegen', 'good', doDiscard);
    b.disabled = selected.size !== 1;
    c.appendChild(b);
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Tipp: Karte doppelt tippen legt sie sofort ab.';
    c.appendChild(hint);
  } else if (mode === 'lay') {
    renderBuildArea();
    c.appendChild(btn('Auslegen bestätigen', 'primary', confirmLay));
    c.appendChild(btn('Abbrechen', 'danger', cancelBuild));
  } else if (mode === 'hit') {
    build.classList.add('hidden');
    const note = document.createElement('p'); note.className = 'hint';
    note.textContent = selected.size
      ? 'Tippe auf eine Auslage auf dem Tisch, um anzulegen.'
      : 'Wähle Karten aus deiner Hand, dann tippe auf eine Auslage.';
    c.appendChild(note);
    c.appendChild(btn('Fertig', '', cancelBuild));
  }
}

function btn(text, cls, fn) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls; b.textContent = text; b.onclick = fn;
  return b;
}

// ---------- Auslegen ----------
function startLay() {
  mode = 'lay';
  const reqs = state.phases[state.myPhaseIndex].groups;
  buildGroups = reqs.map(() => []);
  activeGroup = 0;
  selected.clear();
  renderControls(); renderHand();
}

function renderBuildArea() {
  const area = $('build-area');
  area.classList.remove('hidden');
  area.innerHTML = '';
  const reqs = state.phases[state.myPhaseIndex].groups;
  const title = document.createElement('h4');
  title.textContent = 'Phase ' + (state.myPhaseIndex + 1) + ' auslegen – wähle Karten je Feld';
  area.appendChild(title);
  const wrap = document.createElement('div'); wrap.className = 'build-groups';
  reqs.forEach((r, i) => {
    const g = document.createElement('div');
    g.className = 'build-group' + (i === activeGroup ? ' active' : '');
    g.onclick = () => { activeGroup = i; renderBuildArea(); };
    const labelMap = { set: 'Gleiche Zahl', run: 'Straße', color: 'Gleiche Farbe', colorrun: 'Farbfolge' };
    g.innerHTML = `<div class="bg-title">${labelMap[r.type]} – ${buildGroups[i].length}/${r.count} Karten ${i === activeGroup ? '(aktiv)' : ''}</div>`;
    const slot = document.createElement('div'); slot.className = 'build-slot';
    buildGroups[i].forEach(id => {
      const card = state.myHand.find(c => c.id === id);
      if (card) { const ce = cardEl(card, true); ce.onclick = (e) => { e.stopPropagation(); onCardTap(card); }; slot.appendChild(ce); }
    });
    g.appendChild(slot);
    wrap.appendChild(g);
  });
  area.appendChild(wrap);
}

function confirmLay() {
  const reqs = state.phases[state.myPhaseIndex].groups;
  for (let i = 0; i < reqs.length; i++) {
    if (buildGroups[i].length !== reqs[i].count) {
      return toast(`Feld ${i + 1} braucht genau ${reqs[i].count} Karten.`);
    }
  }
  socket.emit('layPhase', { groups: buildGroups });
  mode = 'idle'; buildGroups = [];
}

function cancelBuild() {
  mode = 'idle'; buildGroups = []; selected.clear();
  renderControls(); renderHand(); renderMeldsTable();
  $('build-area').classList.add('hidden');
}

// ---------- Anlegen (hit) ----------
function startHit() {
  mode = 'hit'; selected.clear();
  renderControls(); renderHand(); renderMeldsTable();
}
function doHit(targetId, groupIndex) {
  if (selected.size === 0) return toast('Wähle zuerst Karten aus deiner Hand.');
  socket.emit('hit', { targetId, groupIndex, cardIds: [...selected] });
  selected.clear();
}

// ---------- Ablegen / Aktion spielen ----------
function doDiscard() {
  if (selected.size !== 1) return toast('Genau eine Karte wählen.');
  endTurnWithCard([...selected][0]);
}

function chooseSkipTarget(cardId) {
  const others = state.players.filter(p => p.id !== playerId);
  showOverlay('⊘ Aussetzen!', 'Wer soll aussetzen?', (body) => {
    const wrap = document.createElement('div'); wrap.className = 'skip-choose';
    others.forEach(p => {
      const b = btn(p.name, '', () => {
        socket.emit('playAction', { cardId, targetId: p.id });
        selected.clear(); lastTap = { id: null, t: 0 };
        $('overlay').classList.add('hidden');
      });
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }, []);
}

// ---------- Nimm zwei!: Karte wählen ----------
function renderPendingDraw() {
  showOverlay('Nimm zwei! – Karte wählen', 'Behalte eine Karte, die andere wird abgeworfen.', (body) => {
    const wrap = document.createElement('div'); wrap.className = 'draw2-choose';
    state.myPendingDraw.forEach(card => {
      const col = document.createElement('div'); col.className = 'draw2-opt';
      col.appendChild(cardEl(card));
      col.appendChild(btn('Behalten', 'primary', () => socket.emit('keepDrawn', { cardId: card.id })));
      wrap.appendChild(col);
    });
    body.appendChild(wrap);
  }, []);
}

// ---------- Give me Five! ----------
function renderGive5() {
  const g = state.give5;
  if (g.by === playerId) {
    if (g.phase === 'collecting') {
      showOverlay('✋ Give me Five!', `Warte auf Karten der Mitspieler … (${g.collected}/${g.needed})`, null, []);
    } else {
      showOverlay('✋ Give me Five! – nimm eine Karte', 'Wähle eine der angebotenen Karten.', (body) => {
        const wrap = document.createElement('div'); wrap.className = 'g5-offers';
        (g.offers || []).forEach(card => {
          const ce = cardEl(card); ce.onclick = () => socket.emit('pickOffered', { cardId: card.id });
          wrap.appendChild(ce);
        });
        body.appendChild(wrap);
      }, []);
    }
  } else if (g.currentOffererId === playerId && g.phase === 'collecting') {
    showOverlay('✋ Give me Five!', `${g.byName} fordert Karten – gib eine ab:`, (body) => {
      const wrap = document.createElement('div'); wrap.className = 'g5-offers';
      state.myHand.forEach(card => {
        const ce = cardEl(card); ce.onclick = () => socket.emit('offerCard', { cardId: card.id });
        wrap.appendChild(ce);
      });
      body.appendChild(wrap);
    }, []);
  } else {
    showOverlay('✋ Give me Five!', `${g.byName} spielt „Give me Five!". Bitte warten … (${g.collected}/${g.needed})`, null, []);
  }
}

// ============================================================
//  Overlays
// ============================================================
function showOverlay(title, subtitle, bodyFn, actions) {
  $('overlay-title').textContent = title;
  const body = $('overlay-body'); body.innerHTML = '';
  if (subtitle) { const p = document.createElement('p'); p.textContent = subtitle; body.appendChild(p); }
  if (bodyFn) bodyFn(body);
  const act = $('overlay-actions'); act.innerHTML = '';
  (actions || []).forEach(a => act.appendChild(btn(a.text, a.cls || '', a.fn)));
  $('overlay').classList.remove('hidden');
}

function scoreTable() {
  const t = document.createElement('table'); t.className = 'score-table';
  [...state.players].sort((a, b) => a.score - b.score).forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="avatar sm" style="background:${colorFor(p.name)}">${initials(p.name)}</span>${escapeHtml(p.name)}</td>` +
      `<td>Phase ${p.phase + 1}</td><td>${p.score} P.</td>`;
    t.appendChild(tr);
  });
  return t;
}

function renderRoundOver() {
  const isHost = state.hostId === playerId;
  showOverlay('Runde beendet', state.lastAction || '', (body) => {
    body.appendChild(scoreTable());
    if (!isHost) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Warte auf den Host für die nächste Runde …'; body.appendChild(p); }
  }, isHost ? [{ text: 'Nächste Runde', cls: 'primary', fn: () => socket.emit('nextRound') }] : []);
}

function renderGameOver() {
  const names = state.winners.map(w => w.name).join(' & ');
  const isHost = state.hostId === playerId;
  showOverlay('🏆 Spiel beendet', '', (body) => {
    const w = document.createElement('p');
    w.innerHTML = `Sieger: <span class="winner-name">${escapeHtml(names)}</span>`;
    body.appendChild(w);
    body.appendChild(scoreTable());
  }, isHost ? [{ text: 'Neues Spiel', cls: 'primary', fn: () => socket.emit('startGame') }] : []);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
