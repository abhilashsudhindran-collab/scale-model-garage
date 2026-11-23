// Permanent record IDs made on the phone (works offline). Decision D27/S1:
// short prefix + time-sortable random part, e.g. "mdl_01JH7Q3K8M4X2B9ZQW5RT6YV0N".
// 10 characters of time (ms since 1970, Crockford base-32) + 16 random characters.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base-32 (no I, L, O, U)

export const PREFIX = {
  companies: 'cmp', brands: 'brd', product_lines: 'lin', aliases: 'als', scales: 'scl',
  categories: 'cat', objects: 'obj', models: 'mdl', product_identifiers: 'pid', inventory: 'inv',
  orders: 'ord', transactions: 'trx', photos: 'pho', wishlist: 'wsh', price_evidence: 'evd',
  value_history: 'val', valuation_runs: 'run', ai_log: 'ail', change_log: 'chg',
};

export function timePart(ms = Date.now()) {
  let out = '';
  for (let i = 0; i < 10; i++) { out = ALPHABET[ms % 32] + out; ms = Math.floor(ms / 32); }
  return out;
}

export function randomPart(n = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export function newId(entity) {
  const p = PREFIX[entity];
  if (!p) throw new Error(`Unknown entity for ID: ${entity}`);
  return `${p}_${timePart()}${randomPart()}`;
}

export const isId = (s) => typeof s === 'string' && /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/.test(s);

// Deterministic IDs for seed data (scales, categories, starting brands), so every device creates the SAME
// IDs and the Sheet never gets duplicate seed rows. Format still matches isId(): prefix + "SEED" + 22 chars.
export function seedId(entity, name) {
  const p = PREFIX[entity];
  let out = '';
  for (let salt = 0; out.length < 22; salt++) {
    let h = 0x811c9dc5 ^ salt;
    for (const ch of `${entity}|${name}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    for (let k = 0; k < 6 && out.length < 22; k++) { out += ALPHABET[h & 31]; h >>>= 5; }
  }
  return `${p}_SEED${out}`;
}
