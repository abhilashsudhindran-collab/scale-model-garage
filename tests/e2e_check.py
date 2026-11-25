"""Developer test for s1-0.23.0: Dashboard "To check" (no brand / scale / code / box / colour, possible duplicates),
each opening the matching Garage list. Fake data; NOT a phone test.

Run:  python3 tests/e2e_check.py
"""
import os, sys, time
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
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(8)')
        page.evaluate("""(async () => { const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          ms.forEach(r => { r.data.colour_family = 'red'; }); // everyone has a colour …
          ms[0].data.brand_id = ''; ms[1].data.scale_id = ''; ms[2].data.product_code = ''; ms[2].data.product_code_cmp = '';
          ms[3].data.colour_family = '';                                    // … except car 4
          ms[4].data.display_name = ms[5].data.display_name = 'Porsche 917 1970'; // a likely duplicate pair (by name)
          ms[5].data.display_name = 'Porsche 917';
          await idb.records.putMany(ms);
          const inv = await st.list('inventory'); await st.update('inventory', inv.find(i => i.model_id === ms[6].id).inventory_id, { storage_location: '' });
          for (const i of await st.list('product_identifiers')) if (i.model_id === ms[4].id || i.model_id === ms[5].id) await st.archive('product_identifiers', i.identifier_id);
        })()""")
        page.goto(base + '#/dash'); page.wait_for_selector('.tocheck')
        rows = dict((r.split('\n')[0], r.split('\n')[1]) for r in page.locator('.checkrow').all_inner_texts())
        print('   ', rows)
        check(rows.get('No brand') == '1' and rows.get('No scale') == '1' and rows.get('No product code') == '1', 'counts: no brand 1, no scale 1, no code 1')
        check(rows.get('Not in a storage box') == '1' and rows.get('No colour') == '1', 'counts: not in a box 1, no colour 1')
        check(rows.get('Possible duplicates') == '2', 'possible duplicates: the two Porsche 917 entries (years ignored)')
        check(rows.get('No barcode') == '2', f"no barcode: the two cars whose barcodes were removed ({rows.get('No barcode')})")
        page.locator('.checkrow', has_text='No barcode').click(); page.wait_for_selector('.grid .tile'); page.wait_for_timeout(400)
        check(page.locator('.grid .tile').count() == 2, 'No barcode opens just those 2 cars')
        page.locator('.grid .tile').first.click(); page.wait_for_selector('#pdpDetails')
        check(page.locator('input[aria-label="No barcode on this box"]').is_visible(), 'car without a barcode: the "no barcode" tick box is offered')
        page.check('input[aria-label="No barcode on this box"]'); page.locator('#pdpSave').click(); page.wait_for_timeout(600)
        page.goto(base + '#/dash'); page.wait_for_selector('.tocheck')
        rows = dict((r.split('\n')[0], r.split('\n')[1]) for r in page.locator('.checkrow').all_inner_texts())
        check(rows.get('No barcode') == '1', f"marking 'No barcode on this box' takes it off the list ({rows.get('No barcode')})")
        # a car WITH a barcode: the tick box stays hidden; clearing the barcode brings it back
        mid = page.evaluate("(async () => { const ids = await (await import('./js/store.js')).list('product_identifiers'); return ids.find(i => i.identifier_type === 'barcode' && !i.deleted_at && i.value_raw).model_id; })()")
        page.goto(base + '#/item/' + mid); page.wait_for_selector('#pdpDetails'); page.locator('#pdpDetails summary').first.click() if page.locator('#pdpDetails details:not([open]) summary').count() else None
        page.wait_for_timeout(300)
        check(not page.locator('input[aria-label="No barcode on this box"]').is_visible(), 'car with a barcode: no "no barcode" tick box')
        page.fill('input[placeholder="None yet"]', ''); page.wait_for_timeout(200)
        check(page.locator('input[aria-label="No barcode on this box"]').is_visible(), 'clearing the barcode brings the tick box back')
        page.goto(base + '#/dash'); page.wait_for_selector('.tocheck')
        page.locator('.checkrow', has_text='Possible duplicates').click(); page.wait_for_selector('.grid .tile'); page.wait_for_timeout(500)
        names = page.locator('.grid .tile .nm').all_inner_texts()
        check(len(names) == 2 and all('Porsche 917' in x for x in names), f'tap opens the Garage with just those cars ({names})')
        check(page.locator('.chip.on', has_text='Possible duplicates ✕').count() == 1, 'the active list shows as a chip with ✕')
        page.locator('.chip.on', has_text='Possible duplicates ✕').click(); page.wait_for_timeout(500)
        check(page.locator('.grid .tile').count() == 8, 'tapping ✕ goes back to all cars')
        # speed: 1,500 cars
        page.evaluate(SEED + '(1500)'); t0 = time.time(); page.goto(base + '#/dash'); page.wait_for_selector('.tocheck'); dt = time.time() - t0
        check(dt < 3, f'Dashboard with To check at ~1,500 cars opens in {dt:.2f} s (desktop)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
