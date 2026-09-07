// ============================================================
//  Knister – Client (eigenständig, nutzt denselben Socket wie client.js)
// ============================================================
(function () {
  const socket = window.socket;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Punkte einer 5er-Linie (gleiche Logik wie Server) – für die Rand-Punktefelder
  function lineScore(cells) {
    if (cells.some((c) => c == null)) return 0;
    const counts = {}; cells.forEach((n) => (counts[n] = (counts[n] || 0) + 1));
    const sig = Object.values(counts).sort((a, b) => b - a).join(',');
    if (sig === '5') return 10;
    if (sig === '4,1') return 6;
    if (sig === '3,2') return 8;
    if (sig === '3,1,1') return 3;
    if (sig === '2,2,1') return 3;
    if (sig === '2,1,1,1') return 1;
    if (sig === '1,1,1,1,1') {
      const s = [...cells].sort((a, b) => a - b); let ok = true;
      for (let i = 1; i < 5; i++) if (s[i] !== s[i - 1] + 1) ok = false;
      if (ok) return cells.includes(7) ? 8 : 12;
    }
    return 0;
  }
  const lineFull = (cells) => cells.every((c) => c != null);

  // Geräte-ID/Name mit Phase 10 teilen (gleiches Gerät)
  let pid = localStorage.getItem('p10-id');
  if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 11); localStorage.setItem('p10-id', pid); }
  let name = localStorage.getItem('p10-name') || '';

  let kRoom = null;        // aktueller Raum (nur im Speicher – Neuladen startet frisch)
  let kState = null;
  let hasConnectedOnce = false;
  let lastRolledRound = 0;  // für die Würfelanimation (nur bei neuem Wurf auslösen)

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

  // ---------- Info-Popup: Punktestand + Wertung ----------
  let infoTab = 'stand';
  $('k-btn-info').onclick = () => { infoTab = 'stand'; renderInfo(); $('k-info').classList.remove('hidden'); };
  function renderInfo() {
    const box = $('k-info');
    box.innerHTML =
      '<div class="overlay-box k-info-box">' +
        '<div class="k-tabs">' +
          `<button class="k-tab${infoTab === 'stand' ? ' active' : ''}" data-t="stand">Punktestand</button>` +
          `<button class="k-tab${infoTab === 'wert' ? ' active' : ''}" data-t="wert">Wertung</button>` +
        '</div>' +
        '<div id="k-tab-body" class="k-tab-body"></div>' +
        '<div class="overlay-actions"><button class="btn" id="k-info-close">Schließen</button></div>' +
      '</div>';
    box.querySelectorAll('.k-tab').forEach((t) => (t.onclick = () => { infoTab = t.dataset.t; renderInfo(); }));
    $('k-info-close').onclick = () => box.classList.add('hidden');
    $('k-tab-body').innerHTML = infoTab === 'stand' ? standHtml() : wertHtml();
  }
  function standHtml() {
    const s = kState; if (!s) return '';
    const sorted = [...s.players].map((p) => ({ name: p.name, score: p.score || 0 })).sort((a, b) => b.score - a.score);
    let h = '<div class="k-scores">';
    sorted.forEach((p, i) => { h += `<div class="k-score-row"><span>${i + 1}. ${esc(p.name)}</span><span class="k-score-pts">${p.score}</span></div>`; });
    h += '</div><p class="hint" style="text-align:center">Zwischenstand – nur volle Reihen zählen.</p>';
    return h;
  }
  function wertHtml() {
    const rows = [
      ['Ein Paar', '1'], ['Zwei Paare', '3'], ['Drilling', '3'], ['Vierling', '6'],
      ['Fünfling', '10'], ['Full House', '8'], ['Straße mit 7', '8'], ['Straße ohne 7', '12'],
    ];
    let h = '<div class="k-wert">';
    rows.forEach((r) => { h += `<div class="k-wert-row"><span>${r[0]}</span><span class="k-wert-pts">${r[1]}</span></div>`; });
    h += '</div><p class="hint" style="text-align:center">Die beiden Diagonalen zählen doppelt.</p>';
    return h;
  }

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
    if (!s.started || s.gameOver) lastRolledRound = 0;
    if (!s.started) { kShow('screen-k-lobby'); renderLobby(); return; }
    kShow('screen-k-game'); renderGame();
    // Neuer Wurf? -> Würfelanimation + blasse Vollbild-Zahl
    if (!s.gameOver && s.current != null && s.round !== lastRolledRound) {
      lastRolledRound = s.round;
      animateRoll(s.current);
    }
    if (s.gameOver) renderResult(); else $('k-result').classList.add('hidden');
  }

  function animateRoll(num) {
    const die = $('k-current-num');
    if (die) { die.classList.remove('rolling'); void die.offsetWidth; die.classList.add('rolling'); }
    const fx = $('k-rollfx');
    if (fx) { fx.textContent = num; fx.classList.remove('show'); void fx.offsetWidth; fx.classList.add('show'); }
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

    // 6x6-Raster: 5x5 Zahlenfelder + 11 Punktefelder am Rand (5 Zeilen rechts,
    // 5 Spalten unten, 1 Diagonalen-Feld in der Ecke). Diagonalen zählen doppelt.
    const grid = $('k-grid'); grid.innerHTML = '';
    const g = s.myGrid || Array(25).fill(null);
    const at = (r, c) => g[r * 5 + c];
    const rowC = (r) => [0, 1, 2, 3, 4].map((c) => at(r, c));
    const colC = (c) => [0, 1, 2, 3, 4].map((r) => at(r, c));
    const md = [0, 1, 2, 3, 4].map((i) => at(i, i));
    const ad = [0, 1, 2, 3, 4].map((i) => at(i, 4 - i));
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (r < 5 && c < 5) {
          const i = r * 5 + c, v = g[i], isDiag = (r === c) || (r === 4 - c);
          const cell = document.createElement('button');
          cell.className = 'k-cell' + (v != null ? ' filled' : '') + (canPlace && v == null ? ' open' : '') + (isDiag ? ' diag' : '');
          cell.textContent = v != null ? v : '';
          if (canPlace && v == null) cell.onclick = () => socket.emit('k:place', { cell: i });
          grid.appendChild(cell);
        } else if (r < 5 && c === 5) {
          const b = document.createElement('div'); b.className = 'k-score-box';
          b.textContent = lineFull(rowC(r)) ? String(lineScore(rowC(r))) : '';
          grid.appendChild(b);
        } else if (r === 5 && c < 5) {
          const b = document.createElement('div'); b.className = 'k-score-box';
          b.textContent = lineFull(colC(c)) ? String(lineScore(colC(c))) : '';
          grid.appendChild(b);
        } else {
          // Ecke: je ein Punktefeld für BEIDE Diagonalen (x2) -> 12 Felder insgesamt
          const corner = document.createElement('div'); corner.className = 'k-diag-corner';
          [md, ad].forEach((cells) => {
            const b = document.createElement('div'); b.className = 'k-score-box diag';
            b.textContent = lineFull(cells) ? String(lineScore(cells) * 2) : '';
            corner.appendChild(b);
          });
          grid.appendChild(corner);
        }
      }
    }

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
