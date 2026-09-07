// ============================================================
//  Phase 10 – Client
// ============================================================
const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 400,
  reconnectionDelayMax: 3000,
  timeout: 20000,
});

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
// Raum wird gemerkt (für Wiedereinstieg), aber ein Neuladen springt NICHT
// automatisch rein – der Login bietet stattdessen einen "Zurück"-Button.
let myRoom = localStorage.getItem('p10-room') || null;

function rememberRoom(code) { myRoom = code; localStorage.setItem('p10-room', code); }
function forgetRoom() { myRoom = null; localStorage.removeItem('p10-room'); if (typeof renderRejoin === 'function') renderRejoin(); }

let state = null;          // letzter Serverzustand
let mode = 'idle';         // 'idle' | 'lay' | 'hit'
let selected = new Set();  // markierte Handkarten
let lastTap = { id: null, t: 0 }; // für Doppeltipp-Ablegen
let showHandPeek = false;         // eigene Karten im Auswahl-Overlay einblenden
let buildGroups = [];      // beim Auslegen: Karten-IDs je Anforderung
let activeGroup = 0;
let g5Snapshot = null;     // Give-me-Five: gemerkte Handreihenfolge (abgegebene Karten nur ausgrauen)

const $ = (id) => document.getElementById(id);

// ---------- Screens ----------
function show(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screen).classList.add('active');
  // Menü (☰) nur in Lobby/Spiel; nicht auf Startseite oder Login; Wertung nur im Spiel
  $('menu-btn').classList.toggle('hidden', screen === 'screen-start' || screen === 'screen-login');
  $('btn-score').classList.toggle('hidden', screen !== 'screen-game');
  if (screen === 'screen-start' || screen === 'screen-login') closeMenu();
}

// ---------- Startseite: "Phase 10 spielen" -> Login/Menü ----------
$('btn-start-play').onclick = () => show('screen-login');

// ---------- Ausklappbares Menü (oben rechts) ----------
function openMenu() { $('menu-drawer').classList.add('open'); $('menu-backdrop').classList.remove('hidden'); }
function closeMenu() { $('menu-drawer').classList.remove('open'); $('menu-backdrop').classList.add('hidden'); }
$('menu-btn').onclick = openMenu;
$('menu-close').onclick = closeMenu;
$('menu-backdrop').onclick = closeMenu;

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
    if (res.ok) { rememberRoom(res.code); if (res.spectator) toast('Spiel läuft – du beobachtest als Zuschauer.', true); }
  });
};

// Button während einer laufenden Anfrage kurz sperren
function setBusy(id, busy) {
  const b = $(id);
  if (busy) { b.dataset.label = b.textContent; b.textContent = '…'; b.disabled = true; }
  else { if (b.dataset.label) b.textContent = b.dataset.label; b.disabled = !socket.connected; }
}

// ---------- Wiedereinstieg-Button (nach Verbindungsverlust / Neuladen) ----------
function renderRejoin() {
  const box = $('rejoin-box'); if (!box) return;
  box.innerHTML = '';
  if (myRoom && myName) {
    const b = btn(`▶ Zurück in Raum ${myRoom}`, 'primary', rejoinGame);
    box.appendChild(b);
    const p = document.createElement('p'); p.className = 'hint'; p.style.textAlign = 'center';
    p.textContent = `Als „${myName}" wieder einsteigen`;
    box.appendChild(p);
  }
}
function rejoinGame() {
  if (!myRoom || !myName) return;
  if (!socket.connected) return ($('login-error').textContent = 'Verbindung wird noch hergestellt – gleich nochmal versuchen.');
  $('login-error').textContent = '';
  socket.timeout(9000).emit('joinRoom', { code: myRoom, name: myName, playerId }, (err, res) => {
    if (err) return ($('login-error').textContent = 'Server antwortet nicht. Bitte erneut versuchen (Dienst startet evtl. gerade).');
    if (res.error) { forgetRoom(); return ($('login-error').textContent = res.error); }
    if (res.ok) { rememberRoom(res.code); if (res.spectator) toast('Spiel läuft – du beobachtest als Zuschauer.', true); }
  });
}
renderRejoin();

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

