"""Developer test for release s1-0.5.0 (Photo run + Name them). NOT a phone acceptance test.
Headless Chrome at phone size against the FAKE Google from e2e_mock.py. Needs: pip install python-barcode.

Run:  python3 tests/e2e_p3.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from e2e_p1 import box_rear_with_barcode, EAN
from playwright.sync_api import sync_playwright

SHOTS = '/tmp/smg-p3'


def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)

    httpd = m.serve()
    fake = m.FakeGoogle()
    tmp = '/tmp/smg-p3-img'; os.makedirs(tmp, exist_ok=True); os.makedirs(SHOTS, exist_ok=True)
    for k, c, s in [('a', (150, 90, 40), 3), ('b', (40, 90, 150), 5), ('c', (90, 150, 40), 7)]:
        open(f'{tmp}/{k}.jpg', 'wb').write(m.make_jpeg(c, s))
    box_rear_with_barcode(f'{tmp}/rear_bc.jpg')
    base = f'http://localhost:{m.PORT}/'

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 400, 'height': 860}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle)
        ctx.route('https://sheets.googleapis.com/**', fake.handle)
        ev = lambda js: page.evaluate(js)
        listm = lambda: ev("(async () => (await (await import('./js/store.js')).list('models')))()")

        def shoot(label, path):
            with page.expect_file_chooser() as fc:
                page.get_by_role('button', name=f'📷 {label}').click()
            fc.value.set_files(path)

        def wait_for(cond, ms=8000):
            for _ in range(ms // 100):
                if cond(): return True
                page.wait_for_timeout(100)
            return False

        # Entry point from Quick capture
        page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
        page.get_by_text('Photo run: photos now, names later').click(); page.wait_for_selector('text=Photo run')
        check(page.is_visible('text=for this run to start'), 'run asks for brand and scale first')

        # Run settings
        page.select_option('select[aria-label=Brand]', label='Mini GT'); page.wait_for_timeout(250)
        page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(250)
        page.fill('input.boxin', '3'); page.wait_for_timeout(100)
        page.get_by_role('button', name='Car visible', exact=True).click(); page.wait_for_timeout(250)
        page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(300)
        check(page.is_visible('text=Car 1 of this run'), 'run ready: "Car 1 of this run"')
        vis = page.evaluate("(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('📷 Box front')); const r = b.getBoundingClientRect(); return r.bottom <= innerHeight - 84; })()")
        check(vis, 'camera button visible without scrolling once settings fold away')
        page.screenshot(path=f'{SHOTS}/01-run-ready.png')

        # Box 1: front + rear with barcode -> saves itself
        shoot('Box front', f'{tmp}/a.jpg'); page.wait_for_selector('button:has-text("📷 Box rear")')
        shoot('Box rear', f'{tmp}/rear_bc.jpg')
        check(wait_for(lambda: page.is_visible('text=Car 2 of this run')), 'box 1 saved itself after the rear photo')
        ms = listm()
        check(len(ms) == 1 and ms[0]['display_name'] == '', f'box 1 saved without a name ({len(ms)} model)')
        inv = ev("(async () => (await (await import('./js/store.js')).list('inventory')).map(i => i.storage_location))()")
        bcs = ev("(async () => (await (await import('./js/store.js')).list('product_identifiers')).map(i => i.value_raw))()")
        check(inv == ['Box 3'] and bcs == [EAN], f'box 1 has storage box and barcode from the rear photo ({inv}, {bcs})')

        # Box 2: no barcode
        shoot('Box front', f'{tmp}/c.jpg'); page.wait_for_selector('button:has-text("📷 Box rear")')
        shoot('Box rear', f'{tmp}/b.jpg')
        check(wait_for(lambda: page.is_visible('text=Car 3 of this run')), 'box 2 saved itself')

        # Box 3: same barcode as box 1 -> run pauses, "Different model" saves new
        shoot('Box front', f'{tmp}/b.jpg'); page.wait_for_selector('button:has-text("📷 Box rear")')
        shoot('Box rear', f'{tmp}/rear_bc.jpg')
        check(wait_for(lambda: page.is_visible('text=You may already own this')), 'same barcode pauses the run with a choice')
        page.screenshot(path=f'{SHOTS}/02-run-match.png')
        page.get_by_role('button', name='Different model: save new').click()
        check(wait_for(lambda: page.is_visible('text=Car 4 of this run')), '"Different model" saves it as new')
        check(len(listm()) == 3, 'three models after box 3')

        # Undo last car
        page.get_by_role('button', name='Undo last car (car 3)').click(); page.wait_for_timeout(600)
        active = [x for x in listm()]
        check(len(active) == 2, f'"Undo last car" archives box 3 ({len(active)} active)')

        # Box 4: same barcode -> add as copy, no new model
        shoot('Box front', f'{tmp}/c.jpg'); page.wait_for_selector('button:has-text("📷 Box rear")')
        shoot('Box rear', f'{tmp}/rear_bc.jpg')
        wait_for(lambda: page.is_visible('text=You may already own this'))
        n_inv = len(ev("(async () => (await (await import('./js/store.js')).list('inventory')))()"))
        page.get_by_role('button', name='Same model: add as copy').click(); page.wait_for_selector('text=Added as another copy'); page.wait_for_timeout(400)
        n_inv2 = len(ev("(async () => (await (await import('./js/store.js')).list('inventory')))()"))
        check(len(listm()) == 2 and n_inv2 == n_inv + 1, f'"Same model" adds a copy, no new model (copies {n_inv} -> {n_inv2})')

        # Sealed run: box art step, skippable
        page.get_by_role('button', name='Change').click(); page.wait_for_timeout(200)
        page.get_by_role('button', name='Sealed box', exact=True).click(); page.wait_for_timeout(300)
        page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(300)
        shoot('Box front', f'{tmp}/a.jpg'); page.wait_for_selector('button:has-text("📷 Box rear")')
        shoot('Box rear', f'{tmp}/b.jpg'); page.wait_for_selector('button:has-text("📷 Box art")')
        check(page.get_by_role('button', name='Skip box art').count() == 1, 'sealed run asks for box art, with Skip')
        page.get_by_role('button', name='Skip box art').click()
        check(wait_for(lambda: len(listm()) == 3), 'skipping box art saves the box')
        times = ev("(async () => (await (await import('./js/idb.js')).meta.get('captureTimesV2', [])))()")
        check(len(times) == 5, f'capture time logged for each saved box or copy ({len(times)})')

        # Garage shows what needs a name
        page.goto(base + '#/'); page.wait_for_selector('.tile'); page.wait_for_timeout(300)
        check(page.locator('.chips.scroll .chip', has_text='Needs a name (3)').count() == 1, 'Garage chip "Needs a name (3)"')
        check(page.is_visible('text=3 boxes need a name: name them'), 'Garage link to name them')

        # Name them
        page.get_by_text('3 boxes need a name: name them').click(); page.wait_for_selector('text=Name them')
        page.screenshot(path=f'{SHOTS}/03-name-them.png')
        page.fill('input[aria-label=Name]', 'Range Rover Camel Trophy'); page.fill('input[aria-label="Product code"]', 'MGT01311-L')
        page.get_by_role('button', name='Save & next').click(); page.wait_for_timeout(500)
        check(page.is_visible('text=2 boxes need a name'), 'Save & next moves to the next nameless box')
        page.get_by_role('button', name='Skip').click(); page.wait_for_timeout(300)
        page.fill('input[aria-label=Name]', 'Porsche 911 GT3'); page.get_by_role('button', name='Save & next').click(); page.wait_for_timeout(500)
        page.fill('input[aria-label=Name]', 'Honda NSX'); page.press('input[aria-label=Name]', 'Enter'); page.press('input[aria-label="Product code"]', 'Enter'); page.wait_for_timeout(500)
        check(page.is_visible('text=Every box has a name'), 'all boxes named')
        named = sorted(x['display_name'] for x in listm())
        check(named == ['Honda NSX', 'Porsche 911 GT3', 'Range Rover Camel Trophy'], f'names saved ({named})')
        code = [x for x in listm() if x['display_name'].startswith('Range')][0]
        check(code['product_code'] == 'MGT01311-L' and code['duplicate_check_status'] == 'checkable', 'code saved and now duplicate-checkable')

        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:3]})')
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
