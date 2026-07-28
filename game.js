// ============================================================
//  Phase 10 MASTER – Spiellogik
// ============================================================

const COLORS = ['red', 'yellow', 'green', 'violet'];

// Die 10 Master-Phasen. Gruppentypen:
//   set      = X Karten gleicher Zahl
//   run      = X Karten fortlaufend (Farbe egal)
//   color    = X Karten gleicher Farbe (Zahl egal)
//   colorrun = X Karten fortlaufend UND gleiche Farbe
const PHASES = [
  { desc: '4 Zwillinge (je 2 gleiche)', groups: [{ type: 'set', count: 2 }, { type: 'set', count: 2 }, { type: 'set', count: 2 }, { type: 'set', count: 2 }] },
  { desc: '6 Karten einer Farbe', groups: [{ type: 'color', count: 6 }] },
  { desc: '1 Vierling (4) + 1 Viererfolge (4)', groups: [{ type: 'set', count: 4 }, { type: 'run', count: 4 }] },
  { desc: '1 Achterfolge (8)', groups: [{ type: 'run', count: 8 }] },
  { desc: '7 Karten einer Farbe', groups: [{ type: 'color', count: 7 }] },
  { desc: '1 Neunerfolge (9)', groups: [{ type: 'run', count: 9 }] },
  { desc: '2 Vierlinge (je 4 gleiche)', groups: [{ type: 'set', count: 4 }, { type: 'set', count: 4 }] },
  { desc: '1 Viererfolge einer Farbe (4) + 1 Drilling (3)', groups: [{ type: 'colorrun', count: 4 }, { type: 'set', count: 3 }] },
  { desc: '1 Fünfling (5) + 1 Drilling (3)', groups: [{ type: 'set', count: 5 }, { type: 'set', count: 3 }] },
  { desc: '1 Fünfling (5) + 1 Dreierfolge einer Farbe (3)', groups: [{ type: 'set', count: 5 }, { type: 'colorrun', count: 3 }] },
];

// Aktionskarten-Werte
const ACTIONS = ['skip', 'draw2', 'keepall', 'give5'];

let cardCounter = 0;
function makeCard(props) { return Object.assign({ id: 'c' + (cardCounter++) }, props); }

// Deck (128 Karten):
//  - 96 Zahlenkarten: 1..12 in 4 Farben, je 2x
//  - 14 Joker: je 7x Reichweite "lo" (1-6) und "hi" (7-12)
//  - 18 Aktionskarten: 6x Aussetzen, 4x Nimm zwei, 4x Alles meins, 4x Give me Five
function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let value = 1; value <= 12; value++) {
      deck.push(makeCard({ color, value }));
      deck.push(makeCard({ color, value }));
    }
  }
  for (let i = 0; i < 7; i++) deck.push(makeCard({ color: null, value: 'joker', range: 'lo' }));
  for (let i = 0; i < 7; i++) deck.push(makeCard({ color: null, value: 'joker', range: 'hi' }));
  const actionCounts = { skip: 6, draw2: 4, keepall: 4, give5: 4 };
  for (const [a, n] of Object.entries(actionCounts)) {
    for (let i = 0; i < n; i++) deck.push(makeCard({ color: null, value: a }));
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isJoker(card) { return card.value === 'joker'; }
function isAction(card) { return ACTIONS.includes(card.value); }
function isNumber(card) { return typeof card.value === 'number'; }
function isSpecial(card) { return isJoker(card) || isAction(card); } // darf nicht als Startkarte offen liegen

// Reichweite eines Jokers: lo = 1..6, hi = 7..12
function jokerCovers(card, value) {
  if (card.range === 'lo') return value >= 1 && value <= 6;
  return value >= 7 && value <= 12;
}

// Jede Restkarte zählt 1 Minuspunkt (Master-Wertung).
function cardPoints() { return 1; }

// ---- Bausteine der Validierung ----
// Alle Prüfungen verbieten Aktionskarten in Kombinationen.

function setOk(cards) {
  if (cards.some(isAction)) return false;
  const nums = cards.filter(isNumber);
  const jokers = cards.filter(isJoker);
  if (nums.length < 1) return false;                // Set braucht ≥1 echte Karte
  const v = nums[0].value;
  if (!nums.every(c => c.value === v)) return false;
  return jokers.every(j => jokerCovers(j, v));      // Joker müssen den Wert abdecken
}

function colorOk(cards) {
  if (cards.some(isAction)) return false;
  const nums = cards.filter(isNumber);
  if (nums.length < 1) return false;                // ≥1 echte Karte
  const col = nums[0].color;
  return nums.every(c => c.color === col);          // Joker = beliebige Farbe
}

// Prüft, ob die Karten eine fortlaufende Folge der Länge cards.length bilden.
function runOk(cards) {
  if (cards.some(isAction)) return false;
  const nums = cards.filter(isNumber);
  const jokers = cards.filter(isJoker);
  if (nums.length < 2) return false;                // Folge braucht ≥2 echte Karten
  const vals = nums.map(c => c.value);
  if (new Set(vals).size !== vals.length) return false; // keine doppelten Zahlen
  const L = cards.length;
  const jl = jokers.filter(j => j.range === 'lo').length;
  const jh = jokers.filter(j => j.range === 'hi').length;
  const min = Math.min(...vals), max = Math.max(...vals);
  if (max - min > L - 1) return false;
  const have = new Set(vals);
  for (let s = 1; s + L - 1 <= 12; s++) {
    if (s > min || s + L - 1 < max) continue;       // Fenster muss alle echten Zahlen enthalten
    let emptyLo = 0, emptyHi = 0;
    for (let v = s; v <= s + L - 1; v++) {
      if (have.has(v)) continue;
      if (v <= 6) emptyLo++; else emptyHi++;
    }
    if (emptyLo === jl && emptyHi === jh) return true; // Joker passen exakt in die Lücken
  }
  return false;
}

function colorRunOk(cards) {
  if (!runOk(cards)) return false;
  const nums = cards.filter(isNumber);
  const col = nums[0].color;
  return nums.every(c => c.color === col);          // zusätzlich gleiche Farbe
}

function groupOk(cards, type) {
  if (type === 'set') return setOk(cards);
  if (type === 'color') return colorOk(cards);
  if (type === 'run') return runOk(cards);
  if (type === 'colorrun') return colorRunOk(cards);
  return false;
}

function validGroup(cards, req) {
  return cards.length === req.count && groupOk(cards, req.type);
}

// Prüft eine komplette Phase (Array von Karten-Gruppen gegen die Anforderungen)
function validatePhase(phaseIndex, groupsOfCards) {
  const phase = PHASES[phaseIndex];
  if (!phase) return false;
  if (groupsOfCards.length !== phase.groups.length) return false;
  return phase.groups.every((req, i) => validGroup(groupsOfCards[i], req));
}

// ---- Anlegen an bestehende Melds ----
// 'cards' dürfen an die Gruppe angelegt werden, wenn die vergrößerte
// Gruppe weiterhin eine gültige Kombination ihres Typs ist.
function canHit(group, cards) {
  if (cards.some(isAction)) return false;
  return groupOk(group.cards.concat(cards), group.type);
}

module.exports = {
  COLORS, PHASES, ACTIONS, buildDeck, shuffle,
  isJoker, isAction, isNumber, isSpecial, cardPoints,
  validatePhase, validGroup, canHit,
};