// ---------- Sortierung (immer aktiv, phasengerecht) ----------
// In Farb-/Farbfolge-Phasen nach Farbe, sonst nach Zahl sortieren.
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, violet: 3 };
function phaseWantsColor() {
  const ph = state.phases && state.phases[state.myPhaseIndex];
  return !!(ph && ph.groups.some(g => g.type === 'color' || g.type === 'colorrun'));
}
function sortedHand() {
  const numOrder = (c) => (typeof c.value === 'number' ? c.value : c.value === 'joker' ? 100 : 200);
  const colOrder = (c) => (c.color != null ? COLOR_ORDER[c.color] : (c.value === 'joker' ? 90 : 100));
  const byColor = phaseWantsColor();
  return [...state.myHand].sort((a, b) =>
    byColor
      ? (colOrder(a) - colOrder(b) || numOrder(a) - numOrder(b))
      : (numOrder(a) - numOrder(b) || colOrder(a) - colOrder(b)));
}

// ---------- Wertungsblatt-Button (im Menü) ----------
$('btn-score').onclick = () => {
  if (!state) return;
  closeMenu();
  const body = $('scoresheet-body'); body.innerHTML = ''; body.appendChild(scoreSheetEl());
  $('scoresheet').classList.remove('hidden');
};
$('scoresheet-close').onclick = () => $('scoresheet').classList.add('hidden');

// ---------- Raum-Einstellungen (nur Host, in der Lobby) ----------
function isRoomHost() { return state && state.hostId === playerId; }
$('btn-settings').onclick = () => {
  if (!state) return;
  syncSettingsModal();
  $('settings-modal').classList.remove('hidden');
};
$('settings-close').onclick = () => $('settings-modal').classList.add('hidden');
// Spiegelt den aktuellen Serverzustand ins Modal; Host darf ändern, sonst nur lesen.
function syncSettingsModal() {
  const host = isRoomHost();
  const s = (state && state.settings) || {};
  const cb = $('set-out-first');
  cb.checked = !(s.outFirstRound === false);
  cb.disabled = !host;
  $('settings-readonly').classList.toggle('hidden', host);
}
$('set-out-first').onchange = () => {
  if (!isRoomHost()) return;
  socket.emit('updateSettings', { settings: { outFirstRound: $('set-out-first').checked } });
};

// ---------- Admin-Panel (nur Host, während der Runde) ----------
$('btn-admin-undo').onclick = () => {
  closeMenu();
  if (!confirm('Den letzten Zug zurücksetzen? Alle Mitspieler müssen zustimmen.')) return;
  socket.emit('requestUndo');
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
  const mr = $('menu-room');
  if (mr) mr.textContent = state && state.code ? 'Raum ' + state.code : '';
}

// ============================================================
//  Socket-Events
// ============================================================
socket.on('errorMsg', (m) => toast(m));
socket.on('info', (m) => toast(m, true)); // für alle sichtbare Info (z.B. Aktionskarte verfallen)

// Großer Vollbild-Hinweis (rot/grün)
function showBigNotice(text, color, ms) {
  const el = $('skip-notice');
  el.textContent = text;
  el.className = 'big-notice ' + (color || 'red') + ' show';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'big-notice ' + (color || 'red'); }, ms || 5000);
}
// Aussetzen: großer roter Hinweis für 5 Sekunden
socket.on('skipNotice', ({ by }) => showBigNotice(`${by} lässt dich aussetzen!`, 'red', 5000));

// Gezogene Karte kurz groß anzeigen (Nachzieh-Animation)
socket.on('cardReveal', ({ card, caption }) => showCardReveal(card, caption));
function showCardReveal(card, caption) {
  const ov = $('card-reveal');
  ov.innerHTML = '';
  if (caption) { const cap = document.createElement('div'); cap.className = 'reveal-cap'; cap.textContent = caption; ov.appendChild(cap); }
  const big = cardEl(card); big.classList.add('reveal-card');
  ov.appendChild(big);
  ov.classList.add('show');
  clearTimeout(ov._t);
  ov._t = setTimeout(() => ov.classList.remove('show'), caption ? 2200 : 1300);
}

