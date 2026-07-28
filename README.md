# Phase 10 – Online Multiplayer

Ein browserbasiertes Echtzeit-Multiplayer-Kartenspiel. Jeder spielt an
seinem eigenen Gerät (Handy, Tablet, Laptop) – verbunden über einen Raum-Code.

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

> Alternativen: Railway oder Fly.io funktionieren genauso (Standard-
> Node-Server, liest `PORT` aus der Umgebung).

## Spielregeln (Kurzfassung)

- **Ziel:** Als Erster alle 10 Phasen der Reihe nach abschließen.
- **Karten:** 1–12 in 4 Farben (je 2×), 8 Joker, 4 Aussetzen-Karten.
- **Zug:** 1 Karte ziehen (Nachziehstapel *oder* Ablage) → optional Phase
  auslegen / anlegen → 1 Karte ablegen.
- **Joker** ersetzt jede Karte. **Aussetzen** lässt einen Mitspieler
  pausieren (kann nicht von der Ablage aufgenommen werden).
- Wer zuerst alle Handkarten los ist, beendet die Runde. Nur wer seine
  Phase geschafft hat, rückt zur nächsten vor.
- **Punkte** (wenig = gut) für Restkarten: 1–9 = 5 P., 10–12 = 10 P.,
  Aussetzen = 15 P., Joker = 25 P.
- Sieger: Wer Phase 10 abschließt – bei Gleichstand die wenigsten Punkte.

### Die 10 Phasen
1. 2 Drillinge (je 3 gleiche)
2. 1 Drilling (3) + 1 Straße (4)
3. 1 Vierling (4) + 1 Straße (4)
4. 1 Straße aus 7 Karten
5. 1 Straße aus 8 Karten
6. 1 Straße aus 9 Karten
7. 2 Vierlinge (je 4 gleiche)
8. 7 Karten einer Farbe
9. 1 Fünfling (5) + 1 Zwilling (2)
10. 1 Fünfling (5) + 1 Drilling (3)

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
- **Ablegen:** Eine Handkarte antippen → „Karte ablegen".
