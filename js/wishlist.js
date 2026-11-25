// Wishlist (s1-0.42.0): pure helpers. Matches are hints only ("you may already have this"); nothing is merged or changed.
import { codeCmp } from './rules.js';

export const PRIORITIES = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
export const priorityRank = (p) => ({ high: 0, medium: 1, low: 2 }[p] ?? 3);

// Words that say nothing about which car it is.
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'with', 'edition', 'version', 'model', 'car', 'scale']);
export function nameWords(s) {
  return [...new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && !STOP.has(w)))];
}

// Owned cars that look like the wished-for one.
//  'code': same product code, and the same brand when both have one (strong)
//  'name': every telling word of the wish name is in the car's name, at least two words (a hint)
export function ownedMatches(wish, cars) {
  const code = codeCmp(wish.product_code);
  const words = nameWords(wish.object_name);
  const out = [];
  for (const m of cars) {
    const sameBrand = !wish.brand_id || !m.brand_id || wish.brand_id === m.brand_id;
    if (code && codeCmp(m.product_code) === code && sameBrand) { out.push({ model: m, reason: 'code' }); continue; }
    if (words.length >= 2 && sameBrand) {
      const have = new Set(nameWords(m.display_name));
      if (words.every(w => have.has(w))) out.push({ model: m, reason: 'name' });
    }
  }
  return out.sort((a, b) => (a.reason === 'code' ? 0 : 1) - (b.reason === 'code' ? 0 : 1));
}

// Only plain web links are opened (no javascript:, data: or other schemes).
export function safeUrl(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : ''; } catch { return ''; }
}

// "₹1,250" style price, or '' when not a number.
export function priceNum(s) {
  const t = String(s ?? '').replace(/[₹,\s]/g, '');
  return t !== '' && !isNaN(Number(t)) && Number(t) >= 0 ? Number(t) : null;
}
