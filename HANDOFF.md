# Phase 10 Master – Projekt-Übergabe (Chat-Fortsetzung)

Dieses Dokument fasst den kompletten Stand zusammen, damit die Arbeit in einer
neuen Session nahtlos weitergeht. Einfach in den neuen Chat kopieren/anhängen.

## Was das ist
Ein **Online-Multiplayer-Kartenspiel „Phase 10 Master"** (Ravensburger-Variante).
Jeder spielt am eigenen Gerät, verbunden über einen 4-stelligen Raum-Code.
Echtzeit über WebSockets. Läuft lokal und auf Render (Gratis) deploybar.

## Wo alles liegt
- **Projektordner:** `/Users/milan/Documents/Claude Code/Phase 10`
- **GitHub (privat):** https://github.com/milanjanium/phasezehn  (Branch `main`)
- **Letzter Commit:** `e4138a7`
- **GitHub-Login:** `gh` ist als `milanjanium` angemeldet (Git-Identität im Repo:
  name `milanjanium`, email `milantausch111@gmail.com`).
- **Render-Deploy:** über `render.yaml` (Blueprint). Muss der Nutzer einmal selbst
  autorisieren (Render-Login + GitHub-Zugriff aufs private Repo).

## Technik / Dateien
- **Backend:** Node.js + Express + Socket.IO. Zustand im Speicher, optional in
  PostgreSQL persistiert.
- `server.js` – Server, Räume, alle Socket-Events, Rundenlogik, Persistenz-Anbindung.
- `game.js` – Spielregeln (Deck, Phasen, Validierung, Wertung). Exportiert
  `COLORS, PHASES, ACTIONS, buildDeck, shuffle, isJoker, isAction, isNumber,
  isSpecial, cardPoints, validatePhase, validGroup, canHit`.
- `store.js` – Persistenz. Nutzt `pg`, wenn `DATABASE_URL` gesetzt ist; sonst
  deaktiviert (rein im Speicher). Tabelle `rooms(code TEXT PK, data JSONB, updated_at)`.
- `public/index.html`, `public/client.js`, `public/style.css` – Oberfläche
  (Login, Lobby, Spielbrett), Vanilla HTML/CSS/JS. Socket.IO-Client wird von
  `/socket.io/socket.io.js` geladen.
- `package.json` (deps: express, pg, socket.io), `render.yaml`, `README.md`.

## Starten / Deployen
```bash
cd "Phase 10" && npm install && npm start   # http://localhost:3000
```
- Im gleichen WLAN: `http://<lokale-IP>:3000` (z. B. 192.168.x.x).
- **Render:** New ▸ Blueprint ▸ Repo `phasezehn` wählen ▸ Apply. Die `render.yaml`
  legt eine Free-Postgres an und verknüpft `DATABASE_URL` automatisch.
