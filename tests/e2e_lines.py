"""Developer test for s1-0.47.0: product lines (car page line picker filtered by brand, code-start hint,
new line, brand change clears the line, tile + search + By line group, Brands screen lines, insights card,
duplicate check unchanged, synced). Fake Google; NOT a phone test.

Run:  python3 tests/e2e_lines.py
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
        dialogs = []
        def on_dialog(d):
            dialogs.append(d.message); d.accept('Premium' if d.type == 'prompt' else None) if d.type == 'prompt' else d.accept()
        page.on('dialog', on_dialog)
        # sign in first so the seeded lines (Kaido House etc.) exist
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        page.fill('input[placeholder^="OAuth Client ID"]', 'test-client.apps.googleusercontent.com')
        page.get_by_role('button', name='Sign in & set up').click(); page.wait_for_selector('text=Synced:', timeout=60000)
        page.evaluate(SEED + '(12)')
        car = page.evaluate("""(async () => { const st = await import('./js/store.js'); const br = await st.list('brands');
          const mgt = br.find(b => b.name === 'Mini GT'); const ms = (await st.list('models')).filter(m => m.brand_id === mgt.brand_id);
          await st.update('models', ms[0].model_id, { product_code: 'KHMG123', product_code_cmp: 'KHMG123' }); return { id: ms[0].model_id, other: ms[1]?.model_id }; })()""")
        page.goto(base + f'#/item/{car["id"]}'); page.wait_for_selector('#pdpDetails')
        opts = page.locator('select[aria-label="Product line"] option').all_inner_texts()
        check('Kaido House' in opts and 'Hobby64' not in opts, f'only Mini GT lines offered ({opts})')
        check(page.locator('#pdpDetails .banner', has_text='Code starts like Kaido House').count() == 1, 'KHMG code → "starts like Kaido House" hint')
        page.locator('#pdpDetails .banner button', has_text='Set Kaido House').click()
        page.click('#pdpSave'); page.wait_for_timeout(600)
        lid = page.evaluate(f"(async () => {{ const st = await import('./js/store.js'); const m = await st.get('models', '{car['id']}'); const l = (await st.list('product_lines')).find(x => x.line_id === m.line_id); return [l?.name, m.duplicate_check_status, m.code_namespace_type]; }})()")
        check(lid[0] == 'Kaido House' and lid[2] == 'brand', f'line saved; duplicate check still by brand ({lid})')
        # new line via ＋ New line… (prompt answered "Premium")
        page.goto(base + f'#/item/{car["other"]}'); page.wait_for_selector('#pdpDetails')
        page.select_option('select[aria-label="Product line"]', '__new'); page.wait_for_timeout(500)
        check(page.input_value('select[aria-label="Product line"]') != '' and 'Premium' in page.locator('select[aria-label="Product line"]').inner_text(), 'new line created and picked')
        page.click('#pdpSave'); page.wait_for_timeout(600)
        # brand change clears the line
        page.evaluate("document.querySelector('#pdpDetails select').scrollIntoView()")
        page.select_option('#pdpDetails select >> nth=0', label='Bburago'); page.wait_for_timeout(300)
        check(page.input_value('select[aria-label="Product line"]') == '', 'changing the brand clears the line')
        page.select_option('#pdpDetails select >> nth=0', label='Mini GT'); page.wait_for_timeout(300)
        page.select_option('select[aria-label="Product line"]', label='Premium'); page.click('#pdpSave'); page.wait_for_timeout(600)
        page.goto(base + '#/'); page.wait_for_selector('.grid .tile')
        check(page.locator('.grid .tile .sub', has_text='Mini GT · Kaido House').count() == 1, 'tile shows brand · line')
        page.locator('.chip', has_text='By line').click(); page.wait_for_timeout(400)
        g = page.locator('.grid .group .g-name').all_inner_texts()
        check(g[:2] == ['Mini GT · Kaido House', 'Mini GT · Premium'] and g[-1] == 'No line set', f'By line groups, no line last ({g})')
        page.locator('.chip', has_text='All').first.click(); page.fill('input[type=search]', 'kaido'); page.wait_for_timeout(400)
        check(page.locator('.grid .tile').count() == 1, 'search finds by line name')
        page.fill('input[type=search]', '')
        # Brands screen
        page.goto(base + '#/brands'); page.wait_for_selector('.brandrow')
        page.locator('.brandhead', has_text='Mini GT').click(); page.wait_for_selector('.lines')
        lt = page.inner_text('.lines')
        check('Kaido House' in lt and 'codes start KHMG' in lt and 'Premium' in lt and '1 car' in lt, f'Brands shows lines with counts ({lt[:80]!r})')
        page.goto(base + '#/dash'); page.wait_for_selector('text=Collection insights')
        check('Line set for 2 of 12 cars' in page.inner_text('body'), 'By product line insight with coverage')
        # sync
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        page.get_by_role('button', name='Sync now').first.click(); page.wait_for_timeout(3000)
        book = next(iter(fake.sheets.values())); rows = book.get('PRODUCT_LINES', []); hdr = rows[0]
        names = [r[hdr.index('name')] for r in rows[1:]]
        check('Premium' in names and 'Kaido House' in names, f'lines synced to PRODUCT_LINES ({names})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