socket.on('state', (s) => {
  const prevStarted = state && state.started;
  const prevRoundOver = state && state.roundOver;
  state = s;

  if (!s.started) { show('screen-lobby'); renderLobby(); updateRoomBadge(); return; }

  if (!prevStarted) { mode = 'idle'; selected.clear(); }
  show('screen-game');
  updateRoomBadge();
  renderGame();

  // Runde gerade beendet -> großer Hinweis (grün beim Beender)
  if (s.roundOver && !prevRoundOver && !s.gameOver) {
    if (s.lastFinisher === playerId) showBigNotice('Du hast die Runde beendet!', 'green', 3000);
    else {
      const fin = s.players.find(p => p.id === s.lastFinisher);
      showBigNotice(`${fin ? fin.name : 'Jemand'} hat die Runde beendet`, 'green', 3000);
    }
  }

  if (!s.give5) g5Snapshot = null; // Give-me-Five vorbei -> Snapshot verwerfen

  if (s.gameOver) return renderGameOver();
  if (s.roundOver) return renderRoundOver();
  if (s.undoVote) return renderUndoVote();
  if (s.give5) return renderGive5();
  if (s.myPendingDraw) return renderPendingDraw();
  showHandPeek = false;
  $('overlay').classList.add('hidden');
});

// Admin will einen Zug zurücksetzen -> Bestätigung/Warten
function renderUndoVote() {
  const v = state.undoVote;
  if (v.by === playerId || v.iApproved || !v.isPlayer) {
    const waitFor = (v.pending && v.pending.length) ? `Warte noch auf: ${v.pending.join(', ')}` : 'Warte auf Bestätigung …';
    showOverlay('Zug zurücksetzen?',
      `Zug von ${v.targetName} zurücksetzen. ${waitFor} (${v.approved}/${v.needed})`,
      null, v.by === playerId ? [{ text: 'Abbrechen', cls: 'subtle', fn: () => socket.emit('cancelUndo') }] : []);
    return;
  }
  const admin = state.players.find(p => p.id === v.by);
  showOverlay('Zug zurücksetzen?',
    `${admin ? admin.name : 'Der Admin'} möchte den Zug von ${v.targetName} zurücksetzen. Bist du einverstanden?`,
    null, [
      { text: '✓ Einverstanden', cls: 'good', fn: () => socket.emit('undoVoteResponse', { approve: true }) },
      { text: 'Ablehnen', cls: 'danger', fn: () => socket.emit('undoVoteResponse', { approve: false }) },
    ]);
}

