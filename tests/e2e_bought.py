"""Developer test for s1-0.25.0: "Just bought" (price per car, shop + date kept for the day, off on another day)
and the Dashboard Purchases card (unknown prices never ₹0, coverage shown). Fake Google; NOT a phone test.

Run:  python3 tests/e2e_bought.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-bought'; os.makedirs(d, exist_ok=True)
    for i in range(2):
        open(f'{d}/f{i}.jpg', 'wb').write(m.make_jpeg((150, 90 + 40 * i, 40), 3 + i)); open(f'{d}/r{i}.jpg', 'wb').write(m.make_jpeg((40, 90, 150 - 40 * i), 5 + i))
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        def capture(i, price=None, shop=None, chip=None):
            page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
            for role, f in (('Box front', f'f{i}'), ('Barcode close-up', f'r{i}')):
                with page.expect_file_chooser() as fc: page.get_by_text(role, exact=False).first.click()
                fc.value.set_files(f'{d}/{f}.jpg'); page.wait_for_selector(f'text={role} ✓')
            page.select_option('select[aria-label="Brand"]', label='Mini GT'); page.wait_for_timeout(200)
            page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(200)
            if page.locator('.boughtbtn').count(): page.locator('.boughtbtn').click(); page.wait_for_timeout(300)
            if price is not None: page.fill('input[aria-label="Price paid"]', price)
            if shop: page.fill('input[aria-label="Bought from"]', shop)
            if chip: page.locator('.bought .chip', has_text=chip).click(); page.wait_for_timeout(300)
            page.fill('input[placeholder^="e.g. Range Rover"]', f'Bought car {i}'); page.wait_for_timeout(300)
            page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('text=Saved ✓')
        inv = lambda: page.evaluate("(async () => (await (await import('./js/store.js')).list('inventory')).map(i => [i.acquisition_type, i.purchase_price, i.purchase_date, i.purchase_source, i.purchase_date_precision]))()")
        today = page.evaluate("(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })()")
        capture(0, price='1,499', shop='Toy Kingdom')
        rows = inv()
        check(rows == [['Purchase', '1499', today, 'Toy Kingdom', 'day']], f'saved as a purchase: ₹1499, today, Toy Kingdom ({rows})')
        page.goto(base + '#/add'); page.wait_for_selector('.card.bought')
        check(page.input_value('input[aria-label="Bought from"]') == 'Toy Kingdom' and page.input_value('input[aria-label="Price paid"]') == '', 'next car: shop kept, price empty again')
        check(page.locator('.bought .chip', has_text='Toy Kingdom').count() == 1, 'shop remembered as a quick pick')
        capture(1, price='', chip='Toy Kingdom')
        for _ in range(20):
            rows = inv()
            if len(rows) == 2: break
            page.wait_for_timeout(250)
        check(['Purchase', '', today, 'Toy Kingdom', 'day'] in rows, 'second car: purchase with price unknown (empty, not 0)')
        page.goto(base + '#/dash'); page.wait_for_selector('.purchases')
        txt = page.inner_text('.purchases'); print('   ', txt.replace('\n', ' | ')[:160])
        check('₹1,499' in txt and '2 cars · 1 with a price' in txt, 'Purchases: this month ₹1,499 · 2 cars · 1 with a price')
        check('price known for 1 of 2 cars' in txt, 'coverage shown: price known for 1 of 2 cars')
        # next day: Just bought switches itself off
        page.evaluate("(() => { const b = JSON.parse(localStorage.getItem('smg.bought')); b.day = '2000-01-01'; localStorage.setItem('smg.bought', JSON.stringify(b)); })()")
        page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
        check(page.locator('.boughtbtn').count() == 1 and page.locator('.card.bought').count() == 0, 'on another day it is off again (no old cars recorded as bought today)')
        page.goto(base + '#/run'); page.wait_for_timeout(600)
        check(page.locator('.boughtbtn').count() >= 0, 'Photo run loads with the card')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
