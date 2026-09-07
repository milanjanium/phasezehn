// ============================================================
//  Knister – Client (eigenständig, nutzt denselben Socket wie client.js)
// ============================================================
(function () {
  const socket = window.socket;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Geräte-ID/Name mit Phase 10 teilen (gleiches Gerät)
  let pid = localStorage.getItem('p10-id');
  if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 11); localStorage.setItem('p10-id', pid); }
  let name = localStorage.getItem('p10-name') || '';

  let kRoom = null;        // aktueller Raum (nur im Speicher – Neuladen startet frisch)
  let kState = null;
  let hasConnectedOnce = false;

  function kShow(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
    // Phase-10-Menü ausblenden (Knister hat eigene Steuerung)
    $('menu-btn') && $('menu-btn').classList.add('hidden');
    $('btn-score') && $('btn-score').classList.add('hidden');
  }
  function toastK(msg) {
    const t = $('k-toast'); if (!t) return;
    t.textContent = msg; t.classList.remove('hidden'); t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => { t.classList.remove('show'); t.classList.add('hidden'); }, 2600);
  }

  // ---------- Startseiten-Kachel & Login ----------
  $('btn-knister-play').onclick = () => { $('k-input-name').value = name; $('k-login-error').textContent = ''; kShow('screen-k-login'); };
  $('k-btn-back').onclick = () => kShow('screen-start');

  $('k-btn-create').onclick = () => {
    const n = $('k-input-name').value.trim();
    if (!n) return ($('k-login-error').textContent = 'Bitte gib einen Namen ein.');
    if (!socket.connected) return ($('k-login-error').textContent = 'Verbindung wird noch hergestellt – gleich nochmal.');
    name = n; localStorage.setItem('p10-name', n); $('k-login-error').textContent = '';
    socket.emit('k:createRoom', { name: n, playerId: pid }, (res) => {
      if (!res || res.error) return ($('k-login-error').textContent = (res && res.error) || 'Fehler.');
      kRoom = res.code;
    });
  };
  $('k-btn-join').onclick = () => {
    const n = $('k-input-name').value.trim();
    const code = $('k-input-code').value.trim().toUpperCase();
    if (!n) return ($('k-login-error').textContent = 'Bitte gib einen Namen ein.');
    if (!code) return ($('k-login-error').textContent = 'Bitte gib einen Raum-Code ein.');
    if (!socket.connected) return ($('k-login-error').textContent = 'Verbindung wird noch hergestellt – gleich nochmal.');
    name = n; localStorage.setItem('p10-name', n); $('k-login-error').textContent = '';
    socket.emit('k:joinRoom', { code, name: n, playerId: pid }, (res) => {
      if (!res || res.error) return ($('k-login-error').textContent = (res && res.error) || 'Fehler.');
      kRoom = res.code;
    });
  };
  $('k-btn-start').onclick = () => socket.emit('k:startGame');
  const leaveToWorld = () => { socket.emit('k:leaveRoom'); kRoom = null; kState = null; kShow('screen-start'); };
  $('k-btn-leave-lobby').onclick = leaveToWorld;
  $('k-btn-leave').onclick = () => { if (confirm('Knister verlassen?')) leaveToWorld(); };

  // ---------- Socket ----------
  socket.on('k:error', (m) => toastK(m));
  socket.on('k:state', (s) => { kState = s; render(); });
  socket.on('connect', () => {
    if (hasConnectedOnce && kRoom && name) socket.emit('k:joinRoom', { code: kRoom, name, playerId: pid }, () => {});
    hasConnectedOnce = true;
  });

  // ---------- Rendern ----------
  function render() {
    const s = kState; if (!s) return;
    if (!s.started) { kShow('screen-k-lobby'); renderLobby(); return; }
    kShow('screen-k-game'); renderGame();
    if (s.gameOver) renderResult(); else $('k-result').classList.add('hidden');
  }

  function renderLobby() {
    const s = kState;
    $('k-lobby-code').textContent = s.code;
    const ul = $('k-lobby-players'); ul.innerHTML = '';
    s.players.forEach((p) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot ${p.connected ? '' : 'off'}"></span><span>${esc(p.name)}</span>` +
        (p.id === s.hostId ? '<span class="host-tag">Host</span>' : '');
      ul.appendChild(li);
    });
    $('k-btn-start').style.display = s.isHost ? 'block' : 'none';
    $('k-btn-start').disabled = s.players.length < 1;
    $('k-lobby-hint').textContent = s.isHost
      ? `${s.players.length} Spieler dabei – jederzeit startbar (auch solo).`
      : 'Warte auf den Host …';
  }

  function renderGame() {
    const s = kState;
    $('k-room-badge').textContent = 'Raum ' + s.code;
    $('k-round').textContent = Math.min(s.round, s.totalRounds);
    $('k-current-num').textContent = s.current != null ? s.current : '–';
    const canPlace = !s.gameOver && !s.myPlaced && s.current != null;
    $('k-place-hint').textContent = s.gameOver
      ? 'Alle Felder voll – Auswertung.'
      : (s.myPlaced ? 'Eingetragen – warte auf die Mitspieler …' : `Tippe ein freies Feld für die ${s.current}.`);

    const grid = $('k-grid'); grid.innerHTML = '';
    const g = s.myGrid || Array(25).fill(null);
    g.forEach((v, i) => {
      const cell = document.createElement('button');
      cell.className = 'k-cell' + (v != null ? ' filled' : '') + (canPlace && v == null ? ' open' : '');
      cell.textContent = v != null ? v : '';
      if (canPlace && v == null) cell.onclick = () => socket.emit('k:place', { cell: i });
      grid.appendChild(cell);
    });

    $('k-myscore').textContent = `Deine Punkte (fertige Reihen): ${s.myScore}`;

    const pl = $('k-players'); pl.innerHTML = '';
    s.players.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'k-player' + (p.placedThisRound ? ' done' : '') + (p.id === pid ? ' me' : '');
      d.innerHTML = `<span class="dot ${p.connected ? '' : 'off'}"></span><span class="k-pname">${esc(p.name)}</span>` +
        `<span class="k-fill">${p.filled}/25</span>` +
        (s.gameOver ? '' : (p.placedThisRound ? '<span class="k-check">✓</span>' : '<span class="k-wait">…</span>'));
      pl.appendChild(d);
    });
  }

  function renderResult() {
    const s = kState;
    const box = $('k-result'); box.classList.remove('hidden');
    const sorted = [...s.players].map((p) => ({ name: p.name, score: p.score || 0 })).sort((a, b) => b.score - a.score);
    const winnerNames = (s.winners || []).map((w) => w.name).join(', ');
    let html = '<div class="overlay-box k-result-box"><h2>🏆 Ergebnis</h2>' +
      `<p class="k-winner">${esc(winnerNames)} gewinnt!</p><div class="k-scores">`;
    sorted.forEach((p, i) => {
      html += `<div class="k-score-row"><span>${i + 1}. ${esc(p.name)}</span><span class="k-score-pts">${p.score}</span></div>`;
    });
    html += '</div><div class="overlay-actions"><button class="btn primary" id="k-result-leave">Zur Spielwelt</button></div></div>';
    box.innerHTML = html;
    $('k-result-leave').onclick = leaveToWorld;
  }
})();