// Joker/Karte passt an mehrere Stellen einer Folge -> Position wählen
socket.on('chooseHitPlacement', ({ options }) => {
  showOverlay('Wohin anlegen?', 'Die Karte passt an mehrere Stellen – wähle die Reihenfolge:', (body) => {
    (options || []).forEach((seq, i) => {
      let label = 'Diese Reihenfolge';
      if (seq[0] && seq[0].value === 'joker') label = '◀ Links anlegen';
      else if (seq[seq.length - 1] && seq[seq.length - 1].value === 'joker') label = 'Rechts anlegen ▶';
      const opt = document.createElement('div'); opt.className = 'place-opt';
      const lab = document.createElement('div'); lab.className = 'place-label'; lab.textContent = label;
      const row = document.createElement('div'); row.className = 'g5-offers place-row';
      seq.forEach(card => {
        const ce = cardEl(card, true);
        if (card.value === 'joker') ce.classList.add('place-blink');
        row.appendChild(ce);
      });
      opt.appendChild(lab); opt.appendChild(row);
      opt.onclick = () => { socket.emit('placeHit', { choiceIndex: i }); $('overlay').classList.add('hidden'); };
      body.appendChild(opt);
    });
  }, []);
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
  return `hsl(${hue} 48% 46%)`; // solide Avatar-Farbe (kein Verlauf)
}

// ---------- Karten ----------
const CARD_HEX = { red: '#d5474c', yellow: '#c79320', green: '#2ea25f', violet: '#7b57c6' };
// Aktionskarten-Symbole (eigene SVGs, keine Emojis)
const THUMB_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 21h3V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 1 6.59 7.59C6.22 7.95 6 8.45 6 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
// Offene Hand für „Give me Five"
const HAND_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23 5.5V20c0 2.21-1.79 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83c.43-.44 1.06-.7 1.72-.7.28 0 .55.05.8.15L8 16.05V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5C12 .67 12.67 0 13.5 0S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5S19 1.67 19 2.5V11h1V5.5c0-.83.67-1.5 1.5-1.5S23 4.67 23 5.5z"/></svg>';
// Zwei Karten für „Nimm zwei"
const CARDS2_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3h9a2 2 0 0 1 2 2v11h-2V5H9V3z"/><rect x="4" y="7" width="12" height="14" rx="2"/></svg>';
function jokerBg(cols) {
  const cs = (cols || []).map(c => CARD_HEX[c] || '#888');
  if (cs.length <= 1) return cs[0] || '#555';
  if (cs.length === 2) return `linear-gradient(135deg, ${cs[0]} 0 50%, ${cs[1]} 50% 100%)`;
  if (cs.length === 3) return `linear-gradient(135deg, ${cs[0]} 0 33.34%, ${cs[1]} 33.34% 66.67%, ${cs[2]} 66.67% 100%)`;
  return `linear-gradient(135deg, ${cs[0]} 0 25%, ${cs[1]} 25% 50%, ${cs[2]} 50% 75%, ${cs[3]} 75% 100%)`;
}

function cardEl(card, small) {
  const d = document.createElement('div');
  const classes = ['card']; if (small) classes.push('small');

  // Joker: Hintergrund diagonal in seinen Farben geteilt, Reichweite als Pille
  if (card.value === 'joker') {
    classes.push('joker', card.range === 'lo' ? 'jlo' : 'jhi');
    d.className = classes.join(' ');
    d.style.background = jokerBg(card.colors);
    // Joker: nur die Farben (Hintergrund) + die Reichweite-Zahl anzeigen
    const r = card.range === 'lo' ? '1–6' : '7–12';
    d.innerHTML = `<span class="j-pill">${r}</span>`;
    return d;
  }

  let center, idx, cap = '', svg = null, isAct = false;
  if (card.value === 'skip') { classes.push('act', 'skip'); center = '⊘'; cap = 'AUSSETZEN'; isAct = true; }
  else if (card.value === 'draw2') { classes.push('act', 'draw2'); svg = CARDS2_SVG; cap = 'NIMM ZWEI'; isAct = true; }
  else if (card.value === 'keepall') { classes.push('act', 'keepall'); svg = THUMB_SVG; cap = 'BEHALTEN'; isAct = true; }
  else if (card.value === 'give5') { classes.push('act', 'give5'); svg = HAND_SVG; cap = 'GIVE FIVE'; isAct = true; }
  else { classes.push(card.color); center = card.value; idx = card.value; }
  d.className = classes.join(' ');
  const centerEl = svg ? `<span class="c-svg">${svg}</span>` : `<span class="c-center">${center}</span>`;
  if (small) {
    d.innerHTML = centerEl;
  } else if (isAct) {
    // Aktionskarten: nur mittig (Icon/Symbol) + Beschriftung, keine Ecken-Symbole
    d.innerHTML = centerEl + (cap ? `<span class="c-cap">${cap}</span>` : '');
  } else {
    d.innerHTML =
      `<span class="c-idx tl">${idx}</span>` +
      centerEl +
      `<span class="c-idx br">${idx}</span>`;
  }
  return d;
}

function isActionCard(card) { return ['skip', 'draw2', 'keepall', 'give5'].includes(card.value); }

// kleine Badges für Front-Aktionskarten / Aussetzen-Status
function frontTags(p) {
  let s = '';
  if (p.draw2) s += ` <span class="front-tag draw2"><span class="c-svg">${CARDS2_SVG}</span> Nimm zwei</span>`;
  if (p.keepAll) s += ` <span class="front-tag keepall"><span class="c-svg">${THUMB_SVG}</span> Behalten</span>`;
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
  const outFirst = !(state.settings && state.settings.outFirstRound === false);
  $('lobby-rules').textContent = `🚪 Rauskommen in Runde 1: ${outFirst ? 'erlaubt' : 'gesperrt'}`;
  const isHost = state.hostId === playerId;
  $('btn-settings').classList.toggle('hidden', !isHost);
  // Offenes Einstellungs-Modal live nachziehen (z.B. bei Host-Wechsel/Reconnect)
  if (!$('settings-modal').classList.contains('hidden')) syncSettingsModal();
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
  // Admin-Panel im Menü nur für den Host während einer laufenden Runde
  const showAdmin = !!(state.isHost && state.started && !state.roundOver && !state.gameOver);
  $('admin-panel').classList.toggle('hidden', !showAdmin);

  // Zug-Banner
  const banner = $('turn-banner');
  const turnP = state.players.find(p => p.id === state.turnPlayerId);
  if (state.spectator) {
    banner.classList.remove('my-turn');
    banner.textContent = '👁 Zuschauer' + (turnP ? ` – ${turnP.name} ist am Zug` : '');
  } else if (isMyTurn()) {
    banner.classList.add('my-turn');
    banner.textContent = state.myHasDrawn ? '● Du bist dran – lege eine Karte ab' : '● Du bist dran – ziehe eine Karte';
  } else {
    banner.classList.remove('my-turn');
    banner.textContent = turnP ? `${turnP.name} ist am Zug …` : '';
  }
  // Eigenes Phasen-Panel für Zuschauer ausblenden
  const pt = document.querySelector('.phase-target'); if (pt) pt.style.display = state.spectator ? 'none' : '';

  // Gegner-Pods (für Zuschauer alle Spieler zeigen)
  const opp = $('opponents'); opp.innerHTML = '';
  for (const p of state.players) {
    if (!state.spectator && p.id === playerId) continue;
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
  // Zuschauer-Anzeige
  if (state.spectators && state.spectators.length) {
    const sp = document.createElement('div'); sp.className = 'opp spectators';
    sp.innerHTML = `<div class="opp-head"><div class="spec-eye">👁</div><div class="opp-info"><div class="name">${state.spectators.length} Zuschauer</div><div class="meta">${state.spectators.map(s => escapeHtml(s.name)).join(', ')}</div></div></div>`;
    opp.appendChild(sp);
  }

  // Beitritts-Anfragen / eigener Wartestatus
  const jr = $('join-requests'); jr.innerHTML = '';
  if (state.spectator) {
    if (state.myJoinAsPlayer) jr.innerHTML = '<div class="jr-banner ok">✓ Du wurdest zugelassen – du spielst ab der nächsten Runde mit.</div>';
    else if (state.myPending) jr.innerHTML = '<div class="jr-banner wait">⏳ Beitritt angefragt – warte auf Bestätigung eines Mitspielers …</div>';
  } else if (state.joinRequests && state.joinRequests.length) {
    state.joinRequests.forEach(r => {
      const row = document.createElement('div'); row.className = 'jr-banner req';
      const txt = document.createElement('span'); txt.className = 'jr-name';
      txt.textContent = `${r.name} möchte mitspielen`;
      const ok = btn('✓ Zulassen', 'good', () => socket.emit('confirmJoin', { id: r.id }));
      const no = btn('✕', 'danger', () => socket.emit('rejectJoin', { id: r.id }));
      ok.classList.add('jr-btn'); no.classList.add('jr-btn');
      row.appendChild(txt); row.appendChild(ok); row.appendChild(no);
      jr.appendChild(row);
    });
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
    dc.className = el.className; dc.innerHTML = el.innerHTML; dc.style.cssText = el.style.cssText;
  } else { dc.className = 'card empty'; dc.innerHTML = ''; dc.style.cssText = ''; }
  // Zweite Ablagekarte: nur mit aktivem „Nimm zwei" deutlich, sonst nur leicht angedeutet
  const ds = $('discard-second');
  if (ds) {
    const meP2 = me();
    const clear = !!(meP2 && meP2.draw2);
    if (state.discardSecond) {
      const el2 = cardEl(state.discardSecond);
      ds.style.cssText = el2.style.cssText;
      ds.className = el2.className + ' discard-second' + (clear ? ' clear' : '');
      ds.innerHTML = el2.innerHTML;
    } else { ds.className = 'card discard-second hidden'; ds.innerHTML = ''; ds.style.cssText = ''; }
  }

  $('action-log').textContent = state.lastAction || '';

  renderMeldsTable();
  renderHand();
  renderControls();
}

// Zentrale Tisch-Auslage: alle ausgelegten Phasen
function renderMeldsTable() {
  const t = $('melds-table'); t.innerHTML = '';
  // Anlegen ist direkt möglich, sobald man ausgelegt hat (kein extra Modus/Bestätigung)
  const canAnlegen = isMyTurn() && state.myHasDrawn && state.myLaidThisRound
    && mode !== 'lay' && !state.roundOver && !state.give5;
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
      if (canAnlegen) { gd.classList.add('hittable'); gd.onclick = () => doHit(p.id, gi); }
      groups.appendChild(gd);
    });
    block.appendChild(groups);
    t.appendChild(block);
  }
}

