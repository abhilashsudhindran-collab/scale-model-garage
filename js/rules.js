// Product-identity rules. Pure functions (no browser APIs) so they can be unit-tested.
// Sources: brief §8, decisions D10.1, D11, master spec Part E #19 and #21.

// Product code comparison form: trim + upper-case ONLY. Nothing is removed (brief §8, D11).
export const codeCmp = (code) => (code == null ? '' : String(code).trim().toUpperCase());

// Barcode comparison form (Part E #19): digits only; 12-digit UPC-A becomes 13-digit EAN-13
// with a leading 0. The raw value is always stored separately, exactly as scanned/typed.
export function barcodeCmp(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12) return '0' + d;
  return d;
}

// GS1 check digit (EAN-8, UPC-A, EAN-13, GTIN-14). Returns true / false / null (not a GTIN length).
export function gtinCheckOk(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length)) return null;
  const digits = d.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  // Weights 3,1,3,1… from the rightmost remaining digit.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

// Which catalogue "namespace" a product code belongs to (D10.1 rule 2: from canonical records only).
// brand/line are canonical records (objects) or null. Returns { type, id, status }.
export function assignNamespace(brand, line) {
  if (line && line.is_code_namespace === 'yes') {
    return { type: 'line', id: line.line_id, status: line.record_status === 'confirmed' && brand?.record_status === 'confirmed' ? 'confirmed' : 'needs_review' };
  }
  if (brand) {
    if (brand.is_code_namespace === 'no') return { type: '', id: '', status: 'needs_review' };
    return { type: 'brand', id: brand.brand_id, status: brand.record_status === 'confirmed' ? 'confirmed' : 'needs_review' };
  }
  return { type: '', id: '', status: 'none' };
}

// Whether a product can be duplicate-checked (brief §8 NOT_CHECKABLE).
export function duplicateCheckStatus(model) {
  if (!codeCmp(model.product_code)) return 'not_checkable';
  if (model.namespace_status === 'confirmed' && model.code_namespace_id) return 'checkable';
  if (model.namespace_status === 'needs_review') return 'needs_review';
  return 'not_checkable';
}

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w.length > 1);

// Duplicate check for a candidate product against existing products.
// candidate: { model_id?, code_namespace_id, namespace_status, product_code, display_name, brand_id }
// models: existing MODELS records (active only). identifiers: PRODUCT_IDENTIFIERS records.
// candidateBarcodes: comparison-form barcodes of the candidate.
// Returns { status: 'duplicate' | 'no_match' | 'not_checkable' | 'needs_review', exact: [models], possible: [{model, reason}] }
export function checkDuplicate(candidate, models, identifiers = [], candidateBarcodes = []) {
  const active = models.filter(m => !m.deleted_at && m.model_id !== candidate.model_id);
  const status = duplicateCheckStatus(candidate);
  const code = codeCmp(candidate.product_code);
  const exact = [];
  const possible = new Map(); // model_id -> {model, reasons:Set}
  const addPossible = (m, reason) => {
    if (exact.includes(m)) return;
    const e = possible.get(m.model_id) || { model: m, reasons: new Set() };
    e.reasons.add(reason); possible.set(m.model_id, e);
  };

  for (const m of active) {
    const mCode = codeCmp(m.product_code);
    if (code && mCode && code === mCode) {
      const sameNs = candidate.code_namespace_id && candidate.code_namespace_id === m.code_namespace_id;
      if (sameNs && status === 'checkable' && m.namespace_status === 'confirmed') exact.push(m);
      else if (sameNs) addPossible(m, 'same code, brand needs review');
      else addPossible(m, 'same code, different or unknown brand');
    } else if (code && mCode && candidate.brand_id && candidate.brand_id === m.brand_id &&
               (mCode.startsWith(code) || code.startsWith(mCode)) && Math.min(code.length, mCode.length) >= 4) {
      addPossible(m, 'similar code (one is the start of the other)');
    }
  }

  if (candidateBarcodes.length) {
    const want = new Set(candidateBarcodes.filter(Boolean));
    for (const idf of identifiers) {
      if (idf.deleted_at || idf.identifier_type !== 'barcode' || !want.has(idf.value_cmp)) continue;
      const m = active.find(x => x.model_id === idf.model_id);
      if (m) addPossible(m, 'same barcode');
    }
  }

  const cw = new Set(words(candidate.display_name));
  if (cw.size >= 2) {
    for (const m of active) {
      const mw = words(m.display_name);
      if (!mw.length) continue;
      const shared = mw.filter(w => cw.has(w)).length;
      if (shared >= 2 && shared / Math.max(cw.size, mw.length) >= 0.5) addPossible(m, 'similar name');
    }
  }

  const possibleList = [...possible.values()].map(e => ({ model: e.model, reason: [...e.reasons].join(' · ') }));
  let result;
  if (exact.length) result = 'duplicate';
  else if (status === 'checkable') result = 'no_match';
  else result = status; // not_checkable | needs_review
  return { status: result, exact, possible: possibleList };
}
