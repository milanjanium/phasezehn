// ============================================================
//  Phase 10 – Online Multiplayer Server
// ============================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const G = require('./game');
const store = require('./store');

const app = express();
const server = http.createServer(app);
// Großzügige Ping-Timeouts: toleranter gegenüber kurzen Netz-Wacklern
// (Handy-Sperre, WLAN-Wechsel), damit die Verbindung nicht ständig abbricht.
const io = new Server(server, { pingInterval: 25000, pingTimeout: 60000 });

app.get('/health', (req, res) => res.type('text').send('ok'));

// index.html mit Cache-Busting ausliefern: an style.css/client.js wird eine
// Version (Datei-Änderungszeit) angehängt, damit Browser nach einem Deploy
// IMMER die aktuellen Assets laden. Sonst bleiben alte CSS/JS gecacht und die
// Seite wirkt "kaputt" (z. B. unzentriert oder toter Button).
function assetVersion() {
  try {
    const a = fs.statSync(path.join(__dirname, 'public', 'style.css')).mtimeMs;
    const b = fs.statSync(path.join(__dirname, 'public', 'client.js')).mtimeMs;
    return Math.floor(Math.max(a, b)).toString(36);
  } catch { return Date.now().toString(36); }
}
function sendIndex(req, res) {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) return res.status(500).type('text').send('Fehler beim Laden.');
    const v = assetVersion();
    html = html
      .replace('href="style.css"', `href="style.css?v=${v}"`)
      .replace('src="client.js"', `src="client.js?v=${v}"`);
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  });
}
app.get('/', sendIndex);
app.get('/index.html', sendIndex);
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// roomCode -> room
const rooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function makePlayer(id, name) {
  return {
    id, name,
    socketId: null,
    connected: true,
    hand: [],
    phase: 0,          // aktuelle Phase (0..9)
    laidGroups: [],    // ausgelegte Melds { type, count, cards }
    laidThisRound: false,
    completedPhase: false,
    hasDrawn: false,
    score: 0,
    roundScores: [],   // Minuspunkte pro Runde (für das Wertungsblatt)
    finishedGame: false,
    draw2: false,      // "Nimm zwei!" liegt vor dem Spieler
    keepAll: false,    // "Alles meins!" liegt vor dem Spieler
    keepAllKeep: false,    // Entscheidung am Rundenende: Handkarten behalten?
    keepAllDecided: false, // schon entschieden?
    pendingDraw: null, // bei Nimm-zwei: 2 gezogene Karten zur Auswahl
  };
}

// ---- State-Serialisierung für die Clients ----
function playerPublic(room, p) {
  return {
    id: p.id, name: p.name, connected: p.connected,
    handCount: p.hand.length,
    phase: p.phase,
    laidGroups: p.laidGroups,
    laidThisRound: p.laidThisRound,
    score: p.score,
    roundScores: p.roundScores,
    finishedGame: p.finishedGame,
    draw2: p.draw2,
    keepAll: p.keepAll,
    willSkip: room.skipTargets ? room.skipTargets.has(p.id) : false,
    ready: room.ready ? room.ready.has(p.id) : false,
  };
}

// Öffentliche Info zu einem laufenden "Give me Five!"
function give5Public(room) {
  const g = room.give5;
  if (!g) return null;
  const asker = room.players.find(p => p.id === g.by);
  return {
    by: g.by,
    byName: asker ? asker.name : '',
    phase: g.phase,                 // 'collecting' | 'picking'
    currentOffererId: g.currentId || null,
    needed: g.needed,
    collected: g.offers.length,
    // die bereits angebotenen Karten (offen, jeder darf sie sehen)
    offers: g.phase === 'picking' ? g.offers.map(o => o.card) : [],
  };
}

function stateFor(room, playerId) {
  const players = room.players.map(p => playerPublic(room, p));
  const me = room.players.find(p => p.id === playerId);
  return {
    code: room.code,
    hostId: room.hostId,
    settings: room.settings || null,
    started: room.started,
    roundOver: room.roundOver,
    gameOver: room.gameOver,
    winners: room.winners || null,
    players,
    phases: G.PHASES,
    discardTop: room.discard.length ? room.discard[room.discard.length - 1] : null,
    discardSecond: room.discard.length >= 2 ? room.discard[room.discard.length - 2] : null,
    drawCount: room.deck.length,
    turnPlayerId: room.started && !room.roundOver ? room.players[room.turnIndex].id : null,
    myHand: me ? me.hand : [],
    myPhaseIndex: me ? me.phase : 0,
    myHasDrawn: me ? me.hasDrawn : false,
    myLaidThisRound: me ? me.laidThisRound : false,
    myPendingDraw: me ? me.pendingDraw : null,
    myKeepAllPending: !!(room.roundOver && me && keepAllPending(me)),
    give5: give5Public(room),
    undoVote: undoVotePublic(room, playerId),
    isHost: room.hostId === playerId,
    lastAction: room.lastAction || null,
    lastFinisher: room.lastFinisher || null,
    spectator: !me && (room.spectators || []).some(s => s.id === playerId),
    spectators: (room.spectators || []).map(s => ({ name: s.name, connected: s.connected })),
    joinRequests: (room.spectators || []).filter(s => s.pending).map(s => ({ id: s.id, name: s.name })),
    myPending: !me && (room.spectators || []).some(s => s.id === playerId && s.pending),
    myJoinAsPlayer: !me && (room.spectators || []).some(s => s.id === playerId && s.joinAsPlayer),
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, p.id));
  }
  for (const s of (room.spectators || [])) {
    if (s.socketId) io.to(s.socketId).emit('state', stateFor(room, s.id));
  }
  schedulePersist(room);
}

