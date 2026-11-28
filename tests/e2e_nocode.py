"""Developer test for s1-0.58.0: "No product code on this box". A car with no code shows a tick under the product
code; ticking it takes the car off To check → No product code, counts it in Data health, keeps it out of the Gemini
round and "Ask Gemini again", shows "No product code on this box" on the car page and is logged; typing a code clears
the tick; the tick is hidden while a code is present; sync adds the code_absent column to an existing sheet.
Fake Google; NOT a phone test.

Run:  python3 tests/e2e_nocode.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'
TICK = 'input[aria-label="No product code on this box"]'


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        ev = page.evaluate
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        ev(SEED + '(6)')
        # First sync with the column NOT in the sheet yet: simulate an older sheet by syncing, then dropping the header
        ev(f"localStorage.setItem('smg.clientId', '{CID}')")
        page.click('#status')
        for _ in range(150):
            if page.inner_text('#status') == 'All synced': break
            page.wait_for_timeout(200)
        sid = next(iter(fake.sheets)); hdr = fake.sheets[sid]['MODELS'][0]
        if 'code_absent' in hdr:  # make it an "old" sheet without the column
            k = hdr.index('code_absent')
            for row in fake.sheets[sid]['MODELS']:
                if len(row) > k: del row[k]
        check('code_absent' not in fake.sheets[sid]['MODELS'][0], 'starting from a sheet without the new column')
        # Two cars without a code; Gemini already asked both (so both would show under "Ask Gemini again")
        ids = ev("""(async () => { const st = await import('./js/store.js'); const ms = (await st.list('models')).sort((a, b) => a.created_at.localeCompare(b.created_at));
          for (const x of ms) await st.update('models', x.model_id, { display_name: x.display_name || 'Car', colour_family: 'red', car_note: 'A note.', car_note_source: 'gemini' }); // everything else done …
          for (const x of ms.slice(0, 2)) await st.update('models', x.model_id, { product_code: '', product_code_cmp: '' }); // … except two codes
          const { meta } = await import('./js/idb.js'); const a = {}; ms.slice(0, 2).forEach(x => a[x.model_id] = Date.now()); await meta.set('aiAsked', a);
          return ms.slice(0, 2).map(x => x.model_id); })()""")
        page.goto(base + '#/dash'); page.wait_for_selector('.tocheck')
        rows = dict((r.split('\n')[0], r.split('\n')[1]) for r in page.locator('.checkrow').all_inner_texts())
        check(rows.get('No product code') == '2', f"To check → No product code lists both ({rows.get('No product code')})")
        page.goto(base + '#/name'); page.wait_for_selector('text=Name them'); page.wait_for_timeout(500)
        check('Ask Gemini again (2)' in page.inner_text('main'), 'Ask Gemini again offers both')
        # Tick on car 1
        page.goto(base + '#/item/' + ids[0]); page.wait_for_selector('#pdpDetails'); page.wait_for_timeout(300)
        check(page.locator(TICK).is_visible(), 'car without a code: the tick is offered under the product code')
        page.check(TICK); page.locator('#pdpSave').click(); page.wait_for_timeout(700)
        st = ev(f"""(async () => {{ const st = await import('./js/store.js'); const mm = (await st.list('models')).find(x => x.model_id === '{ids[0]}');
          const log = (await st.list('change_log')).filter(c => c.record_id === '{ids[0]}' && c.field === 'code_absent').map(c => c.new_value); return [mm.code_absent, log]; }})()""")
        check(st[0] == 'yes' and 'yes' in st[1], f'saved and logged {st}')
        page.goto(base + '#/settings'); page.goto(base + '#/item/' + ids[0]); page.wait_for_selector('#pdpDetails'); page.wait_for_timeout(300)
        check(page.locator(TICK).is_checked(), 'the tick stays ticked after reopening the car page')
        page.goto(base + '#/dash'); page.wait_for_selector('.tocheck')
        rows = dict((r.split('\n')[0], r.split('\n')[1]) for r in page.locator('.checkrow').all_inner_texts())
        check(rows.get('No product code') == '1', f"ticked car leaves the No product code list ({rows.get('No product code')})")
        page.goto(base + '#/name'); page.wait_for_selector('text=Name them'); page.wait_for_timeout(500)
        check('Ask Gemini again (1)' in page.inner_text('main'), 'ticked car is no longer offered to Gemini again')
        # Sync: the column is added to the old sheet, the value written
        page.click('#status')
        for _ in range(150):
            if page.inner_text('#status') == 'All synced': break
            page.wait_for_timeout(200)
        sh = fake.sheets[sid]['MODELS']; hdr = sh[0]
        row = next((r for r in sh[1:] if r and r[0] == ids[0]), None) if hdr[0] == 'model_id' else None
        val = row[hdr.index('code_absent')] if row and 'code_absent' in hdr and len(row) > hdr.index('code_absent') else None
        check('code_absent' in hdr and val == 'yes', f'sync added the code_absent column to the old sheet and wrote "yes" ({val})')
        # Typing a code clears the tick; with a code the tick is hidden
        page.goto(base + '#/item/' + ids[0]); page.wait_for_selector('#pdpDetails'); page.wait_for_timeout(300)
        page.fill('input[autocapitalize="characters"]', 'SH-001'); page.wait_for_timeout(200)
        check(not page.locator(TICK).is_visible(), 'typing a code hides the tick')
        page.locator('#pdpSave').click(); page.wait_for_timeout(700)
        ca = ev(f"(async () => (await (await import('./js/store.js')).list('models')).find(x => x.model_id === '{ids[0]}').code_absent)()")
        check(ca == '', f'a typed code clears "no product code" ({ca!r})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED'); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
