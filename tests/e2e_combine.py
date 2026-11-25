"""Developer test for s1-0.29.0: combined photos for Gemini (front + back side by side, 10 boxes per share),
separate score for each mode. Fake data and a simulated share sheet; NOT a phone test (Gemini's reading of
combined pictures is unknown until B tries it).

Run:  python3 tests/e2e_combine.py
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

MOCK = """
window.__shared = null; window.__clip = '';
navigator.canShare = (d) => !!(d && d.files && d.files.length);
navigator.share = async (d) => { const dims = []; for (const f of d.files || []) { const b = await createImageBitmap(f); dims.push([b.width, b.height]); }
  window.__shared = { n: (d.files || []).length, names: (d.files || []).map(f => f.name), dims, text: d.text }; };
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__clip = t; }, readText: async () => window.__clip }, configurable: true });
"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}); ctx.add_init_script(MOCK)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(12)')
        page.evaluate("""(async () => { const idb = await import('./js/idb.js');
          const ms = await idb.records.byEntity('models'); for (const r of ms) { r.data.display_name = ''; r.data.product_code = ''; r.data.product_code_cmp = ''; } await idb.records.putMany(ms); })()""")
        page.goto(base + '#/name'); page.wait_for_selector('text=Names from Gemini or Claude')
        check(page.is_visible('text=Get names for the next 5 boxes'), 'default: separate photos, 5 boxes')
        page.get_by_role('button', name='Combine front + back · 10 boxes (trial)').click(); page.wait_for_timeout(300)
        check(page.is_visible('text=Get names for the next 10 boxes'), 'combined: 10 boxes per round')
        page.get_by_role('button', name='Get names for the next 10 boxes').click(); page.wait_for_selector('text=photos ready', timeout=20000)
        check(page.is_visible('text=10 boxes, 10 photos ready'), '10 boxes → 10 pictures')
        page.get_by_role('button', name='Share to Gemini or Claude').click(); page.wait_for_selector('.pastehint')
        sh = page.evaluate('window.__shared')
        check(sh['n'] == 10 and sh['names'][:2] == ['box1.jpg', 'box2.jpg'], f"10 files shared in box order ({sh['names'][:3]})")
        check(all(w > h for w, h in sh['dims']), f"each picture is front + back side by side (wider than tall: {sh['dims'][0]})")
        check('photo 10 = box front (left half) and box back (right half)' in sh['text'], 'instructions describe the combined layout')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('ai_log'))[0])()")
        check(log['prompt_version'].endswith('-combined') and len(log['input_photo_ids'].split(',')) == 20, f"AI_LOG marks the mode and keeps front/back pairs ({log['prompt_version']})")
        ans = '| Box | Car name | Year | Product code | Brand | Colour | Note |\n|---|---|---|---|---|---|---|\n' + '\n'.join(f'| Box {k} | Test Car {k} | 2024 | MGT00{100 + k} | Mini GT | Red | - |' for k in range(1, 11))
        page.evaluate(f'window.__clip = {json.dumps(ans)}')
        page.get_by_role('button', name='📋 Paste & use').click(); page.wait_for_selector('.namelist')
        check(page.locator('.nl-row').count() == 10, 'all 10 suggestions on one page')
        first = page.locator('.nl-row').first.locator('input[aria-label="Name"]').input_value()
        check(first.startswith('Test Car 1') and not first.startswith('Test Car 10'), f'box 1 matched to the first car ({first})')
        page.locator('.nl-row').nth(1).locator('input[aria-label="Product code"]').fill('MGT00999')  # B corrects one code
        page.locator('#nameSaveAll').click(); page.wait_for_timeout(2500)
        page.goto(base + '#/name'); page.wait_for_selector('.gscore', timeout=8000)
        page.locator('.gscore summary').click(); page.wait_for_timeout(300)
        txt = page.inner_text('.gscore')
        check('Combined: 9 of 10 right · codes 9 of 10' in txt, f"score shown per mode ({[l for l in txt.splitlines() if 'Combined' in l]})")
        check(page.is_visible('text=2 boxes, 2 photos ready'), 'next batch auto-prepared in combined mode (2 left → 2 pictures)')
        page.get_by_role('button', name='2 photos per box · 5 boxes').click(); page.wait_for_selector('text=2 boxes, 4 photos ready', timeout=15000)
        check(True, 'switching back re-prepares the batch as separate photos (4 photos)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