// ---- Persistenz: Raum <-> JSON (Sets -> Arrays, keine Socket-IDs) ----
function serializeRoom(room) {
  return {
    code: room.code, hostId: room.hostId, started: room.started,
    dealerIndex: room.dealerIndex, turnIndex: room.turnIndex,
    deck: room.deck, discard: room.discard,
    roundOver: room.roundOver, gameOver: room.gameOver, winners: room.winners || null,
    lastAction: room.lastAction || null, lastFinisher: room.lastFinisher || null,
    roundNo: room.roundNo || 0, emptySince: room.emptySince || null,
    settings: room.settings || null,
    skipTargets: [...(room.skipTargets || [])],
    ready: [...(room.ready || [])],
    tookTurn: [...(room.tookTurn || [])],
    give5: room.give5 || null,
    players: room.players.map(p => ({ ...p, socketId: null })),
    spectators: (room.spectators || []).map(s => ({ ...s, socketId: null })),
  };
}
function deserializeRoom(d) {
  const room = { ...d };
  room.skipTargets = new Set(d.skipTargets || []);
  room.ready = new Set(d.ready || []);
  room.tookTurn = new Set(d.tookTurn || []);
  // Nach einem Neustart ist niemand verbunden – alle müssen sich neu einklinken.
  room.players = (d.players || []).map(p => ({ ...p, socketId: null, connected: false }));
  room.spectators = (d.spectators || []).map(s => ({ ...s, socketId: null, connected: false }));
  room.emptySince = Date.now();
  return room;
}

const persistTimers = new Map();
function schedulePersist(room) {
  if (!store.enabled || !room || persistTimers.has(room.code)) return;
  persistTimers.set(room.code, setTimeout(() => {
    persistTimers.delete(room.code);
    store.save(room.code, serializeRoom(room)).catch(() => {});
  }, 800));
}
function removePersisted(code) {
  if (!store.enabled) return;
  const t = persistTimers.get(code);
  if (t) { clearTimeout(t); persistTimers.delete(code); }
  store.remove(code).catch(() => {});
}

function currentPlayer(room) { return room.players[room.turnIndex]; }

// Zeigt einem Spieler die gerade gezogene Karte kurz groß an (Client-Animation).
function reveal(player, card, caption) {
  if (player && player.socketId) io.to(player.socketId).emit('cardReveal', { card, caption: caption || '' });
}

// ---- Runde starten / austeilen ----
function startRound(room) {
  // Bestätigte Beitritts-Anfragen als Mitspieler übernehmen (ab dieser Runde).
  if (room.spectators && room.spectators.some(s => s.joinAsPlayer)) {
    for (const s of room.spectators.filter(s => s.joinAsPlayer)) {
      if (room.players.length >= 6) break;
      const np = makePlayer(s.id, s.name);
      np.socketId = s.socketId; np.connected = s.connected;
      room.players.push(np);
    }
    room.spectators = room.spectators.filter(s => !s.joinAsPlayer);
  }
  const deck = G.shuffle(G.buildDeck());
  for (const p of room.players) {
    if (p.keepAll && p.keepAllKeep && !p.completedPhase) {
      // "Alles meins!": Handkarten behalten (nur wer die Phase NICHT geschafft hat), bis 10 auffüllen.
      while (p.hand.length < 10) p.hand.push(deck.shift());
    } else {
      p.hand = deck.splice(0, 10);
    }
    p.laidGroups = [];
    p.laidThisRound = false;
    p.completedPhase = false;
    p.hasDrawn = false;
    p.draw2 = false;      // Front-Aktionskarten werden zurückgegeben
    p.keepAll = false;
    p.keepAllKeep = false;
    p.keepAllDecided = false;
    p.pendingDraw = null;
  }
  // Erste Ablagekarte (keine Joker-/Aktionskarte als Startkarte)
  let top = deck.shift();
  while (G.isSpecial(top)) { deck.push(top); G.shuffle(deck); top = deck.shift(); }
  room.deck = deck;
  room.discard = [top];
  room.skipTargets = new Set();
  room.give5 = null;
  room.ready = new Set();
  room.roundOver = false;
  room.lastAction = null;
  room.lastFinisher = null;
  room.roundNo = (room.roundNo || 0) + 1; // 1 = erste Runde
  room.tookTurn = new Set();              // wer in dieser Runde schon dran war
  room.turnHistory = [];                  // Zug-Snapshots (Admin-Rücksetzung), pro Runde
  room.undoVote = null;

  // Startspieler rotiert pro Runde
  room.turnIndex = room.dealerIndex % room.players.length;
  room.players[room.turnIndex].hasDrawn = false;
  snapshotTurn(room); // erster Zug der Runde
}

// Rauskommen in Runde 1: per Raum-Einstellung. Standard erlaubt; ist es
// deaktiviert, darf in Runde 1 niemand rausgehen (Hand nie auf 0 bringen).
function round1BlocksOut(room) {
  return room.roundNo === 1 && !!(room.settings && room.settings.outFirstRound === false);
}

// "Alles meins!"-Entscheidung steht noch aus? (Wer die Phase geschafft hat, darf NICHT behalten.)
function keepAllPending(p) {
  return p.keepAll && !p.keepAllDecided && !p.completedPhase;
}

function replenishDeckIfNeeded(room) {
  if (room.deck.length === 0 && room.discard.length > 1) {
    const top = room.discard.pop();
    room.deck = G.shuffle(room.discard);
    room.discard = [top];
  }
}

function advanceTurn(room) {
  const n = room.players.length;
  // Der Spieler, der gerade fertig ist, war dran.
  if (room.tookTurn) room.tookTurn.add(room.players[room.turnIndex].id);
  let idx = room.turnIndex;
  for (let step = 0; step < n * 2; step++) {
    idx = (idx + 1) % n;
    const p = room.players[idx];
    if (room.skipTargets.has(p.id)) {
      room.skipTargets.delete(p.id);
      if (room.tookTurn) room.tookTurn.add(p.id); // Ausgesetzte zählen als "dran gewesen"
      continue; // dieser Spieler setzt aus
    }
    break;
  }
  room.turnIndex = idx;
  room.players[idx].hasDrawn = false;
  snapshotTurn(room); // Zustand am Zugbeginn merken (für Admin-Rücksetzung)
}

// Karten einer Auslage in korrekte Reihenfolge bringen:
// Folgen numerisch (Joker an Lückenposition), Sets/Farbgruppen nach Zahl.
function meldVal(c) {
  if (typeof c.value === 'number') return c.value;
  if (c.value === 'joker') return c.range === 'lo' ? 6.5 : 12.5;
  return 999;
}
function orderMeld(type, cards) {
  if (type === 'run' || type === 'colorrun') {
    const arr = G.runArrangements(cards);
    return arr.length ? arr[0].seq.slice() : cards.slice();
  }
  return [...cards].sort((a, b) => meldVal(a) - meldVal(b));
}