function renderHand() {
  const hand = $('my-hand'); hand.innerHTML = '';
  $('hand-count').textContent = state.myHand.length;
  // Bei vielen Karten kleiner darstellen, damit auch die 11.+ Karte sichtbar ist.
  hand.classList.toggle('many', state.myHand.length > 10);
  const usedInBuild = new Set(buildGroups.flat());
  // Auswahl bereinigen: Karten, die nicht mehr auf der Hand sind (z.B. gerade
  // angelegt), werden automatisch abgewählt – so kann man weiter anlegen.
  for (const id of [...selected]) if (!state.myHand.some(c => c.id === id)) selected.delete(id);

  for (const card of sortedHand()) {
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
  // Nach dem Auslegen: Mehrfachauswahl (zum Anlegen); eine einzelne Karte kann
  // per Button abgelegt werden. So kann man direkt an Auslagen anlegen.
  if (state.myLaidThisRound) {
    if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id);
    // Auslagen mit-neu-rendern, damit sie sofort anklickbar bleiben (Anlegen im selben Zug)
    renderHand(); renderControls(); renderMeldsTable();
    return;
  }
  // Vor dem Auslegen: Doppeltipp = direkt ablegen/spielen (flüssig); Einzeltipp = auswählen
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

  if (state.spectator) { build.classList.add('hidden'); c.innerHTML = '<p class="hint">👁 Du beobachtest als Zuschauer.</p>'; return; }
  if (!isMyTurn()) { build.classList.add('hidden'); return; }
  if (!state.myHasDrawn) { build.classList.add('hidden'); c.innerHTML = '<p class="hint">Tippe auf „Nachziehen" oder die Ablage.</p>'; return; }

  if (mode === 'lay') {
    renderBuildArea();
    c.appendChild(btn('Auslegen bestätigen', 'primary', confirmLay));
    c.appendChild(btn('Abbrechen', 'danger', cancelBuild));
    return;
  }

  build.classList.add('hidden');
  const sel = selected.size === 1 ? state.myHand.find(x => x.id === [...selected][0]) : null;
  const actSel = sel && isActionCard(sel);

  if (!state.myLaidThisRound) {
    // Vor dem Auslegen
    c.appendChild(btn('Phase auslegen', 'primary', startLay));
    if (actSel) c.appendChild(btn('▶ Aktion spielen', 'good', () => endTurnWithCard(sel.id)));
    else { const b = btn('Karte ablegen', 'good', doDiscard); b.disabled = selected.size !== 1; c.appendChild(b); }
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Tipp: Karte doppelt tippen legt sie sofort ab.';
    c.appendChild(hint);
  } else {
    // Nach dem Auslegen: anlegen (Karten wählen + auf Auslage tippen) und/oder ablegen
    if (actSel) c.appendChild(btn('▶ Aktion spielen', 'good', () => endTurnWithCard(sel.id)));
    else { const b = btn('Karte ablegen', 'good', doDiscard); b.disabled = selected.size !== 1; c.appendChild(b); }
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.innerHTML = selected.size
      ? 'Tippe auf eine Auslage, um die gewählten Karten anzulegen.'
      : 'Karten wählen und auf eine Auslage tippen zum Anlegen · letzte Karte anlegen oder ablegen beendet die Runde.';
    c.appendChild(hint);
  }
  // „Karte verfallen lassen" ganz unten, klar getrennt von den Hauptbuttons – kein Fehlklick
  if (actSel) c.appendChild(letExpireLink(sel));
}

