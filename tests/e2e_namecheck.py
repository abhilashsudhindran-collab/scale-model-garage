"""Developer test for s1-0.38.0: faster naming check (front + back side by side; scanned barcode; code already in
the garage; code shape unusual for the brand; barcode shared with another car). Fake data; NOT a phone test.

Run:  python3 tests/e2e_namecheck.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.evaluate("localStorage.setItem('smg.motion', 'off')")
        page.evaluate(SEED + '(6)')
        page.evaluate("""(async () => {
          const idb = await import('./js/idb.js'); const st = await import('./js/store.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          const brand = ms[0].data.brand_id;
          ms.forEach((r, k) => { r.data.brand_id = brand; if (k < 4) { r.data.display_name = ''; r.data.product_code = ''; r.data.product_code_cmp = ''; }
            else { r.data.display_name = 'Owned car ' + k; r.data.product_code = 'MGT0000' + k + '-L'; r.data.product_code_cmp = 'MGT0000' + k + '-L'; } });
          await idb.records.putMany(ms);
          const ids = await idb.records.byEntity('product_identifiers');
          const bc4 = ids.find(i => i.data.model_id === ms[4].id).data.value_raw;
          const i3 = ids.find(i => i.data.model_id === ms[3].id); i3.data.value_raw = bc4; await idb.records.putMany([i3]);
          await st.create('ai_log', { ai_log_id: 'ai_nc', prompt_version: 'names-v8' });
          await idb.meta.set('aiSuggest', {
            [ms[0].id]: { name: 'Dup car', code: 'MGT00004-L', notes: [], logId: 'ai_nc', pv: 5 },
            [ms[1].id]: { name: 'Normal car', code: 'MGT00777-L', notes: [], logId: 'ai_nc', pv: 5 },
            [ms[2].id]: { name: 'Odd car', code: 'XYZ-1', notes: [], logId: 'ai_nc', pv: 5 },
            [ms[3].id]: { name: 'Shared barcode car', code: '', notes: [], logId: 'ai_nc', pv: 5 } });
        })()""")
        page.goto(base + '#/name'); page.wait_for_selector('.namelist')
        rows = page.locator('.nl-row')
        check(rows.count() == 4, 'four suggestions on the check page')
        check(rows.nth(0).locator('.nl-pair img').count() == 2, 'front and back side by side')
        t = [rows.nth(k).locator('.nl-checks').inner_text() for k in range(4)]
        for k, x in enumerate(t): print(f'   row {k}:', x.replace('\n', ' | '))
        check('already in your garage: Owned car 4' in t[0], 'code already in the garage is flagged before saving')
        check('looks like your other' in t[1], 'normal code: looks like your other codes')
        check('Unusual for your' in t[2] and 'MGT0000' in t[2], 'odd code shape flagged with an example from your own codes')
        check('also on Owned car 4' in t[3], 'barcode shared with another car is flagged')
        check('(scanned)' in t[1], 'scanned barcode shown')
        rows.nth(2).locator('input[aria-label="Product code"]').fill('MGT00888-L'); page.wait_for_timeout(200)
        check('looks like your other' in rows.nth(2).locator('.nl-checks').inner_text(), 'fixing the code updates the check live')
        if os.environ.get('SHOTS'): rows.nth(0).screenshot(path='/tmp/nc-row0.png'); rows.nth(3).screenshot(path='/tmp/nc-row3.png')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
