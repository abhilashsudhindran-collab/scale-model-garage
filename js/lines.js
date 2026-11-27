// Product lines (s1-0.47.0): e.g. Kaido House (Mini GT), Silver Series (Hot Wheels). Pure helpers.
// Lines are for grouping and counting only: they never change the duplicate check (is_code_namespace stays 'no').

// The line whose code start (code_prefix_hint) the product code begins with, if exactly one matches. A hint only.
export function suggestLine(code, lines) {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!c) return null;
  const hits = lines.filter(l => !l.deleted_at && String(l.code_prefix_hint || '').trim() && c.startsWith(String(l.code_prefix_hint).trim().toUpperCase().replace(/\s+/g, '')));
  if (!hits.length) return null;
  hits.sort((a, b) => String(b.code_prefix_hint).length - String(a.code_prefix_hint).length); // T64G- beats T64-
  return hits.length === 1 || String(hits[0].code_prefix_hint).length > String(hits[1].code_prefix_hint).length ? hits[0] : null;
}

export const cleanLineName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
