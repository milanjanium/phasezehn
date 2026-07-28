// ============================================================
//  Phase 10 – Online Multiplayer Server
// ============================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const G = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
    finishedGame: false,
  };
}

// ---- State-Serialisierung für die Clients ----
function playerPublic(p) {
  return {
    id: p.id, name: p.name, connected: p.connected,
    handCount: p.hand.length,
    phase: p.phase,
    laidGroups: p.laidGroups,
    laidThisRound: p.laidThisRound,
    score: p.score,
    finishedGame: p.finishedGame,
  };
}

function stateFor(room, playerId) {
  const players = room.players.map(playerPublic);
  const me = room.players.find(p => p.id === playerId);
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    roundOver: room.roundOver,
    gameOver: room.gameOver,
    winners: room.winners || null,
    players,
    phases: G.PHASES,
    discardTop: room.discard.length ? room.discard[room.discard.length - 1] : null,
    drawCount: room.deck.length,
    turnPlayerId: room.started && !room.roundOver ? room.players[room.turnIndex].id : null,
    myHand: me ? me.hand : [],
    myPhaseIndex: me ? me.phase : 0,
    myHasDrawn: me ? me.hasDrawn : false,
    myLaidThisRound: me ? me.laidThisRound : false,
    lastAction: room.lastAction || null,
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, p.id));
  }
}

function currentPlayer(room) { return room.players[room.turnIndex]; }

// ---- Runde starten / austeilen ----
function startRound(room) {
  const deck = G.shuffle(G.buildDeck());
  for (const p of room.players) {
    p.hand = deck.splice(0, 10);
    p.laidGroups = [];
    p.laidThisRound = false;
    p.completedPhase = false;
    p.hasDrawn = false;
  }
  // Erste Ablagekarte (keine Aussetzen-Karte als Startkarte)
  let top = deck.shift();
  while (G.isSkip(top)) { deck.push(top); G.shuffle(deck); top = deck.shift(); }
  room.deck = deck;
  room.discard = [top];
  room.skipTargets = new Set();
  room.roundOver = false;
  room.lastAction = null;

  // Startspieler rotiert pro Runde
  room.turnIndex = room.dealerIndex % room.players.length;
  room.players[room.turnIndex].hasDrawn = false;
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
  let idx = room.turnIndex;
  for (let step = 0; step < n * 2; step++) {
    idx = (idx + 1) % n;
    const p = room.players[idx];
    if (room.skipTargets.has(p.id)) {
      room.skipTargets.delete(p.id);
      continue; // dieser Spieler setzt aus
    }
    break;
  }
  room.turnIndex = idx;
  room.players[idx].hasDrawn = false;
}

