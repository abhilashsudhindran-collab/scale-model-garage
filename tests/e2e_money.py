"""Developer test for s1-0.48.0: orders and money (D12.1): events per copy (sold with fees, refund, repair, gift,
undo), owned counts, order shipping split by price with editable shares, Purchases totals with coverage, synced.
Fake Google; NOT a phone test.

Run:  python3 tests/e2e_money.py
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
        page.on('dialog', lambda d: d.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(4)')
        ids = page.evaluate("""(async () => { const st = await import('./js/store.js'); const inv = (await st.list('inventory')).sort((a, b) => a.created_at.localeCompare(b.created_at));
          const prices = ['1000', '500', '1500', ''];
          for (const [k, i] of inv.entries()) await st.update('inventory', i.inventory_id, { purchase_price: prices[k], currency: 'INR', purchase_date: '2026-11-2' + k });
          return inv.map(i => [i.inventory_id, i.model_id]); })()""")
        # order split over the first three cars: ₹300 → 100 / 50 / 150
        page.goto(base + '#/dash'); page.wait_for_selector('text=Split an order')
        page.locator('a', has_text="Split an order").click(); page.wait_for_selector('.orderlist')
        page.fill('input[aria-label="Order shipping total"]', '300')
        rows = page.locator('.orderlist .pickrow')
        names = page.evaluate("""(async () => { const st = await import('./js/store.js'); const ms = await st.list('models'); return Object.fromEntries(ms.map(m => [m.model_id, m.display_name || m.product_code])); })()""")
        for k in range(3):
            page.locator('.orderlist .pickrow', has_text=names[ids[k][1]] or 'Car with no name yet').first.locator('input').check()
        shares = [float(x) for x in page.locator('input.share').evaluate_all('els => els.map(e => e.value)')]
        check(sorted(shares) == [50.0, 100.0, 150.0], f'₹300 split by price ({shares})')
        page.locator('input.share').first.fill('120'); page.locator('input.share').first.dispatch_event('change'); page.wait_for_timeout(200)
        check('Shares add up to' in page.inner_text('body'), 'edited shares that don\'t add up are flagged')
        page.locator('input.share').first.fill(str(shares[0])); page.locator('input.share').first.dispatch_event('change'); page.wait_for_timeout(200)
        page.get_by_role('button', name='Save order').click(); page.wait_for_selector('.purchases')
        ac = page.evaluate(f"(async () => (await (await import('./js/store.js')).get('inventory', '{ids[0][0]}')).acquisition_costs)()")
        check(ac == '100', f'share saved to the copy as shipping ({ac})')
        pt = page.inner_text('.purchases')
        check('₹3,300' in pt and 'known for 3 of 4 cars owned' in pt, f'cost incl. shipping, with coverage ({pt[:160]!r})')
        # car 1: refund 200, repair 300, sold 2000 with 100 fees
        page.goto(base + f'#/item/{ids[0][1]}'); page.wait_for_selector('.copy')
        page.evaluate("document.querySelectorAll('details.copy').forEach(d => d.open = true)")
        def event(kind, amount='', fees=''):
            page.get_by_role('button', name='＋ Sold, gift, refund, repair…').first.click()
            page.select_option('select[aria-label="What happened"]', label=kind)
            if amount: page.fill('input[aria-label="Amount"]', amount)
            if fees: page.fill('input[aria-label="Fees"]', fees)
            page.get_by_role('button', name='Save event').click(); page.wait_for_timeout(600)
            page.evaluate("document.querySelectorAll('details.copy').forEach(d => d.open = true)")
        event('Refund received', '200'); event('Repair / extra cost', '300')
        mb = page.inner_text('.moneyblk')
        check('Paid ₹1,000 + ₹100 shipping/fees − ₹200 refund = ₹900 cost' in mb and 'Repairs / extras: ₹300' in mb, f'cost line + repairs apart ({mb[:140]!r})')
        event('Sold', '2000', '100')
        mb = page.inner_text('.moneyblk')
        check('Sold: ₹1,900 after fees' in mb and 'gain ₹1,000' in mb and 'vs acquisition cost' in mb, f'sold: proceeds and gain vs acquisition cost ({mb[:200]!r})')
        st = page.evaluate(f"(async () => (await (await import('./js/store.js')).get('inventory', '{ids[0][0]}')).ownership_status)()")
        check(st == 'Sold', 'copy marked Sold')
        # undo the sale
        page.locator('.moneyblk .txrow', has_text='Sold').get_by_role('button', name='Undo').click(); page.wait_for_timeout(600)
        st = page.evaluate(f"(async () => (await (await import('./js/store.js')).get('inventory', '{ids[0][0]}')).ownership_status)()")
        check(st == 'Owned', 'undo puts it back to Owned')
        page.evaluate("document.querySelectorAll('details.copy').forEach(d => d.open = true)")
        event('Sold', '2000', '100')
        # car 4 (no price): gift
        page.goto(base + f'#/item/{ids[3][1]}'); page.wait_for_selector('.copy')
        page.evaluate("document.querySelectorAll('details.copy').forEach(d => d.open = true)")
        event('Gave it away')
        page.goto(base + '#/dash'); page.wait_for_selector('.purchases')
        pt = page.inner_text('.purchases')
        check('₹2,200' in pt and 'known for 2 of 2 cars owned' in pt, f'sold and gifted copies leave the owned cost ({pt[:200]!r})')
        check('1 car · gain ₹1,000 on 1' in pt and 'Repairs / extras' in pt and 'Given away' in pt, 'sold, repairs and gifts each shown')
        if os.environ.get('SHOTS'): page.locator('.purchases').screenshot(path='/tmp/money.png')
        # sync
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        page.fill('input[placeholder^="OAuth Client ID"]', 'test-client.apps.googleusercontent.com')
        page.get_by_role('button', name='Sign in & set up').click(); page.wait_for_selector('text=Synced:', timeout=60000)
        book = next(iter(fake.sheets.values()))
        tx = book.get('TRANSACTIONS', []); od = book.get('ORDERS', [])
        check(len(tx) - 1 == 5 and len(od) - 1 == 1, f'events and order synced ({len(tx) - 1} transactions incl. the undone one, {len(od) - 1} order)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
