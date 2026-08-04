# Phase 10 Master – Online Multiplayer

Ein browserbasiertes Echtzeit-Multiplayer-Kartenspiel (Variante **Phase 10
Master**). Jeder spielt an seinem eigenen Gerät (Handy, Tablet, Laptop) –
verbunden über einen Raum-Code.

## Starten

```bash
npm install
npm start
```

Der Server läuft dann auf **http://localhost:3000**.

## Mit Freunden spielen (gleiches WLAN)

1. Server auf deinem Rechner starten (`npm start`).
2. Deine lokale IP-Adresse herausfinden – z.B. `192.168.179.3`.
3. Alle Mitspieler öffnen im Browser: **http://192.168.179.3:3000**
4. Einer erstellt einen Raum → bekommt einen 4-stelligen Code.
5. Die anderen geben Namen + Code ein und treten bei.
6. Der Host startet das Spiel (ab 2 Spielern, bis zu 6).

## Online spielen (von überall, egal welches WLAN)

Das Projekt ist deploy-fertig (enthält `render.yaml`). Auf **Render** (kostenlos):

1. Auf [render.com](https://render.com) mit **GitHub** anmelden.
2. **New ▸ Blueprint** → Repo `milanjanium/phasezehn` auswählen
   (bei privatem Repo einmalig Render-Zugriff auf GitHub erlauben).
3. Render liest `render.yaml`, klickt **Apply/Deploy** – fertig.
4. Nach ~1–2 Min. gibt es eine öffentliche URL wie
   `https://phasezehn.onrender.com`, die jeder von überall öffnen kann.

Hinweis: Der kostenlose Plan „schläft" nach Inaktivität – der erste
Aufruf nach einer Pause dauert ~30–50 Sek., danach läuft alles flüssig.
Ein eingebauter Keep-Alive (`/health`) hält den Dienst wach, solange die
Umgebungsvariable `RENDER_EXTERNAL_URL` gesetzt ist (auf Render meist
automatisch; sonst `SELF_URL` = deine `…onrender.com`-Adresse setzen).

> Alternativen: Railway oder Fly.io funktionieren genauso (Standard-
> Node-Server, liest `PORT` aus der Umgebung).

### Räume dauerhaft speichern (empfohlen)

Ohne Datenbank liegen die Räume nur im Speicher und gehen bei jedem
Neustart/Schlafmodus verloren („Raum nicht gefunden"). Mit einer
PostgreSQL-Datenbank überstehen sie Neustarts:

1. Auf Render **New ▸ PostgreSQL** anlegen (Free-Plan genügt).
2. Beim Web-Service unter **Environment** eine Variable **`DATABASE_URL`**
   setzen – auf die **Internal Database URL** der neuen Datenbank.
   (Blueprint-Nutzer: die `render.yaml` verknüpft das automatisch.)
3. Neu deployen. Beim Start erscheint im Log „Persistenz: aktiv (Postgres)".

Lokal ist keine DB nötig – ohne `DATABASE_URL` läuft alles wie bisher im
Speicher (`Persistenz: aus`). Die Tabelle `rooms` wird automatisch angelegt.

## Spielregeln (Kurzfassung)

- **Ziel:** Als Erster alle 10 Phasen der Reihe nach abschließen.
- **Karten (128):** 1–12 in 4 Farben (Rot, Gelb, Grün, Violett; je 2×),
  14 Joker (Reichweite **1–6** oder **7–12**) und 18 blaue Aktionskarten.
- **Zug:** 1 Karte ziehen (Nachziehstapel *oder* Ablage) → optional Phase
  auslegen / anlegen → 1 Karte ablegen **oder** eine Aktionskarte spielen.
- **Joker** ersetzt Karten seiner Reichweite (jedes Set braucht ≥1 echte
  Karte, jede Folge ≥2). **Aktionskarten** siehe unten.
- Wer zuerst alle Handkarten los ist, beendet die Runde. Nur wer seine
  Phase geschafft hat, rückt zur nächsten vor.
- **Wertung:** jede Restkarte = **1 Minuspunkt** (wenig = gut).
- Sieger: Wer Phase 10 abschließt – bei Gleichstand die wenigsten Punkte.

### Die 10 Master-Phasen
1. 4 Zwillinge (je 2 gleiche)
2. 6 Karten einer Farbe
3. 1 Vierling (4) + 1 Viererfolge (4)
4. 1 Achterfolge (8)
5. 7 Karten einer Farbe
6. 1 Neunerfolge (9)
7. 2 Vierlinge (je 4 gleiche)
8. 1 Viererfolge einer Farbe (4) + 1 Drilling (3)
9. 1 Fünfling (5) + 1 Drilling (3)
10. 1 Fünfling (5) + 1 Dreierfolge einer Farbe (3)

### Aktionskarten (statt Ablegen ausspielen)
- **Aussetzen!** – ein gewählter Mitspieler muss eine Runde aussetzen.
- **Nimm zwei!** – ab dem nächsten Zug 2 Karten ziehen, 1 behalten.
- **Alles meins!** – am Rundenende die Handkarten behalten statt neu auszuteilen.
- **Give me Five!** – alle Mitspieler bieten zusammen 5 Karten an, du nimmst 1.

## Technik

- **Backend:** Node.js + Express + Socket.IO (Echtzeit-Synchronisation)
- **Frontend:** Vanilla HTML/CSS/JS, mobiloptimiert
- **Dateien:**
  - `server.js` – Server, Räume, Socket-Events
  - `game.js` – Spiellogik (Deck, Phasen-Prüfung, Wertung)
  - `public/` – Oberfläche (Login, Lobby, Spielbrett)

## Bedienung

- **Ziehen:** Auf „Nachziehen" oder die Ablagekarte tippen.
- **Phase auslegen:** Button „Phase auslegen" → je Feld die passenden
  Karten antippen → „Auslegen bestätigen".
- **Anlegen:** Nach eigener Phase Karten wählen und auf eine ausliegende
  Phase (eigene oder fremde) tippen.
- **Ablegen:** Eine Handkarte antippen → „Karte ablegen" – oder die Karte
  **doppelt antippen** (legt sie sofort ab).
- **Aktionskarte spielen:** Aktionskarte antippen → „▶ Aktion spielen".
- **Raum-Code** ist oben links immer sichtbar (für Wiederbeitritt).