// Anlegen abschließen: Reihenfolge übernehmen, Karten aus der Hand nehmen,
// ggf. Runde beenden (Rausgehen per Anlegen der letzten Karte).
function finishHit(room, me, target, group, cards, orderedCards) {
  // Folgen behalten die gewählte Anordnung; Sets/Farbgruppen nach Zahl sortieren.
  group.cards = (group.type === 'run' || group.type === 'colorrun')
    ? orderedCards.slice()
    : orderMeld(group.type, orderedCards);
  const usedIds = new Set(cards.map(c => c.id));
  me.hand = me.hand.filter(c => !usedIds.has(c.id));
  if (me.hand.length === 0) {
    room.lastAction = `${me.name} hat angelegt und ist raus!`;
    endRound(room, me);
    broadcast(room);
    return;
  }
  room.lastAction = `${me.name} hat angelegt.`;
  broadcast(room);
}

// ---- Admin: Zug rückgängig machen (Snapshots am Zugbeginn) ----
const clone = (x) => JSON.parse(JSON.stringify(x));
function snapshotTurn(room) {
  const cur = currentPlayer(room);
  if (!cur) return;
  const snap = {
    ownerId: cur.id, ownerName: cur.name,
    deck: clone(room.deck), discard: clone(room.discard),
    turnIndex: room.turnIndex, dealerIndex: room.dealerIndex, roundNo: room.roundNo,
    skipTargets: [...(room.skipTargets || [])], tookTurn: [...(room.tookTurn || [])],
    players: room.players.map(p => ({
      id: p.id, hand: clone(p.hand), laidGroups: clone(p.laidGroups),
      phase: p.phase, completedPhase: p.completedPhase, laidThisRound: p.laidThisRound,
      hasDrawn: p.hasDrawn, pendingDraw: p.pendingDraw ? clone(p.pendingDraw) : null,
      draw2: p.draw2, keepAll: p.keepAll, keepAllKeep: p.keepAllKeep, keepAllDecided: p.keepAllDecided,
      score: p.score, roundScores: clone(p.roundScores), finishedGame: p.finishedGame,
    })),
  };
  room.turnHistory = room.turnHistory || [];
  room.turnHistory.push(snap);
  if (room.turnHistory.length > 30) room.turnHistory.shift();
}
// Welchen Zug würde eine Rücksetzung betreffen? Hat der aktuelle Spieler schon
// gehandelt -> sein eigener Zug; sonst der vorherige (abgeschlossene) Zug.
function undoTargetInfo(room) {
  const hist = room.turnHistory || [];
  if (!hist.length) return null;
  const cur = currentPlayer(room);
  const curActed = cur && (cur.hasDrawn || cur.laidThisRound);
  if (curActed) return { snap: hist[hist.length - 1], keepLen: hist.length };
  if (hist.length < 2) return null;
  return { snap: hist[hist.length - 2], keepLen: hist.length - 1 };
}
function restoreSnapshot(room, snap) {
  room.deck = clone(snap.deck);
  room.discard = clone(snap.discard);
  room.turnIndex = snap.turnIndex;
  room.dealerIndex = snap.dealerIndex;
  room.roundNo = snap.roundNo;
  room.skipTargets = new Set(snap.skipTargets);
  room.tookTurn = new Set(snap.tookTurn);
  room.give5 = null;
  room.roundOver = false; room.gameOver = false; room.winners = null;
  room.lastFinisher = null;
  for (const ps of snap.players) {
    const p = room.players.find(x => x.id === ps.id);
    if (!p) continue;
    p.hand = clone(ps.hand); p.laidGroups = clone(ps.laidGroups);
    p.phase = ps.phase; p.completedPhase = ps.completedPhase; p.laidThisRound = ps.laidThisRound;
    p.hasDrawn = ps.hasDrawn; p.pendingDraw = ps.pendingDraw ? clone(ps.pendingDraw) : null;
    p.pendingHit = null;
    p.draw2 = ps.draw2; p.keepAll = ps.keepAll; p.keepAllKeep = ps.keepAllKeep; p.keepAllDecided = ps.keepAllDecided;
    p.score = ps.score; p.roundScores = clone(ps.roundScores); p.finishedGame = ps.finishedGame;
  }
}
function undoVotePublic(room, playerId) {
  const v = room.undoVote;
  if (!v) return null;
  const connected = room.players.filter(p => p.connected);
  const pending = connected.filter(p => !v.approvals.includes(p.id)).map(p => p.name);
  return {
    by: v.by,
    targetId: v.targetId, targetName: v.targetName,
    approved: v.approvals.length,
    needed: connected.length,
    pending,
    iApproved: v.approvals.includes(playerId),
    isPlayer: room.players.some(p => p.id === playerId),
  };
}
function tryFinishUndo(room) {
  const v = room.undoVote;
  if (!v) return;
  const connectedIds = room.players.filter(p => p.connected).map(p => p.id);
  if (!connectedIds.every(id => v.approvals.includes(id))) return;
  restoreSnapshot(room, v.snap);
  room.turnHistory = (room.turnHistory || []).slice(0, v.keepLen);
  room.undoVote = null;
  room.lastAction = `Zug von ${v.targetName} wurde zurückgesetzt.`;
}

// ---- "Give me Five!" ----
function startGive5(room, asker) {
  const n = room.players.length;
  const ai = room.players.findIndex(p => p.id === asker.id);
  const order = [];
  for (let k = 1; k < n; k++) order.push(room.players[(ai + k) % n].id); // ab linkem Nachbarn
  const totalCards = room.players
    .filter(p => p.id !== asker.id)
    .reduce((s, p) => s + p.hand.length, 0);
  room.give5 = {
    by: asker.id, phase: 'collecting', order, step: 0,
    offers: [], needed: Math.min(5, totalCards), currentId: null,
  };
  give5NextOfferer(room);
}