// ---- Rundenende & Wertung ----
function endRound(room, goneOutPlayer) {
  room.roundOver = true;
  for (const p of room.players) {
    // Restpunkte aufaddieren
    for (const c of p.hand) p.score += G.cardPoints(c);
    // Wer seine Phase geschafft hat, rückt vor
    if (p.completedPhase) {
      if (p.phase === G.PHASES.length - 1) {
        p.finishedGame = true; // Phase 10 geschafft
      }
      p.phase = Math.min(p.phase + 1, G.PHASES.length - 1);
    }
  }
  room.lastAction = `${goneOutPlayer.name} hat die Runde beendet!`;

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
      skipTargets: new Set(), roundOver: false, gameOver: false, winners: null,
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

  socket.on('joinRoom', ({ code, name, playerId }, cb) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Raum nicht gefunden.' });
    let p = room.players.find(pp => pp.id === playerId);
    if (p) {
      // Reconnect
      p.socketId = socket.id; p.connected = true;
    } else {
      if (room.started) return cb && cb({ error: 'Spiel läuft bereits.' });
      if (room.players.length >= 6) return cb && cb({ error: 'Raum ist voll (max. 6).' });
      name = (name || '').trim().slice(0, 20) || 'Spieler';
      p = makePlayer(playerId, name);
      p.socketId = socket.id;
      room.players.push(p);
    }
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
    for (const p of room.players) { p.phase = 0; p.score = 0; p.finishedGame = false; }
    startRound(room);
    broadcast(room);
  });

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
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (me.hasDrawn) return fail('Du hast bereits gezogen.');
    if (source === 'discard') {
      const top = room.discard[room.discard.length - 1];
      if (!top) return fail('Ablagestapel ist leer.');
      if (G.isSkip(top)) return fail('Aussetzen-Karten dürfen nicht aufgenommen werden.');
      me.hand.push(room.discard.pop());
    } else {
      replenishDeckIfNeeded(room);
      if (room.deck.length === 0) return fail('Keine Karten mehr.');
      me.hand.push(room.deck.shift());
    }
    me.hasDrawn = true;
    room.lastAction = `${me.name} hat eine Karte gezogen.`;
    broadcast(room);
  });

  socket.on('layPhase', ({ groups }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
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

    // Übernehmen
    const phaseDef = G.PHASES[me.phase];
    me.laidGroups = cardGroups.map((cards, i) => ({
      type: phaseDef.groups[i].type,
      count: phaseDef.groups[i].count,
      cards,
      owner: me.id,
    }));
    me.hand = me.hand.filter(c => !usedIds.has(c.id));
    me.laidThisRound = true;
    me.completedPhase = true;
    room.lastAction = `${me.name} hat Phase ${me.phase + 1} ausgelegt!`;
    broadcast(room);
  });

  socket.on('hit', ({ targetId, groupIndex, cardIds }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
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
    if (me.hand.length - cards.length < 1) return fail('Du musst eine Karte zum Ablegen behalten.');

    const group = target.laidGroups[groupIndex];
    if (!G.canHit(group, cards)) return fail('Karten passen nicht an diese Auslage.');
    group.cards = group.cards.concat(cards);
    const usedIds = new Set(cards.map(c => c.id));
    me.hand = me.hand.filter(c => !usedIds.has(c.id));
    room.lastAction = `${me.name} hat angelegt.`;
    broadcast(room);
  });

  socket.on('discard', ({ cardId, skipTargetId }) => {
    const room = joinedRoom;
    if (!room || !room.started || room.roundOver) return;
    const me = currentPlayer(room);
    if (me.id !== selfId) return fail('Du bist nicht am Zug.');
    if (!me.hasDrawn) return fail('Erst ziehen, dann ablegen.');
    const idx = me.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return fail('Karte nicht auf der Hand.');
    const card = me.hand[idx];

    if (G.isSkip(card)) {
      const valid = room.players.filter(p => p.id !== me.id);
      if (!skipTargetId || !valid.find(p => p.id === skipTargetId)) {
        return fail('Wähle einen Spieler, der aussetzen soll.');
      }
      room.skipTargets.add(skipTargetId);
    }

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

  socket.on('leaveRoom', () => {
    const room = joinedRoom;
    if (!room) return;
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
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcast(room);
    joinedRoom = null;
  });

  socket.on('disconnect', () => {
    const room = joinedRoom;
    if (!room) return;
    const p = room.players.find(pp => pp.id === selfId);
    if (p) { p.connected = false; p.socketId = null; }
    // Räume werden NICHT sofort gelöscht – kurze Verbindungsabbrüche
    // (Tab-Wechsel, Handy-Sperre, Netz-Wackler) sollen den Raum nicht killen.
    // Verwaiste Räume werden per Zeitablauf aufgeräumt (siehe unten).
    if (room.players.every(pp => !pp.connected)) room.emptySince = Date.now();
    broadcast(room);
  });
});

// Verwaiste Räume aufräumen: Raum entfernen, wenn seit 20 Min. niemand mehr verbunden ist.
const EMPTY_TTL = 20 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.some(pp => pp.connected)) { room.emptySince = null; continue; }
    if (!room.emptySince) room.emptySince = now;
    else if (now - room.emptySince > EMPTY_TTL) rooms.delete(code);
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`\n  Phase 10 läuft auf:  http://localhost:${PORT}`);
  console.log(`  Andere im gleichen WLAN nutzen deine lokale IP, z.B. http://192.168.x.x:${PORT}\n`);
});