// „Karte verfallen lassen" – kleiner, klar abgesetzter Link unter den Hauptbuttons,
// damit man nicht aus Versehen statt „Ablegen"/„Aktion spielen" darauf tippt.
function letExpireLink(sel) {
  const a = document.createElement('button');
  a.className = 'expire-link';
  a.textContent = 'Aktionskarte verfallen lassen';
  a.onclick = () => {
    socket.emit('discardAction', { cardId: sel.id });
    selected.clear(); lastTap = { id: null, t: 0 };
  };
  return a;
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
function doHit(targetId, groupIndex) {
  if (selected.size === 0) return toast('Wähle zuerst Karten aus deiner Hand.');
  // Auswahl NICHT sofort leeren: erfolgreich angelegte Karten verschwinden aus
  // der Hand und werden in renderHand automatisch abgewählt; bei Fehlschlag
  // bleibt die Auswahl erhalten, sodass man mehrfach/anders anlegen kann.
  socket.emit('hit', { targetId, groupIndex, cardIds: [...selected] });
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

// Eigene Handkarten UND die Auslage im Overlay ein-/ausblenden (Button)
function appendHandPeek(body, rerender) {
  if (!state) return;
  const b = btn(showHandPeek ? '🃏 Ansicht schließen' : '🃏 Meine Karten & Auslage', 'peek', () => { showHandPeek = !showHandPeek; rerender(); });
  b.classList.add('peek-btn');
  body.appendChild(b);
  if (!showHandPeek) return;

  if (state.myHand && state.myHand.length) {
    const l = document.createElement('div'); l.className = 'peek-label'; l.textContent = 'Deine Karten'; body.appendChild(l);
    const strip = document.createElement('div'); strip.className = 'hand-peek';
    sortedHand().forEach(c => strip.appendChild(cardEl(c, true)));
    body.appendChild(strip);
  }

  const l2 = document.createElement('div'); l2.className = 'peek-label'; l2.textContent = 'Auf dem Tisch'; body.appendChild(l2);
  const withMelds = state.players.filter(p => p.laidGroups && p.laidGroups.length);
  if (!withMelds.length) {
    const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'Noch nichts ausgelegt.'; body.appendChild(e);
  } else {
    const wrap = document.createElement('div'); wrap.className = 'peek-melds';
    withMelds.forEach(p => {
      const blk = document.createElement('div'); blk.className = 'peek-meld-block';
      const hd = document.createElement('div'); hd.className = 'peek-meld-head';
      hd.textContent = p.name + (p.id === playerId ? ' (du)' : '');
      blk.appendChild(hd);
      const gs = document.createElement('div'); gs.className = 'peek-meld-groups';
      p.laidGroups.forEach(g => {
        const gd = document.createElement('div'); gd.className = 'meld-group';
        g.cards.forEach(c => gd.appendChild(cardEl(c, true)));
        gs.appendChild(gd);
      });
      blk.appendChild(gs); wrap.appendChild(blk);
    });
    body.appendChild(wrap);
  }
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
    appendHandPeek(body, renderPendingDraw);
  }, []);
}