function give5NextOfferer(room) {
  const g = room.give5;
  if (!g) return;
  if (g.offers.length >= g.needed) return give5ToPicking(room);
  const L = g.order.length;
  for (let tries = 0; tries < L; tries++) {
    const id = g.order[g.step % L];
    g.step++;
    const pl = room.players.find(p => p.id === id);
    if (pl && pl.hand.length > 0) { g.currentId = id; return; }
  }
  give5ToPicking(room); // niemand hat mehr Karten
}
const advanceGive5 = give5NextOfferer;

function give5ToPicking(room) {
  const g = room.give5;
  if (g.offers.length === 0) return finishGive5NoPick(room);
  g.phase = 'picking';
  g.currentId = null;
}

function finishGive5NoPick(room) {
  const g = room.give5;
  const asker = room.players.find(p => p.id === g.by);
  room.give5 = null;
  if (asker) asker.hasDrawn = false;
  advanceTurn(room);
}

// ---- Rundenende & Wertung ----
function endRound(room, goneOutPlayer) {
  room.roundOver = true;
  for (const p of room.players) {
    // Restpunkte dieser Runde erfassen (jede Karte = 1 Punkt)
    let rp = 0;
    for (const c of p.hand) rp += G.cardPoints(c);
    p.score += rp;
    p.roundScores.push(rp);
    // Wer seine Phase geschafft hat, rückt vor
    if (p.completedPhase) {
      if (p.phase === G.PHASES.length - 1) {
        p.finishedGame = true; // Phase 10 geschafft
      }
      p.phase = Math.min(p.phase + 1, G.PHASES.length - 1);
    }
  }
  room.lastAction = `${goneOutPlayer.name} hat die Runde beendet!`;
  room.lastFinisher = goneOutPlayer.id;

  // Spielende? Mindestens ein Spieler hat Phase 10 abgeschlossen
  const finishers = room.players.filter(p => p.finishedGame);
  if (finishers.length > 0) {
    const minScore = Math.min(...finishers.map(p => p.score));
    room.winners = finishers.filter(p => p.score === minScore).map(p => ({ id: p.id, name: p.name, score: p.score }));
    room.gameOver = true;
  } else {
    room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  }
}