- **Keep-Alive:** Server ruft sich per `/health` alle 10 Min selbst auf, wenn
  `RENDER_EXTERNAL_URL` (auf Render meist automatisch) oder `SELF_URL` gesetzt ist –
  verhindert den Schlafmodus (sonst „Raum nicht gefunden").
- **Persistenz aktiv?** Server-Log zeigt beim Start „Persistenz: aktiv (Postgres)"
  bzw. „Persistenz: aus (kein DATABASE_URL)".

## Spielregeln (umgesetzt)
- **Deck (128):** 96 Zahlen (1–12, je 2× in Rot/Gelb/Grün/Violett), 14 Joker
  (7× Reichweite „lo"=1–6, 7× „hi"=7–12; je Reichweite 6 Doppelfarb-Joker + 1
  Allfarben-Joker, Feld `colors`), 18 Aktionskarten (6 skip, 4 draw2, 4 keepall,
  4 give5).
- **10 Master-Phasen** in `game.js` PHASES. Gruppentypen: `set`, `run`, `color`,
  `colorrun`.
- **Joker-Validierung:** reichweiten-bewusst; Set braucht ≥1 echte Karte, Folge ≥2;
  Farb-/Farbfolge-Phasen verlangen, dass die Joker-`colors` die Zielfarbe enthalten.
- **Wertung:** jede Restkarte = 1 Minuspunkt. Sieger: wer Phase 10 schafft,
  bei Gleichstand die wenigsten Punkte.

## Umgesetzte Features (Historie)
- Räume/Lobby, Erstellen/Beitreten, „Verlassen", Raum-Code immer sichtbar (oben links).
- **Echtzeit + robuster Reconnect:** Socket.IO Ping-Timeout 60 s; Client
  reconnection unendlich; Disconnect trennt nur, wenn der Socket noch aktuell ist
  (kein Überschreiben der Wiederverbindung → Bug „nach Reconnect kein Ziehen" behoben);
  Auto-Wiedereinstieg per gemerktem Raum; „Zurück in Raum XYZ"-Button auf dem Login.
- **Zugablauf:** ziehen (Nachzieh-/Ablagestapel), Phase auslegen (Mehr-Felder-Bau-UI,
  z. B. Phase 1 = 4 Felder), Anlegen (beliebig viele Karten/Melds pro Zug; Auswahl
  bleibt bei Fehlschlag), ablegen ODER Aktionskarte spielen/verfallen lassen.
- **Aktionskarten:**
  - Aussetzen: Ziel gewählt; betroffener Spieler bekommt 5 s großen **roten**
    Vollbild-Hinweis „X lässt dich aussetzen".
  - Nimm zwei: zieht 2 (vom Nachzieh- ODER die obersten 2 der Ablage), 1 behalten
    (Auswahl-Overlay). Aktiv sichtbar als Front-Badge ✌️.
  - Alles meins: **am Rundenende Popup** mit sichtbaren Handkarten → „Behalten"
    oder „Abgeben". **Verfällt automatisch, wenn man die Phase geschafft hat.**
  - Give me Five: Mitspieler bieten Karten an → Ausspieler nimmt 1. Der bestohlene
    Spieler sieht die **konkret genommene Karte** groß und zieht nach.
  - Jede Aktionskarte kann auch „verfallen gelassen" werden (für alle sichtbar via Info-Toast).
- **Nachzieh-Animation:** gezogene Karte wird kurz groß eingeblendet (Flip).
- **Karten-Design:** farbige Hintergründe + weiße Zahlen; Aktionskarten blau;
  Joker mit **diagonaler Farbteilung** + Reichweite-Pille (kein Stern); Give-me-Five
  ohne „5"; Kartenrückseite ohne „10".
- **2. Ablagekarte:** nur **deutlich** (nach oben, große Zahl), wenn man Nimm zwei
  ausliegen hat – sonst nur leicht angedeutet.
- **Wertungsblatt:** im Hamburger-Menü (oben rechts); zeigt Spieler × Runden + Gesamt.
- **Rundenende:** grüner Vollbild-Hinweis („Du/X hat die Runde beendet") +
  Auto-Popup Wertungsblatt; **Bereit-System** (alle „Bereit" → nächste Runde;
  Alles-meins-Entscheidung zählt als bereit).
- **Sortierung:** persistenter Auto-Sort-Toggle; **phasengerecht** (nach Farbe bei
  Farb-/Farbfolge-Phasen, sonst nach Zahl).
- **Runde 1:** niemand geht raus, bis jeder einmal dran war (Ausgesetzte zählen).
- **Zuschauer + Beitritts-Bestätigung:** Beitritt ins laufende Spiel mit fremdem
  Namen → **Anfrage**, die Mitspieler per Klick bestätigen („Zulassen") → spielt ab
  nächster Runde mit; sonst Zuschauer. Gleicher Name wie ein getrennter Spieler →
  direkter Wiedereinstieg.
- **Räume 30 Min offen** nach Verbindungsverlust; Host wird bei Disconnect übergeben.
- **Persistenz (Postgres):** Räume überstehen Neustart/Schlafmodus (Serialisierung
  Sets→Arrays, Socket-IDs raus; Laden beim Start; debounced Speichern + SIGTERM-Flush).
- **Mobile-Layout:** unten fixierte Aktions-Buttons, Hamburger-Menü oben, Hand
  verkleinert sich bei >10 Karten; **Desktop = 16:9-Tischlayout**. Modernes Login
  mit animiertem Hintergrund + „MASTER"-Badge.

## Wichtige Socket-Events (Server)
`createRoom, joinRoom, startGame, ready, keepAllChoice, confirmJoin, rejectJoin,
nextRound(Host-Fallback), draw, keepDrawn, layPhase, hit, discard, discardAction,
playAction, offerCard, pickOffered, leaveRoom, disconnect`.
Server→Client: `state, errorMsg, info, skipNotice, cardReveal`.

## Offene Punkte / bewusste Vereinfachungen
- **Render-Free-Postgres läuft 90 Tage**, danach neu anlegen. Alternative ohne
  Limit: **Upstash Redis** (dauerhaft gratis) – noch nicht umgesetzt, auf Wunsch machbar.
- **Nimm-zwei-Symbol** ist ✌️ (kein Emoji zeigt exakt Daumen+Zeigefinger).
- **Joker-Farbe in reinen Farb-Phasen** wird über das `colors`-Set geprüft;
  in Zahl-Sets/Folgen zählt nur die Reichweite (Farbe egal) – regelkonform.
- Der **Deploy-Schritt** (Render-Login, GitHub-Zugriff aufs private Repo) muss der
  Nutzer selbst machen; Accounts/OAuth kann der Assistent nicht ausführen.

## Test-Ansatz (nicht im Repo)
- Server-Logik: Node `socket.io-client`-Skripte (Vollpartie-Simulation, gezielte
  Reconnect-/Zuschauer-Tests) – lagen im Scratchpad, sind nicht committet.
- Persistenz: `pg-mem` (In-Memory-Postgres) testet store.js-SQL + Serialisierung.
- UI: In-App-Browser (mobil 375×812 und Desktop 1280×720).
- `socket.io-client`/`pg-mem` waren nur Dev-Abhängigkeiten (`--no-save`), nicht in
  package.json.

## Sinnvolle nächste Schritte (Ideen)
- Persistenz auf Upstash Redis umstellen (kein 90-Tage-Limit).
- Kartenanimation beim Ablegen/Anlegen; Sound.
- Optional: Give-me-Five auch die nachgezogene Ersatzkarte zeigen.
- Feineinstellungen Mobile-Layout nach echtem Gerätetest.
