// ============================================================
//  Phase 10 – Spiellogik
// ============================================================

const COLORS = ['red', 'blue', 'green', 'yellow'];

// Die 10 Phasen. Jede Phase besteht aus einer oder mehreren
// Anforderungen ("groups"):
//   set   = X Karten gleicher Zahl
//   run   = X Karten in fortlaufender Reihenfolge (Farbe egal)
//   color = X Karten gleicher Farbe (Zahl egal)
const PHASES = [
  { desc: '2 Drillinge (je 3 gleiche)', groups: [{ type: 'set', count: 3 }, { type: 'set', count: 3 }] },
  { desc: '1 Drilling (3) + 1 Straße (4)', groups: [{ type: 'set', count: 3 }, { type: 'run', count: 4 }] },
  { desc: '1 Vierling (4) + 1 Straße (4)', groups: [{ type: 'set', count: 4 }, { type: 'run', count: 4 }] },
  { desc: '1 Straße aus 7 Karten', groups: [{ type: 'run', count: 7 }] },
  { desc: '1 Straße aus 8 Karten', groups: [{ type: 'run', count: 8 }] },
  { desc: '1 Straße aus 9 Karten', groups: [{ type: 'run', count: 9 }] },
  { desc: '2 Vierlinge (je 4 gleiche)', groups: [{ type: 'set', count: 4 }, { type: 'set', count: 4 }] },
  { desc: '7 Karten einer Farbe', groups: [{ type: 'color', count: 7 }] },
  { desc: '1 Fünfling (5) + 1 Zwilling (2)', groups: [{ type: 'set', count: 5 }, { type: 'set', count: 2 }] },
  { desc: '1 Fünfling (5) + 1 Drilling (3)', groups: [{ type: 'set', count: 5 }, { type: 'set', count: 3 }] },
];

let cardCounter = 0;
function makeCard(color, value) {
  return { id: 'c' + (cardCounter++), color, value };
}

// Deck: 108 Karten
//  - Zahlen 1..12 in 4 Farben, jeweils 2x  = 96
//  - 8 Joker (wild)
//  - 4 Aussetzen (skip)
function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let value = 1; value <= 12; value++) {
      deck.push(makeCard(color, value));
      deck.push(makeCard(color, value));
    }
  }
  for (let i = 0; i < 8; i++) deck.push(makeCard(null, 'wild'));
  for (let i = 0; i < 4; i++) deck.push(makeCard(null, 'skip'));
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isWild(card) { return card.value === 'wild'; }
function isSkip(card) { return card.value === 'skip'; }
function isNumber(card) { return typeof card.value === 'number'; }

// Punktwert einer Karte (für die Wertung am Rundenende)
function cardPoints(card) {
  if (isSkip(card)) return 15;
  if (isWild(card)) return 25;
  if (card.value >= 1 && card.value <= 9) return 5;
  return 10; // 10, 11, 12
}

// ---- Validierung der einzelnen Anforderungen ----

// Drilling/Vierling/...: alle Zahlenkarten gleich, Joker füllen auf.
function validSet(cards, count) {
  if (cards.length !== count) return false;
  if (cards.some(isSkip)) return false;
  const numbers = cards.filter(isNumber);
  if (numbers.length === 0) return true; // nur Joker
  const v = numbers[0].value;
  return numbers.every(c => c.value === v);
}

// Straße: fortlaufende Zahlen (Farbe egal), Joker füllen Lücken.
function validRun(cards, count) {
  if (cards.length !== count) return false;
  if (cards.some(isSkip)) return false;
  const numbers = cards.filter(isNumber).map(c => c.value);
  if (numbers.length === 0) return true; // nur Joker
  const uniq = new Set(numbers);
  if (uniq.size !== numbers.length) return false; // keine doppelten Zahlen in einer Straße
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  if (min < 1 || max > 12) return false;
  // alle echten Zahlen müssen in ein Fenster der Länge count passen
  return (max - min) <= (count - 1);
}

// Farbe: alle Zahlenkarten gleiche Farbe, Joker füllen auf.
function validColor(cards, count) {
  if (cards.length !== count) return false;
  if (cards.some(isSkip)) return false;
  const colored = cards.filter(c => !isWild(c));
  if (colored.length === 0) return true;
  const col = colored[0].color;
  return colored.every(c => c.color === col);
}

function validGroup(cards, req) {
  if (req.type === 'set') return validSet(cards, req.count);
  if (req.type === 'run') return validRun(cards, req.count);
  if (req.type === 'color') return validColor(cards, req.count);
  return false;
}

// Prüft eine komplette Phase (Array von Karten-Gruppen gegen Phasen-Anforderungen)
function validatePhase(phaseIndex, groupsOfCards) {
  const phase = PHASES[phaseIndex];
  if (!phase) return false;
  if (groupsOfCards.length !== phase.groups.length) return false;
  return phase.groups.every((req, i) => validGroup(groupsOfCards[i], req));
}

// ---- Anlegen an bestehende Melds ("hitten") ----
// Prüft, ob 'cards' an eine bereits ausgelegte Gruppe angelegt werden dürfen.
function canHit(group, cards) {
  if (cards.some(isSkip)) return false;
  const combined = group.cards.concat(cards);
  if (group.type === 'set' || group.type === 'color') {
    // beliebig viele passende / Joker anhängen
    if (group.type === 'set') {
      const nums = combined.filter(isNumber);
      if (nums.length === 0) return true;
      const v = nums[0].value;
      return nums.every(c => c.value === v);
    } else { // color
      const colored = combined.filter(c => !isWild(c));
      if (colored.length === 0) return true;
      const col = colored[0].color;
      return colored.every(c => c.color === col);
    }
  }
  if (group.type === 'run') {
    // Straße an beiden Enden erweitern. Joker müssen zusammenhängend bleiben.
    return validRunExtension(combined);
  }
  return false;
}

// Für eine erweiterte Straße: es muss eine gültige fortlaufende Anordnung geben.
function validRunExtension(cards) {
  const len = cards.length;
  const numbers = cards.filter(isNumber).map(c => c.value);
  const wilds = len - numbers.length;
  const uniq = new Set(numbers);
  if (uniq.size !== numbers.length) return false;
  if (numbers.length === 0) return len <= 12;
  const min = Math.min(...numbers), max = Math.max(...numbers);
  if (min < 1 || max > 12) return false;
  // Gibt es ein Fenster [s, s+len-1] in [1..12], das alle Zahlen enthält?
  for (let s = 1; s + len - 1 <= 12; s++) {
    if (min >= s && max <= s + len - 1) return true;
  }
  return false;
}

module.exports = {
  COLORS, PHASES, buildDeck, shuffle,
  isWild, isSkip, isNumber, cardPoints,
  validatePhase, validGroup, canHit,
};
