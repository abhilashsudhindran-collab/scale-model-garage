"""Developer test for s1-0.45.0: second code on the box (e.g. Hot Wheels "-4B10"): saved apart from the product
code, shown next to it, searchable, cleared by emptying, never used by the duplicate check, synced. Fake Google;
NOT a phone test.

Run:  python3 tests/e2e_secondcode.py
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
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(4)')
        mids = page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).map(m => [m.model_id, m.product_code]))()")
        a, bm = mids[0], mids[1]
        page.goto(base + f'#/item/{a[0]}'); page.wait_for_selector('#pdpDetails')
        page.evaluate("document.querySelector('#pdpDetails details.more').open = true")
        page.fill('input[aria-label="Second code"]', '-4B10'); page.click('#pdpSave'); page.wait_for_timeout(600)
        row = page.evaluate(f"(async () => (await (await import('./js/store.js')).list('product_identifiers')).filter(i => i.model_id === '{a[0]}' && i.identifier_type === 'second_code'))()")
        check(len(row) == 1 and row[0]['value_raw'] == '-4B10', f'saved as a separate second code, exactly as typed ({row[:1]})')
        code_now = page.evaluate(f"(async () => (await (await import('./js/store.js')).get('models', '{a[0]}')).product_code)()")
        check(code_now == a[1], f'product code untouched ({code_now})')
        check(page.locator('.pdp-code .pdp-code2', has_text='-4B10').count() == 1, 'shown next to the product code')
        # same second code on another car: no duplicate warning
        page.goto(base + f'#/item/{bm[0]}'); page.wait_for_selector('#pdpDetails')
        page.evaluate("document.querySelector('#pdpDetails details.more').open = true")
        page.fill('input[aria-label="Second code"]', '-4B10'); page.click('#pdpSave'); page.wait_for_timeout(600)
        dupe = page.evaluate(f"""(async () => {{ const st = await import('./js/store.js'); const m = await st.get('models', '{bm[0]}'); return m.duplicate_check_status; }})()""")
        page.goto(base + '#/dash'); page.wait_for_selector('.tocheck')
        check(page.locator('.tocheck .checkrow', has_text='Possible duplicates').count() == 0, f'a shared second code is not a possible duplicate (status {dupe})')
        # search
        page.goto(base + '#/'); page.wait_for_selector('input[type=search]')
        page.fill('input[type=search]', '4b10'); page.wait_for_timeout(500)
        check(page.locator('.grid .tile').count() == 2, f'search finds cars by second code ({page.locator(".grid .tile").count()})')
        page.fill('input[type=search]', ''); page.wait_for_timeout(200)
        # clear on car B
        page.goto(base + f'#/item/{bm[0]}'); page.wait_for_selector('#pdpDetails')
        page.fill('input[aria-label="Second code"]', ''); page.click('#pdpSave'); page.wait_for_timeout(600)
        left = page.evaluate(f"(async () => (await (await import('./js/store.js')).list('product_identifiers')).filter(i => i.model_id === '{bm[0]}' && i.identifier_type === 'second_code').length)()")
        check(left == 0 and page.locator('.pdp-code2').count() == 0, 'emptying the field removes it (archived)')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => (r.field || r.field_name) === 'second_code').length)()")
        check(log == 3, f'every change logged ({log})')
        # sync
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        page.fill('input[placeholder^="OAuth Client ID"]', 'test-client.apps.googleusercontent.com')
        page.get_by_role('button', name='Sign in & set up').click(); page.wait_for_selector('text=Synced:', timeout=60000)
        book = next(iter(fake.sheets.values())); rows = book.get('PRODUCT_IDENTIFIERS', []); hdr = rows[0] if rows else []
        sc = [r for r in rows[1:] if 'identifier_type' in hdr and r[hdr.index('identifier_type')] == 'second_code']
        check(len(sc) == 2 and any(r[hdr.index('value_raw')] == '-4B10' for r in sc), f'synced to PRODUCT_IDENTIFIERS ({len(sc)} rows incl. the archived one)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
