"""Developer test for s1-0.51.0 / s1-0.52.0 (usability review UR-0.1): no stray "null"/"undefined"/"NaN" text on any screen, the car
page facts row keeps its pills (Dashboard insight styles no longer leak into it) with the barcode inside its pill,
and key controls are at least 44 px tall. Fake Google; NOT a phone test.

Run:  python3 tests/e2e_usability.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

JUNK = r"""(() => { const bad = []; const w = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const t = w.currentNode.textContent; if (/(^|\W)(null|undefined|NaN)(\W|$)|\[object /.test(t)) bad.push(t.trim().slice(0, 60)); } return bad; })()"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, is_mobile=True, has_touch=True)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.dismiss())
        page.goto(base + '#/settings'); page.wait_for_selector('text=Settings')
        page.evaluate(SEED, 12)
        mid = page.evaluate("(async () => (await (await import('./js/store.js')).list('models'))[4].model_id)()")
        screens = [('Garage', '#/', '.tile'), ('Dashboard', '#/dash', '.card.hero'), ('car page', f'#/item/{mid}', '.pdp-head'),
                   ('Needs review', '#/review', 'h2'), ('Split an order', '#/order', 'input[aria-label="Order shipping total"]'),
                   ('Name', '#/name', 'text=Name them'), ('Photo run', '#/run', 'text=Photo run'), ('Add', '#/add', 'text=Quick capture'),
                   ('Settings', '#/settings', 'text=Look'), ('Brands', '#/brands', 'h2'), ('Share', '#/share', 'h2'),
                   ('Showroom', '#/showroom/3', '.sr-info h2'), ('Contents sheet', '#/boxsheet/3', 'text=BOX 3')]
        for label, url, sel in screens:
            page.goto(base + '#/settings'); page.wait_for_selector('text=Settings'); page.goto(base + url); page.wait_for_selector(sel, timeout=15000); page.wait_for_timeout(400)
            junk = page.evaluate(JUNK)
            check(not junk, f'{label}: no stray null/undefined/NaN text {junk[:3]}')
        # Car page facts row: pills, barcode inside its pill
        page.goto(base + '#/settings'); page.goto(base + f'#/item/{mid}'); page.wait_for_selector('.pdp-head'); page.wait_for_timeout(300)
        disp = page.evaluate("getComputedStyle(document.querySelector('.view-item .facts')).display")
        check(disp == 'flex', f'car page facts row uses its own pill layout (display {disp})')
        over = page.evaluate("[...document.querySelectorAll('.view-item .fact')].filter(f => f.scrollWidth > f.clientWidth + 1).map(f => f.innerText)")
        check(not over, f'no fact text spills out of its pill {over}')
        page.goto(base + '#/dash'); page.wait_for_selector('.card.hero'); page.wait_for_timeout(300)
        d2 = page.evaluate("(() => { const f = document.querySelector('.view-dash .facts'); return f ? getComputedStyle(f).display : 'none'; })()")
        check(d2 in ('grid', 'none'), f'Dashboard insight facts keep their grid ({d2})')
        # Tap targets
        page.goto(base + '#/'); page.wait_for_selector('.tile'); page.wait_for_timeout(300)
        hs = page.evaluate("({ seg: document.querySelector('.viewbar .seg').getBoundingClientRect().height, sort: document.querySelector('.viewbar .sortsel').getBoundingClientRect().height })")
        check(all(v >= 44 for v in hs.values()), f'Photos/List and sort are at least 44 px tall {hs}')
        check(page.evaluate("!document.querySelector('#syncBtn')"), 'one sync control in the header: the status pill (s1-0.52.0)')
        # s1-0.52.0 (B: "123"): compact Purchases while no money is recorded, storage boxes in one row, long journey folded
        page.goto(base + '#/settings'); page.goto(base + '#/dash'); page.wait_for_selector('.card.purchases'); page.wait_for_timeout(400)
        pur = page.inner_text('.card.purchases')
        check('no prices yet' in pur and 'Split an order' in pur and '—' not in pur, f'Purchases is one line when nothing is priced ({pur[:80]!r})')
        check(page.locator('.view-dash .shelf.scrollrow').count() == 1, 'Dashboard storage boxes are one swipeable row')
        shown = page.evaluate("[...document.querySelectorAll('.jlist > .jrow')].length"); hidden = page.evaluate("document.querySelectorAll('.jlist .foldrest .jrow').length")
        check(shown == 5 and hidden > 0, f'Box journey shows 5 boxes then Show all ({shown} shown, {hidden} folded)')
        page.locator('.jlist .foldbtn').click(); page.wait_for_timeout(200)
        check(page.evaluate("!document.querySelector('.jlist .foldrest').hidden") and page.inner_text('.jlist .foldbtn') == 'Show fewer', 'Show all opens the rest; button says Show fewer')
        # priced: the full Purchases card comes back
        page.evaluate("(async () => { const st = await import('./js/store.js'); const inv = await st.list('inventory'); await st.update('inventory', inv[0].inventory_id, { purchase_price: '1499' }); })()")
        page.goto(base + '#/settings'); page.goto(base + '#/dash'); page.wait_for_selector('.card.purchases'); page.wait_for_timeout(400)
        pur2 = page.inner_text('.card.purchases')
        check('₹1,499' in pur2 and 'price known for 1 of' in pur2, f'with a price, the full Purchases card shows ({pur2[:80]!r})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED'); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
