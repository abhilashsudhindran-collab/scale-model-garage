"""Developer test for s1-0.42.0: Wishlist (add, priority groups, target total, "you may already have this",
Got it / Not any more / Want again / Remove, unsafe links refused, synced to the WISHLIST tab).
Fake Google; NOT a phone test.

Run:  python3 tests/e2e_wishlist.py
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
    dialogs = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda dl: (dialogs.append(dl.message), dl.accept()))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(12)')
        owned = page.evaluate("""(async () => { const st = await import('./js/store.js'); const ms = await st.list('models');
          const m = ms.find(x => x.display_name); await st.update('models', m.model_id, { display_name: 'Nissan Skyline GT-R R34 V-Spec' });
          const br = (await st.list('brands')).find(b => b.brand_id === m.brand_id); return { code: m.product_code, brand: br.name, id: m.model_id }; })()""")

        page.goto(base + '#/dash'); page.wait_for_selector('text=Collection insights')
        check(page.locator('.wishlink').count() == 0, 'Wishlist card hidden on the Dashboard (parked until after the shop check, s1-0.42.1)')
        page.goto(base + '#/wish'); page.wait_for_selector('text=Wishlist')
        check('Nothing here yet' in page.inner_text('body'), 'empty wishlist explains itself')

        def add(name, prio='Medium', code='', price='', url='', brand=''):
            page.get_by_role('button', name='＋ Add a car you want').click(); page.wait_for_selector('.wishform')
            page.fill('.wishform input[aria-label="Car name"]', name)
            if brand: page.select_option('.wishform select[aria-label="Brand"]', label=brand)
            if code: page.fill('.wishform input[aria-label="Product code"]', code)
            if price: page.fill('.wishform input[aria-label="Target price in rupees"]', price)
            if url: page.fill('.wishform input[aria-label="Link"]', url)
            page.locator('.wishform .chip', has_text=prio).click()
            page.get_by_role('button', name='Add to wishlist').click(); page.wait_for_timeout(500)

        # unsafe link refused, nothing saved
        add('Bad link car', url='javascript:alert(1)')
        check(page.locator('.wishform').count() == 1 and page.evaluate("(async () => (await (await import('./js/store.js')).list('wishlist')).length)()") == 0, 'a javascript: link is refused; nothing saved')
        page.get_by_role('button', name='Cancel').click(); page.wait_for_timeout(300)

        add('Porsche 911 GT3 RS', prio='High', price='₹1,250', url='www.example.com/item?id=4')
        add('Skyline R34', prio='Low')
        add('Exact code car', prio='Medium', code=owned['code'].lower(), brand=owned['brand'])
        heads = page.locator('.ghead .g-name').all_inner_texts()
        check(heads == ['High priority', 'Medium', 'Low'], f'grouped by priority, high first ({heads})')
        check('Target prices add up to ₹1,250 · price set for 1 of 3' in page.inner_text('body'), 'target total shows how many have a price')
        porsche = page.locator('.wish', has_text='Porsche 911')
        check(porsche.locator('a', has_text='Open link').get_attribute('href') == 'https://www.example.com/item?id=4', 'link saved as a safe https address')
        check(porsche.locator('.wmatch').count() == 0, 'no false "already have" on an unrelated car')
        sky = page.locator('.wish', has_text='Skyline R34')
        check('You may already have this' in sky.inner_text() and 'Nissan Skyline GT-R R34 V-Spec' in sky.inner_text(), 'name match → "You may already have this" with a link to the car')
        ex = page.locator('.wish', has_text='Exact code car')
        check('You already have this code' in ex.inner_text(), 'same code and brand → "You already have this code"')
        sky.locator('.wmatch a').first.click(); page.wait_for_selector('.pdp-actions')
        check(owned['id'] in page.url, 'match link opens your car')

        page.goto(base + '#/wish'); page.wait_for_selector('.wish')
        page.locator('.wish', has_text='Porsche 911').get_by_role('button', name='✓ Got it').click(); page.wait_for_timeout(500)
        page.locator('.wish', has_text='Skyline R34').get_by_role('button', name='Not any more').click(); page.wait_for_timeout(500)
        check(page.inner_text('details.more summary') == 'Got / dropped · 2', 'Got it and Not any more move cars to Got / dropped')
        st = page.evaluate("(async () => Object.fromEntries((await (await import('./js/store.js')).list('wishlist')).map(w => [w.object_name, w.status])))()")
        check(st.get('Porsche 911 GT3 RS') == 'got' and st.get('Skyline R34') == 'dropped', f'statuses saved ({st})')
        page.locator('details.more summary').click()
        page.locator('.wish', has_text='Skyline R34').get_by_role('button', name='Want again').click(); page.wait_for_timeout(500)
        check(page.locator('.ghead .g-name', has_text='Low').count() == 1, 'Want again puts it back')
        # edit
        page.locator('.wish', has_text='Exact code car').get_by_role('button', name='Edit').click(); page.wait_for_selector('.wishform')
        page.fill('.wishform input[aria-label="Car name"]', 'Exact code car (blue)'); page.get_by_role('button', name='Save', exact=True).click(); page.wait_for_timeout(500)
        check(page.locator('.wish', has_text='Exact code car (blue)').count() == 1, 'edit saves')
        page.locator('details.more summary').click()
        page.locator('.wish', has_text='Porsche 911').get_by_role('button', name='Remove').click(); page.wait_for_timeout(500)
        check(page.locator('.wish', has_text='Porsche 911').count() == 0, 'Remove takes it off (archived, after asking)')
        if os.environ.get('SHOTS'): page.goto(base + '#/wish'); page.wait_for_selector('.wish'); page.wait_for_timeout(300); page.screenshot(path='/tmp/wish.png', full_page=True)

        # sync to the WISHLIST tab
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        page.fill('input[placeholder^="OAuth Client ID"]', 'test-client.apps.googleusercontent.com')
        page.get_by_role('button', name='Sign in & set up').click(); page.wait_for_selector('text=Synced:', timeout=60000)
        book = next(iter(fake.sheets.values()))
        rows = book.get('WISHLIST', [])
        hdr = rows[0] if rows else []
        names = [r[hdr.index('object_name')] for r in rows[1:]] if 'object_name' in hdr else []
        check('Exact code car (blue)' in names and 'Skyline R34' in names and len(rows) == 4, f'synced to the WISHLIST tab, removed one kept as archived ({names})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