// ---------- Give me Five! ----------
function renderGive5() {
  const g = state.give5;
  if (g.by === playerId) {
    if (g.phase === 'collecting') {
      showOverlay('Give me Five!', `Warte auf Karten der Mitspieler … (${g.collected}/${g.needed})`, (body) => {
        appendHandPeek(body, renderGive5);
      }, []);
    } else {
      showOverlay('Give me Five! – nimm eine Karte', 'Wähle eine der angebotenen Karten.', (body) => {
        const wrap = document.createElement('div'); wrap.className = 'g5-offers';
        (g.offers || []).forEach(card => {
          const ce = cardEl(card); ce.onclick = () => socket.emit('pickOffered', { cardId: card.id });
          wrap.appendChild(ce);
        });
        body.appendChild(wrap);
        appendHandPeek(body, renderGive5);
      }, []);
    }
  } else if (g.currentOffererId === playerId && g.phase === 'collecting') {
    // Handreihenfolge einmal merken: abgegebene Karten bleiben an ihrer Stelle
    // (nur ausgegraut), damit sich beim Klicken nichts verschiebt.
    if (!g5Snapshot) g5Snapshot = [...state.myHand];
    showOverlay('Give me Five!', `${g.byName} fordert Karten – gib eine ab:`, (body) => {
      const wrap = document.createElement('div'); wrap.className = 'g5-offers';
      g5Snapshot.forEach(card => {
        const inHand = state.myHand.some(c => c.id === card.id);
        const ce = cardEl(card);
        if (inHand) ce.onclick = () => socket.emit('offerCard', { cardId: card.id });
        else ce.classList.add('g5-given'); // schon abgegeben -> ausgegraut
        wrap.appendChild(ce);
      });
      body.appendChild(wrap);
    }, []);
  } else {
    showOverlay('Give me Five!', `${g.byName} spielt „Give me Five!". Bitte warten … (${g.collected}/${g.needed})`, null, []);
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

// Wertungsblatt: Spieler × Runden + Gesamt
function scoreSheetEl() {
  const nRounds = Math.max(0, ...state.players.map(p => (p.roundScores || []).length));
  const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
  const t = document.createElement('table'); t.className = 'sheet-table';
  let head = '<tr><th class="pl">Spieler</th><th>Phase</th>';
  for (let i = 1; i <= nRounds; i++) head += `<th>R${i}</th>`;
  head += '<th class="tot">Ges.</th></tr>';
  const thead = document.createElement('thead'); thead.innerHTML = head; t.appendChild(thead);
  const tbody = document.createElement('tbody');
  [...state.players].sort((a, b) => a.score - b.score).forEach(p => {
    let row = `<td class="pl"><span class="avatar sm" style="background:${colorFor(p.name)}">${initials(p.name)}</span>${escapeHtml(p.name)}${p.id === playerId ? ' <span class="you-tag">(du)</span>' : ''}${p.finishedGame ? ' 🏆' : ''}</td>`;
    row += `<td>${p.phase + 1}</td>`;
    for (let i = 0; i < nRounds; i++) row += `<td>${(p.roundScores && p.roundScores[i] != null) ? p.roundScores[i] : '–'}</td>`;
    row += `<td class="tot">${p.score}</td>`;
    const tr = document.createElement('tr'); tr.innerHTML = row; tbody.appendChild(tr);
  });
  t.appendChild(tbody); wrap.appendChild(t);
  return wrap;
}

function renderRoundOver() {
  showHandPeek = false;
  const meP = me();
  const iAmReady = meP && meP.ready;
  const conn = state.players.filter(p => p.connected);
  const readyList = state.players.filter(p => p.ready);

  // "Alles meins!": eigene Entscheidung mit sichtbaren Handkarten
  if (state.myKeepAllPending) {
    showOverlay('Behalten – Karten behalten?', '', (body) => {
      const info = document.createElement('p'); info.className = 'hint';
      info.textContent = 'Behalte deine Handkarten für die nächste Runde (du bekommst dafür trotzdem die Minuspunkte) oder gib sie ab und erhalte eine frische Hand.';
      body.appendChild(info);
      const lbl = document.createElement('div'); lbl.className = 'peek-label'; lbl.textContent = 'Deine Handkarten'; body.appendChild(lbl);
      const strip = document.createElement('div'); strip.className = 'hand-peek';
      (state.myHand || []).forEach(c => strip.appendChild(cardEl(c, true)));
      body.appendChild(strip);
      body.appendChild(scoreSheetEl());
    }, [
      { text: '✓ Karten behalten', cls: 'primary', fn: () => socket.emit('keepAllChoice', { keep: true }) },
      { text: 'Abgeben', cls: 'danger', fn: () => socket.emit('keepAllChoice', { keep: false }) },
    ]);
    return;
  }

  showOverlay('Runde beendet', state.lastAction || '', (body) => {
    body.appendChild(scoreSheetEl());
    const st = document.createElement('p'); st.className = 'ready-status';
    st.innerHTML = `Bereit: <b>${readyList.length}/${conn.length}</b>` + (readyList.length ? ` – ${readyList.map(p => escapeHtml(p.name)).join(', ')}` : '');
    body.appendChild(st);
    if (iAmReady) { const w = document.createElement('p'); w.className = 'hint'; w.textContent = 'Warte auf die anderen Spieler …'; body.appendChild(w); }
  }, iAmReady ? [] : [{ text: '✓ Bereit für nächste Runde', cls: 'primary', fn: () => socket.emit('ready') }]);
}

function renderGameOver() {
  const names = state.winners.map(w => w.name).join(' & ');
  const isHost = state.hostId === playerId;
  showOverlay('🏆 Spiel beendet', '', (body) => {
    const w = document.createElement('p');
    w.innerHTML = `Sieger: <span class="winner-name">${escapeHtml(names)}</span>`;
    body.appendChild(w);
    body.appendChild(scoreSheetEl());
  }, isHost ? [{ text: 'Neues Spiel', cls: 'primary', fn: () => socket.emit('startGame') }] : []);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