// ============================================================
//  Socket-Handling
// ============================================================
io.on('connection', (socket) => {
  let joinedRoom = null;
  let selfId = null;

  function fail(msg) { socket.emit('errorMsg', msg); }

  socket.on('createRoom', ({ name, playerId }, cb) => {
    name = (name || '').trim().slice(0, 20) || 'Spieler';
    const code = makeRoomCode();
    const room = {
      code, hostId: playerId, players: [], started: false,
      deck: [], discard: [], turnIndex: 0, dealerIndex: 0,
      skipTargets: new Set(), give5: null, ready: new Set(), spectators: [],
      roundOver: false, gameOver: false, winners: null,
      settings: { outFirstRound: true }, // Standard: Rauskommen in der ersten Runde erlaubt
    };
    const p = makePlayer(playerId, name);
    p.socketId = socket.id;
    room.players.push(p);
    rooms.set(code, room);
    joinedRoom = room; selfId = playerId;
    socket.join(code);
    cb && cb({ ok: true, code });
    broadcast(room);
  });

  // Host ändert Raum-Einstellungen (nur in der Lobby, vor Spielstart).
  socket.on('updateSettings', ({ settings } = {}) => {
    const room = joinedRoom;
    if (!room) return;
    if (room.hostId !== selfId) return fail('Nur der Host kann die Einstellungen ändern.');
    if (room.started) return fail('Einstellungen sind nach Spielstart gesperrt.');
    if (!room.settings) room.settings = {};
    if (settings && typeof settings.outFirstRound === 'boolean')
      room.settings.outFirstRound = settings.outFirstRound;
    broadcast(room);
  });

  socket.on('joinRoom', ({ code, name, playerId }, cb) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Raum nicht gefunden.' });
    name = (name || '').trim().slice(0, 20) || 'Spieler';
    let p = room.players.find(pp => pp.id === playerId);
    if (!p && room.started) {
      // Wiedereinstieg ins laufende Spiel: getrennten Spieler mit gleichem
      // Namen übernehmen (z.B. wenn die Sitzung/ID nach Verbindungsverlust weg ist).
      const slot = room.players.find(pp => !pp.connected && pp.name.toLowerCase() === name.toLowerCase());
      if (slot) {
        if (room.hostId === slot.id) room.hostId = playerId;
        if (room.skipTargets.has(slot.id)) { room.skipTargets.delete(slot.id); room.skipTargets.add(playerId); }
        slot.id = playerId;
        p = slot;
      }
    }
    if (p) {
      // (Wieder-)Beitritt als Spieler
      p.socketId = socket.id; p.connected = true; p.name = name;
      room.spectators = (room.spectators || []).filter(s => s.id !== playerId);
      joinedRoom = room; selfId = playerId;
      socket.join(code);
      cb && cb({ ok: true, code });
      broadcast(room);
      return;
    }
    if (room.started) {
      // Kein passender Spieler-Name -> als Zuschauer beobachten, mit
      // Beitritts-Anfrage: ein Mitspieler kann den Beitritt bestätigen.
      room.spectators = room.spectators || [];
      let sp = room.spectators.find(s => s.id === playerId);
      if (sp) { sp.socketId = socket.id; sp.connected = true; sp.name = name; }
      else { sp = { id: playerId, name, socketId: socket.id, connected: true, pending: true, joinAsPlayer: false }; room.spectators.push(sp); }
      joinedRoom = room; selfId = playerId;
      socket.join(code);
      cb && cb({ ok: true, code, spectator: true, pending: !!sp.pending });
      broadcast(room);
      return;
    }
    if (room.players.length >= 6) return cb && cb({ error: 'Raum ist voll (max. 6).' });
    p = makePlayer(playerId, name);
    p.socketId = socket.id;
    room.players.push(p);
    joinedRoom = room; selfId = playerId;
    socket.join(code);
    cb && cb({ ok: true, code });
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = joinedRoom;
    if (!room || room.hostId !== selfId) return;
    if (room.players.length < 2) return fail('Mindestens 2 Spieler nötig.');
    room.started = true;
    room.gameOver = false;
    room.winners = null;
    room.dealerIndex = 0;
    for (const p of room.players) { p.phase = 0; p.score = 0; p.roundScores = []; p.finishedGame = false; }
    startRound(room);
    broadcast(room);
  });

  // Nach einer Runde: jeder drückt "Bereit"; sind alle bereit, geht es weiter.
  socket.on('ready', () => {
    const room = joinedRoom;
    if (!room || !room.roundOver || room.gameOver) return;
    const me = room.players.find(p => p.id === selfId);
    if (me && keepAllPending(me)) return fail('Bitte zuerst über „Behalten" entscheiden.');
    room.ready = room.ready || new Set();
    room.ready.add(selfId);
    const allReady = room.players.filter(p => p.connected).every(p => room.ready.has(p.id));
    if (allReady) startRound(room);
    broadcast(room);
  });

  // "Alles meins!" – am Rundenende entscheiden: Handkarten behalten oder abgeben.
  // Wer die Phase geschafft hat, darf NICHT behalten – die Karte verfällt.
  socket.on('keepAllChoice', ({ keep }) => {
    const room = joinedRoom;
    if (!room || !room.roundOver || room.gameOver) return;
    const me = room.players.find(p => p.id === selfId);
    if (!me || !me.keepAll || me.completedPhase) return;
    me.keepAllKeep = !!keep;
    me.keepAllDecided = true;
    room.ready = room.ready || new Set();
    room.ready.add(selfId); // Entscheidung zählt als "bereit"
    const allReady = room.players.filter(p => p.connected).every(p => room.ready.has(p.id));
    if (allReady) startRound(room);
    broadcast(room);
  });

  // Beitritts-Anfrage bestätigen (jeder verbundene Mitspieler darf).
  socket.on('confirmJoin', ({ id }) => {
    const room = joinedRoom;
    if (!room || !room.started) return;
    if (!room.players.some(p => p.id === selfId && p.connected)) return;
    const sp = (room.spectators || []).find(s => s.id === id && s.pending);
    if (!sp) return;
    const willBe = room.players.length + (room.spectators || []).filter(s => s.joinAsPlayer).length;
    if (willBe >= 6) return fail('Der Raum ist voll (max. 6 Spieler).');
    sp.pending = false; sp.joinAsPlayer = true;
    room.lastAction = `${sp.name} wurde zugelassen und spielt ab der nächsten Runde mit.`;
    io.to(room.code).emit('info', room.lastAction);
    broadcast(room);
  });
  socket.on('rejectJoin', ({ id }) => {
    const room = joinedRoom;
    if (!room || !room.started) return;
    if (!room.players.some(p => p.id === selfId && p.connected)) return;
    const sp = (room.spectators || []).find(s => s.id === id && s.pending);
    if (!sp) return;
    sp.pending = false; // bleibt Zuschauer, Anfrage entfernt
    broadcast(room);
  });

  // Host kann die nächste Runde auch erzwingen (Fallback).
  socket.on('nextRound', () => {
    const room = joinedRoom;
    if (!room || room.hostId !== selfId || room.gameOver) return;
    if (!room.roundOver) return;
    startRound(room);
    broadcast(room);
  });

  socket.on('draw', ({ source }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    if (room.give5) return fail('Bitte zuerst „Give me Five!" abschließen.');
    if (room.undoVote) return fail('Bitte zuerst über die Zug-Rücksetzung abstimmen.');
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (me.pendingDraw) return fail('Wähle zuerst eine der beiden Karten.');
    if (me.hasDrawn) return fail('Du hast bereits gezogen.');

    if (source === 'discard') {
      const top = room.discard[room.discard.length - 1];
      if (!top) return fail('Ablagestapel ist leer.');
      if (G.isAction(top)) return fail('Diese Karte darf nicht aufgenommen werden.');
      if (me.draw2 && room.discard.length >= 2 && !G.isAction(room.discard[room.discard.length - 2])) {
        // "Nimm zwei!" von der Ablage: die obersten zwei Karten, eine behalten
        const two = [room.discard.pop(), room.discard.pop()];
        me.pendingDraw = two;
        room.lastAction = `${me.name} zieht zwei von der Ablage (Nimm zwei!).`;
      } else {
        me.hand.push(room.discard.pop());
        me.hasDrawn = true;
        room.lastAction = `${me.name} hat vom Ablagestapel gezogen.`;
      }
    } else {
      // "Nimm zwei!": zwei Karten ziehen, eine behalten
      if (me.draw2) {
        replenishDeckIfNeeded(room);
        const two = [];
        while (two.length < 2 && (room.deck.length || room.discard.length > 1)) {
          replenishDeckIfNeeded(room);
          if (!room.deck.length) break;
          two.push(room.deck.shift());
        }
        if (two.length === 0) return fail('Keine Karten mehr.');
        if (two.length === 1) { me.hand.push(two[0]); me.hasDrawn = true; reveal(me, two[0]); }
        else { me.pendingDraw = two; }
        room.lastAction = `${me.name} zieht zwei Karten (Nimm zwei!).`;
      } else {
        replenishDeckIfNeeded(room);
        if (room.deck.length === 0) return fail('Keine Karten mehr.');
        const c = room.deck.shift();
        me.hand.push(c);
        me.hasDrawn = true;
        reveal(me, c); // gezogene Karte kurz groß zeigen
        room.lastAction = `${me.name} hat eine Karte gezogen.`;
      }
    }
    broadcast(room);
  });

  // "Nimm zwei!": eine der beiden gezogenen Karten behalten, die andere abwerfen
  socket.on('keepDrawn', ({ cardId }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (!me.pendingDraw) return fail('Nichts zur Auswahl.');
    const idx = me.pendingDraw.findIndex(c => c.id === cardId);
    if (idx === -1) return fail('Karte nicht gefunden.');
    const keep = me.pendingDraw[idx];
    const other = me.pendingDraw[1 - idx];
    me.hand.push(keep);
    // Die andere Karte: Zahlen/Joker offen auf den Ablagestapel, Aktionskarten wirkungslos aus dem Spiel.
    if (!G.isAction(other)) room.discard.push(other);
    me.pendingDraw = null;
    me.hasDrawn = true;
    room.lastAction = `${me.name} hat eine Karte behalten.`;
    broadcast(room);
  });

  socket.on('layPhase', ({ groups }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    if (room.give5) return fail('Bitte zuerst „Give me Five!" abschließen.');
    if (room.undoVote) return fail('Bitte zuerst über die Zug-Rücksetzung abstimmen.');
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (me.pendingDraw) return fail('Wähle zuerst eine der beiden Karten.');
    if (!me.hasDrawn) return fail('Erst ziehen, dann auslegen.');
    if (me.laidThisRound) return fail('Du hast diese Runde schon ausgelegt.');
    if (!Array.isArray(groups)) return fail('Ungültige Auswahl.');

    // IDs -> Karten aus der Hand
    const handById = new Map(me.hand.map(c => [c.id, c]));
    const usedIds = new Set();
    const cardGroups = [];
    for (const ids of groups) {
      const cards = [];
      for (const id of ids) {
        if (!handById.has(id) || usedIds.has(id)) return fail('Karte nicht auf der Hand.');
        usedIds.add(id);
        cards.push(handById.get(id));
      }
      cardGroups.push(cards);
    }
    if (!G.validatePhase(me.phase, cardGroups)) return fail('Auslage erfüllt die Phase nicht.');
    // Gleiche Zahl darf nicht mehrfach über Zahlengruppen verteilt werden
    // (z.B. Phase 1 nicht mit zwei 6er-Zwillingen).
    const setNums = [];
    G.PHASES[me.phase].groups.forEach((req, i) => {
      if (req.type === 'set') { const n = cardGroups[i].find(G.isNumber); if (n) setNums.push(n.value); }
    });
    if (new Set(setNums).size !== setNums.length)
      return fail('Jede Zahlengruppe muss eine andere Zahl haben.');

    // Übernehmen – Karten immer in korrekter Reihenfolge (Folgen numerisch, Joker
    // an ihrer Lückenposition; Sets/Farbgruppen nach Zahl).
    const phaseDef = G.PHASES[me.phase];
    me.laidGroups = cardGroups.map((cards, i) => {
      const type = phaseDef.groups[i].type;
      return { type, count: phaseDef.groups[i].count, cards: orderMeld(type, cards), owner: me.id };
    });
    me.hand = me.hand.filter(c => !usedIds.has(c.id));
    me.laidThisRound = true;
    me.completedPhase = true;
    room.lastAction = `${me.name} hat Phase ${me.phase + 1} ausgelegt!`;
    broadcast(room);
  });

  socket.on('hit', ({ targetId, groupIndex, cardIds }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    if (room.give5) return fail('Bitte zuerst „Give me Five!" abschließen.');
    if (room.undoVote) return fail('Bitte zuerst über die Zug-Rücksetzung abstimmen.');
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (me.pendingDraw) return fail('Wähle zuerst eine der beiden Karten.');
    if (me.pendingHit) return fail('Bitte zuerst die Anlege-Position wählen.');
    if (!me.hasDrawn) return fail('Erst ziehen.');
    if (!me.laidThisRound) return fail('Du musst zuerst deine eigene Phase auslegen.');
    const target = room.players.find(p => p.id === targetId);
    if (!target || !target.laidGroups[groupIndex]) return fail('Ziel-Auslage nicht gefunden.');

    const handById = new Map(me.hand.map(c => [c.id, c]));
    const cards = [];
    for (const id of cardIds) {
      if (!handById.has(id)) return fail('Karte nicht auf der Hand.');
      cards.push(handById.get(id));
    }
    if (cards.length === 0) return fail('Keine Karten gewählt.');

    const group = target.laidGroups[groupIndex];
    if (!G.canHit(group, cards)) return fail('Karten passen nicht an diese Auslage.');
    // Rauskommen per Anlegen (letzte Karte) beendet die Runde. Ist Rauskommen in
    // Runde 1 deaktiviert, muss man genug behalten, um noch ablegen zu können.
    if (round1BlocksOut(room) && me.hand.length - cards.length < 2) {
      return fail('In diesem Raum ist Rauskommen in der ersten Runde deaktiviert – du musst genug Karten behalten.');
    }

    // Folgen (run/colorrun): richtige Position bestimmen; bei mehreren Möglichkeiten fragen.
    if (group.type === 'run' || group.type === 'colorrun') {
      const arr = G.runArrangements(group.cards.concat(cards));
      if (arr.length > 1) {
        me.pendingHit = { targetId, groupIndex, cardIds: cards.map(c => c.id) };
        socket.emit('chooseHitPlacement', { options: arr.map(a => a.seq) });
        return; // erst nach Auswahl anwenden
      }
      return finishHit(room, me, target, group, cards, arr.length ? arr[0].seq : group.cards.concat(cards));
    }
    finishHit(room, me, target, group, cards, group.cards.concat(cards));
  });

  // Anlege-Position gewählt (bei mehrdeutiger Joker-Platzierung)
  socket.on('placeHit', ({ choiceIndex }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    const me = currentPlayer(room);
    if (me.id !== selfId || !me.pendingHit) return;
    const ph = me.pendingHit;
    const target = room.players.find(p => p.id === ph.targetId);
    if (!target || !target.laidGroups[ph.groupIndex]) { me.pendingHit = null; return; }
    const handById = new Map(me.hand.map(c => [c.id, c]));
    const cards = [];
    for (const id of ph.cardIds) {
      if (!handById.has(id)) { me.pendingHit = null; return fail('Karte nicht mehr auf der Hand.'); }
      cards.push(handById.get(id));
    }
    const group = target.laidGroups[ph.groupIndex];
    const arr = G.runArrangements(group.cards.concat(cards));
    const seq = (arr[choiceIndex] && arr[choiceIndex].seq) || (arr[0] && arr[0].seq) || group.cards.concat(cards);
    me.pendingHit = null;
    finishHit(room, me, target, group, cards, seq);
  });

  // ---- Admin: Zug rückgängig machen (mit Zustimmung aller) ----
  socket.on('requestUndo', () => {
    const room = joinedRoom;
    if (!room || !room.started) return;
    if (room.hostId !== selfId) return fail('Nur der Admin kann das.');
    if (room.roundOver || room.gameOver) return fail('Aktuell nichts zum Zurücksetzen.');
    if (room.give5) return fail('Bitte zuerst „Give me Five!" abschließen.');
    if (room.undoVote) return fail('Bitte zuerst über die Zug-Rücksetzung abstimmen.');
    if (room.undoVote) return fail('Es läuft bereits eine Abstimmung.');
    const info = undoTargetInfo(room);
    if (!info) return fail('Kein Zug zum Zurücksetzen vorhanden.');
    room.undoVote = {
      by: selfId, targetId: info.snap.ownerId, targetName: info.snap.ownerName,
      snap: info.snap, keepLen: info.keepLen, approvals: [selfId], // Admin stimmt automatisch zu
    };
    tryFinishUndo(room); // falls Admin allein (nur 1 verbundener Spieler)
    broadcast(room);
  });
  socket.on('undoVoteResponse', ({ approve }) => {
    const room = joinedRoom;
    const v = room && room.undoVote;
    if (!v) return;
    if (!room.players.some(p => p.id === selfId)) return; // nur Mitspieler stimmen ab
    if (!approve) {
      const who = room.players.find(p => p.id === selfId);
      room.undoVote = null;
      room.lastAction = `${who ? who.name : 'Ein Spieler'} hat die Zug-Rücksetzung abgelehnt.`;
      broadcast(room);
      return;
    }
    if (!v.approvals.includes(selfId)) v.approvals.push(selfId);
    tryFinishUndo(room);
    broadcast(room);
  });
  socket.on('cancelUndo', () => {
    const room = joinedRoom;
    if (!room || !room.undoVote) return;
    if (room.hostId !== selfId) return;
    room.undoVote = null;
    broadcast(room);
  });

  socket.on('discard', ({ cardId }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    if (room.give5) return fail('Bitte zuerst „Give me Five!" abschließen.');
    if (room.undoVote) return fail('Bitte zuerst über die Zug-Rücksetzung abstimmen.');
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (me.pendingDraw) return fail('Wähle zuerst eine der beiden Karten.');
    if (!me.hasDrawn) return fail('Erst ziehen, dann ablegen.');
    const idx = me.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return fail('Karte nicht auf der Hand.');
    const card = me.hand[idx];
    if (G.isAction(card)) return fail('Aktionskarten werden gespielt, nicht abgelegt.');
    if (me.hand.length === 1 && round1BlocksOut(room)) return fail('In diesem Raum ist Rauskommen in der ersten Runde deaktiviert.');

    me.hand.splice(idx, 1);
    room.discard.push(card);
    me.hasDrawn = false;

    if (me.hand.length === 0) {
      endRound(room, me);
      broadcast(room);
      return;
    }
    room.lastAction = `${me.name} hat abgelegt.`;
    advanceTurn(room);
    broadcast(room);
  });

  // ---- Aktionskarte verfallen lassen (statt spielen) ----
  socket.on('discardAction', ({ cardId }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    if (room.give5) return fail('Bitte zuerst „Give me Five!" abschließen.');
    if (room.undoVote) return fail('Bitte zuerst über die Zug-Rücksetzung abstimmen.');
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (me.pendingDraw) return fail('Wähle zuerst eine der beiden Karten.');
    if (!me.hasDrawn) return fail('Erst ziehen.');
    const idx = me.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return fail('Karte nicht auf der Hand.');
    const card = me.hand[idx];
    if (!G.isAction(card)) return fail('Das ist keine Aktionskarte.');
    if (me.hand.length === 1 && round1BlocksOut(room)) return fail('In diesem Raum ist Rauskommen in der ersten Runde deaktiviert.');

    const label = { skip: 'Aussetzen', draw2: 'Nimm zwei', keepall: 'Behalten', give5: 'Give me Five' }[card.value] || 'Aktion';
    me.hand.splice(idx, 1);
    me.hasDrawn = false;
    if (me.hand.length === 0) { endRound(room, me); broadcast(room); return; }
    room.lastAction = `${me.name} lässt „${label}" verfallen.`;
    io.to(room.code).emit('info', room.lastAction); // für alle sichtbar
    advanceTurn(room);
    broadcast(room);
  });

  // ---- Aktionskarte spielen (statt Ablegen) ----
  socket.on('playAction', ({ cardId, targetId }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    if (room.give5) return fail('Bitte zuerst „Give me Five!" abschließen.');
    if (room.undoVote) return fail('Bitte zuerst über die Zug-Rücksetzung abstimmen.');
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (me.pendingDraw) return fail('Wähle zuerst eine der beiden Karten.');
    if (!me.hasDrawn) return fail('Erst ziehen.');
    const idx = me.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return fail('Karte nicht auf der Hand.');
    const card = me.hand[idx];
    if (!G.isAction(card)) return fail('Das ist keine Aktionskarte.');

    // Letzte Handkarte: wirkungslos gespielt, Durchgang endet.
    const isLast = me.hand.length === 1;
    if (isLast && round1BlocksOut(room)) return fail('In diesem Raum ist Rauskommen in der ersten Runde deaktiviert.');
    me.hand.splice(idx, 1);

    if (isLast) {
      endRound(room, me);
      broadcast(room);
      return;
    }

    if (card.value === 'skip') {
      const target = room.players.find(p => p.id === targetId && p.id !== me.id);
      if (!target) { me.hand.splice(idx, 0, card); return fail('Wähle einen Spieler, der aussetzen soll.'); }
      room.skipTargets.add(target.id);
      room.lastAction = `${me.name} lässt ${target.name} aussetzen!`;
      if (target.socketId) io.to(target.socketId).emit('skipNotice', { by: me.name });
      me.hasDrawn = false; advanceTurn(room); broadcast(room);
    } else if (card.value === 'draw2') {
      me.draw2 = true; // ab jetzt 2 ziehen, 1 behalten
      room.lastAction = `${me.name} spielt „Nimm zwei!".`;
      me.hasDrawn = false; advanceTurn(room); broadcast(room);
    } else if (card.value === 'keepall') {
      me.keepAll = true; // am Rundenende Handkarten behalten
      room.lastAction = `${me.name} spielt „Behalten".`;
      me.hasDrawn = false; advanceTurn(room); broadcast(room);
    } else if (card.value === 'give5') {
      startGive5(room, me);
      broadcast(room);
    }
  });

  // ---- Give me Five!: Mitspieler bieten Karten an ----
  socket.on('offerCard', ({ cardId }) => {
    const room = joinedRoom;
    const g = room && room.give5;
    if (!g || g.phase !== 'collecting') return;
    if (g.currentId !== selfId) return fail('Du bist gerade nicht dran.');
    const me = room.players.find(p => p.id === selfId);
    const idx = me.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return fail('Karte nicht auf der Hand.');
    const card = me.hand.splice(idx, 1)[0];
    g.offers.push({ playerId: me.id, card });
    advanceGive5(room);
    broadcast(room);
  });

  // ---- Give me Five!: ausspielender Spieler nimmt eine Karte ----
  socket.on('pickOffered', ({ cardId }) => {
    const room = joinedRoom;
    const g = room && room.give5;
    if (!g || g.phase !== 'picking') return;
    if (g.by !== selfId) return fail('Nur der ausspielende Spieler wählt.');
    const oi = g.offers.findIndex(o => o.card.id === cardId);
    if (oi === -1) return fail('Karte nicht im Angebot.');
    const asker = room.players.find(p => p.id === g.by);
    const chosen = g.offers[oi];
    asker.hand.push(chosen.card);
    // Besitzer sieht, welche Karte ihm genommen wurde, und erhält Ersatz vom Nachziehstapel
    const owner = room.players.find(p => p.id === chosen.playerId);
    if (owner) reveal(owner, chosen.card, `${asker.name} nimmt dir diese Karte:`);
    replenishDeckIfNeeded(room);
    if (owner && room.deck.length) owner.hand.push(room.deck.shift());
    // restliche angebotene Karten zurück auf die Hand
    g.offers.forEach((o, i) => {
      if (i === oi) return;
      const pl = room.players.find(p => p.id === o.playerId);
      if (pl) pl.hand.push(o.card);
    });
    room.give5 = null;
    room.lastAction = `${asker.name} hat sich eine Karte genommen (Give me Five!).`;
    // Der Zug des ausspielenden Spielers endet (ohne Ablegen).
    asker.hasDrawn = false;
    advanceTurn(room);
    broadcast(room);
  });

  socket.on('leaveRoom', () => {
    const room = joinedRoom;
    if (!room) return;
    // Zuschauer, der geht
    if (room.spectators) room.spectators = room.spectators.filter(s => s.id !== selfId);
    const i = room.players.findIndex(pp => pp.id === selfId);
    if (i >= 0) {
      if (room.started) { room.players[i].connected = false; room.players[i].socketId = null; }
      else room.players.splice(i, 1);
    }
    // Host ggf. weiterreichen
    if (room.hostId === selfId) {
      const next = room.players.find(pp => pp.connected) || room.players[0];
      if (next) room.hostId = next.id;
    }
    socket.leave(room.code);
    if (room.players.length === 0 && (!room.spectators || room.spectators.length === 0)) { rooms.delete(room.code); removePersisted(room.code); }
    else broadcast(room);
    joinedRoom = null;
  });

  socket.on('disconnect', () => {
    const room = joinedRoom;
    if (!room) return;
    // Zuschauer entfernen (nur diesen Socket)
    if (room.spectators) {
      const si = room.spectators.findIndex(s => s.id === selfId && s.socketId === socket.id);
      if (si >= 0) room.spectators.splice(si, 1);
    }
    const p = room.players.find(pp => pp.id === selfId);
    // WICHTIG: nur trennen, wenn dieser Socket noch der aktuelle ist. Sonst würde
    // ein verspäteter Disconnect des alten Sockets eine frische Wiederverbindung
    // überschreiben (Folge: Spieler scheinbar offline, kann nicht mehr ziehen).
    if (p && p.socketId === socket.id) {
      p.connected = false; p.socketId = null;
      // Host bei Verbindungsverlust an einen verbundenen Spieler übergeben,
      // damit die anderen normal weiterspielen können.
      if (room.hostId === p.id) {
        const next = room.players.find(pp => pp.connected);
        if (next) room.hostId = next.id;
      }
    }
    // Räume bleiben offen (auch wenn der Host geht); Aufräumen erst per Zeitablauf.
    if (room.players.every(pp => !pp.connected)) room.emptySince = Date.now();
    broadcast(room);
  });
});

