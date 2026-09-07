// ============================================================
//  Knister – eigenständiges Multiplayer-Würfel-Schreibspiel
//  (komplett unabhängig von der Phase-10-Logik)
//  Regeln: 5x5-Raster, 25 Runden. Jede Runde werden 2 Würfel geworfen
//  (Summe 2–12, gilt für ALLE). Jeder trägt die Zahl in ein freies Feld ein.
//  Wertung je Zeile/Spalte + beide Diagonalen (x2):
//    Paar 1 · Zwei Paare 3 · Drilling 3 · Vierling 6 · Fünfling 10
//    Full House 8 · Straße mit 7 = 8 · Straße ohne 7 = 12
// ============================================================
function registerKnister(io) {
  const rooms = new Map();

  function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c;
    do { c = ''; for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)]; } while (rooms.has(c));
    return c;
  }
  const roll = () => (1 + Math.floor(Math.random() * 6)) + (1 + Math.floor(Math.random() * 6));

  // Punkte einer 5er-Linie (Zeile/Spalte/Diagonale)
  function lineScore(cells) {
    if (cells.some(c => c == null)) return 0;
    const counts = {};
    cells.forEach(n => (counts[n] = (counts[n] || 0) + 1));
    const sig = Object.values(counts).sort((a, b) => b - a).join(',');
    if (sig === '5') return 10;                 // Fünfling
    if (sig === '4,1') return 6;                // Vierling
    if (sig === '3,2') return 8;                // Full House
    if (sig === '3,1,1') return 3;              // Drilling
    if (sig === '2,2,1') return 3;              // Zwei Paare
    if (sig === '2,1,1,1') return 1;            // Ein Paar
    if (sig === '1,1,1,1,1') {                  // evtl. Straße
      const s = [...cells].sort((a, b) => a - b);
      let consec = true;
      for (let i = 1; i < 5; i++) if (s[i] !== s[i - 1] + 1) consec = false;
      if (consec) return cells.includes(7) ? 8 : 12; // Straße mit 7 = 8, ohne 7 = 12
    }
    return 0;
  }
  function scoreGrid(grid) {
    const g = (r, c) => grid[r * 5 + c];
    const lines = [];
    for (let r = 0; r < 5; r++) lines.push({ cells: [0, 1, 2, 3, 4].map(c => g(r, c)), mult: 1 });
    for (let c = 0; c < 5; c++) lines.push({ cells: [0, 1, 2, 3, 4].map(r => g(r, c)), mult: 1 });
    lines.push({ cells: [0, 1, 2, 3, 4].map(i => g(i, i)), mult: 2 });      // Diagonale
    lines.push({ cells: [0, 1, 2, 3, 4].map(i => g(i, 4 - i)), mult: 2 });  // Gegendiagonale
    let total = 0;
    for (const ln of lines) total += lineScore(ln.cells) * ln.mult;
    return total;
  }

  function winnersOf(room) {
    const scored = room.players.map(p => ({ id: p.id, name: p.name, score: scoreGrid(p.grid) }));
    const max = Math.max(...scored.map(s => s.score));
    return scored.filter(s => s.score === max);
  }
  function playerPublic(room, p) {
    return {
      id: p.id, name: p.name, connected: p.connected,
      filled: p.grid.filter(x => x != null).length,
      placedThisRound: room.roundPlaced.has(p.id),
      score: scoreGrid(p.grid), // Zwischenstand (fertige Reihen zählen) – immer sichtbar
      grid: room.gameOver ? p.grid : null, // Grids der anderen erst am Ende offen
    };
  }
  function stateFor(room, playerId) {
    const me = room.players.find(p => p.id === playerId);
    return {
      code: room.code, hostId: room.hostId, isHost: room.hostId === playerId,
      started: room.started, gameOver: room.gameOver,
      round: room.round, totalRounds: 25, current: room.current,
      players: room.players.map(p => playerPublic(room, p)),
      myGrid: me ? p_grid(me) : null,
      myPlaced: me ? room.roundPlaced.has(me.id) : false,
      myScore: me ? scoreGrid(me.grid) : 0,
      winners: room.gameOver ? winnersOf(room) : null,
    };
  }
  const p_grid = (p) => p.grid.slice();

  function broadcast(room) {
    for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('k:state', stateFor(room, p.id));
  }
  function nextRound(room) {
    room.roundPlaced = new Set();
    if (room.round >= 25) { room.gameOver = true; room.current = null; return; }
    room.round += 1;
    room.current = roll();
  }
  function maybeAdvance(room) {
    const connected = room.players.filter(p => p.connected);
    if (connected.length && connected.every(p => room.roundPlaced.has(p.id))) nextRound(room);
  }
  function newPlayer(id, name, socketId) {
    return { id, name, socketId, connected: true, grid: Array(25).fill(null) };
  }

  io.on('connection', (socket) => {
    let joined = null, selfId = null;
    const fail = (m) => socket.emit('k:error', m);

    socket.on('k:createRoom', ({ name, playerId } = {}, cb) => {
      name = (name || '').trim().slice(0, 20) || 'Spieler';
      const code = makeCode();
      const room = { code, hostId: playerId, players: [], started: false, gameOver: false, round: 0, current: null, roundPlaced: new Set() };
      room.players.push(newPlayer(playerId, name, socket.id));
      rooms.set(code, room);
      joined = room; selfId = playerId;
      cb && cb({ ok: true, code });
      broadcast(room);
    });

    socket.on('k:joinRoom', ({ code, name, playerId } = {}, cb) => {
      code = (code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return cb && cb({ error: 'Raum nicht gefunden.' });
      name = (name || '').trim().slice(0, 20) || 'Spieler';
      let p = room.players.find(pp => pp.id === playerId);
      if (!p) {
        if (room.started) {
          const slot = room.players.find(pp => !pp.connected && pp.name.toLowerCase() === name.toLowerCase());
          if (slot) { slot.id = playerId; p = slot; }
          else return cb && cb({ error: 'Spiel läuft bereits – Wiedereinstieg nur mit gleichem Namen.' });
        } else {
          if (room.players.length >= 6) return cb && cb({ error: 'Raum ist voll (max. 6).' });
          p = newPlayer(playerId, name, socket.id);
          room.players.push(p);
        }
      }
      p.socketId = socket.id; p.connected = true;
      joined = room; selfId = playerId;
      cb && cb({ ok: true, code });
      broadcast(room);
    });

    socket.on('k:startGame', () => {
      const room = joined;
      if (!room || room.hostId !== selfId || room.started) return;
      if (room.players.length < 1) return fail('Mindestens 1 Spieler nötig.');
      room.started = true; room.gameOver = false;
      room.players.forEach(p => { p.grid = Array(25).fill(null); });
      room.round = 1; room.current = roll(); room.roundPlaced = new Set();
      broadcast(room);
    });

    socket.on('k:place', ({ cell } = {}) => {
      const room = joined;
      if (!room || !room.started || room.gameOver) return;
      const me = room.players.find(p => p.id === selfId);
      if (!me) return;
      if (room.roundPlaced.has(me.id)) return fail('Schon eingetragen – warte auf die Mitspieler.');
      if (typeof cell !== 'number' || cell < 0 || cell > 24) return;
      if (me.grid[cell] != null) return fail('Dieses Feld ist schon belegt.');
      me.grid[cell] = room.current;
      room.roundPlaced.add(me.id);
      maybeAdvance(room);
      broadcast(room);
    });

    socket.on('k:leaveRoom', () => {
      const room = joined;
      if (!room) return;
      const i = room.players.findIndex(p => p.id === selfId);
      if (i >= 0) {
        if (room.started) { room.players[i].connected = false; room.players[i].socketId = null; }
        else room.players.splice(i, 1);
      }
      if (room.hostId === selfId) { const n = room.players.find(p => p.connected) || room.players[0]; if (n) room.hostId = n.id; }
      if (!room.players.length) rooms.delete(room.code);
      else { maybeAdvance(room); broadcast(room); }
      joined = null;
    });

    socket.on('disconnect', () => {
      const room = joined;
      if (!room) return;
      const p = room.players.find(pp => pp.id === selfId && pp.socketId === socket.id);
      if (!p) return;
      p.connected = false; p.socketId = null;
      if (room.hostId === p.id) { const n = room.players.find(x => x.connected); if (n) room.hostId = n.id; }
      maybeAdvance(room);
      broadcast(room);
    });
  });
}

module.exports = registerKnister;
