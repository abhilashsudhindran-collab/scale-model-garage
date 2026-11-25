// Car colours (B, 24 Nov: "a colour swatch / filter, automatically detected").
// The car's colour comes from Gemini's answer (it sees the car itself; box art colours fool pixel counting),
// is mapped to one colour family, and is saved only when B taps it (or "Use all") — AI output stays a suggestion.

export const COLOUR_FAMILIES = [
  ['red', 'Red', '#c62828'], ['orange', 'Orange', '#ef6c00'], ['yellow', 'Yellow', '#f9c80e'], ['green', 'Green', '#2e7d32'],
  ['blue', 'Blue', '#1e5bb8'], ['purple', 'Purple', '#6a3d9a'], ['pink', 'Pink', '#e05a9b'], ['brown', 'Brown', '#7b4a2a'],
  ['gold', 'Gold', '#c9a227'], ['silver', 'Silver', '#b8bcc2'], ['grey', 'Grey', '#6e7378'], ['white', 'White', '#f4f4f2'],
  ['black', 'Black', '#1d1d1f'], ['multi', 'Multi-colour', 'conic-gradient(#c62828 0 25%, #f9c80e 0 50%, #1e5bb8 0 75%, #2e7d32 0)'],
];
export const familyLabel = (k) => (COLOUR_FAMILIES.find(f => f[0] === k) || [])[1] || '';
export const familySwatch = (k) => (COLOUR_FAMILIES.find(f => f[0] === k) || [])[2] || '';

// Words seen in colour names, checked in this order (longer and more specific first).
const WORDS = [
  ['multi', /\b(multi|multicolou?r|rainbow)\b/],
  ['green', /\b(british racing green|racing green|green|lime|olive|emerald|verde|mint|teal green)\b/],
  ['blue', /\b(blue|navy|azure|cobalt|teal|cyan|blu|bleu|gulf blue|petrol)\b/],
  ['purple', /\b(purple|violet|lilac|plum|magenta|lavender)\b/],
  ['pink', /\b(pink|rose|fuchsia|salmon)\b/],
  ['red', /\b(red|rosso|rouge|maroon|burgundy|crimson|scarlet|wine|cherry|ruby|carmine)\b/],
  ['orange', /\b(orange|arancio|tangerine|copper orange|papaya|amber)\b/],
  ['yellow', /\b(yellow|giallo|lemon|mustard)\b/],
  ['gold', /\b(gold|golden|champagne)\b/],
  ['brown', /\b(brown|bronze|copper|tan|beige|sand|khaki|chocolate|caramel)\b/],
  ['silver', /\b(silver|chrome|argento|aluminium|aluminum|platinum)\b/],
  ['grey', /\b(grey|gray|gunmetal|graphite|charcoal|slate|titanium|grigio)\b/],
  ['white', /\b(white|bianco|blanc|pearl|ivory|cream|snow)\b/],
  ['black', /\b(black|nero|noir|onyx|obsidian)\b/],
];

// "Pink / Dark Blue (RE-Amemiya livery)" → pink (the first colour named is the main one). '' when none.
export function familyFrom(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim() || /^[-–—]$/.test(t.trim())) return '';
  let best = '', at = Infinity;
  for (const [k, re] of WORDS) { const m = t.match(re); if (m && m.index < at) { at = m.index; best = k; } }
  return best;
}