// Verwaiste Räume aufräumen: Raum entfernen, wenn seit 30 Min. niemand mehr verbunden ist.
const EMPTY_TTL = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.some(pp => pp.connected)) { room.emptySince = null; continue; }
    if (!room.emptySince) room.emptySince = now;
    else if (now - room.emptySince > EMPTY_TTL) { rooms.delete(code); removePersisted(code); }
  }
}, 60 * 1000);

// Keep-Alive: verhindert, dass der (kostenlose) Render-Dienst nach Inaktivität
// schläft und dabei alle laufenden Räume verliert ("Raum nicht gefunden").
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
if (SELF_URL && typeof fetch === 'function') {
  setInterval(() => { fetch(SELF_URL + '/health').catch(() => {}); }, 10 * 60 * 1000);
}

// Beim Start: Tabelle anlegen und gespeicherte Räume laden (überleben Neustarts).
(async () => {
  try {
    await store.init();
    if (store.enabled) {
      const saved = await store.loadAll();
      for (const d of saved) {
        try { const room = deserializeRoom(d); rooms.set(room.code, room); } catch (e) { /* defekten Datensatz überspringen */ }
      }
      console.log(`  Persistenz: aktiv (Postgres), ${rooms.size} Raum/Räume geladen.`);
    } else {
      console.log('  Persistenz: aus (kein DATABASE_URL) – Räume nur im Speicher.');
    }
  } catch (e) {
    console.log('  Persistenz-Fehler beim Start (läuft im Speicher weiter):', e.message);
  }
})();

// Vor dem Neustart (Render sendet SIGTERM): alle Räume schnell sichern.
async function flushAndExit() {
  try {
    if (store.enabled) for (const [code, room] of rooms) await store.save(code, serializeRoom(room));
  } catch (e) { /* ignorieren */ }
  process.exit(0);
}
process.on('SIGTERM', flushAndExit);
process.on('SIGINT', flushAndExit);

server.listen(PORT, () => {
  console.log(`\n  Phase 10 läuft auf:  http://localhost:${PORT}`);
  console.log(`  Andere im gleichen WLAN nutzen deine lokale IP, z.B. http://192.168.x.x:${PORT}\n`);
});
