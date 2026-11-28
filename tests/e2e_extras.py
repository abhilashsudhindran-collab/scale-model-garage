"""Developer test for s1-0.56.0: extra sides after a Photo run car saves, and barcode from any photo.
Headless Chrome at phone size, fake Google; NOT a phone test.

Run:  python3 tests/e2e_extras.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from e2e_p1 import box_rear_with_barcode, EAN
from playwright.sync_api import sync_playwright


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    tmp = '/tmp/smg-extras'; os.makedirs(tmp, exist_ok=True)
    for k, c, s in [('a', (150, 90, 40), 3), ('b', (40, 90, 150), 5), ('c', (90, 150, 40), 7), ('d', (120, 60, 160), 9)]:
        open(f'{tmp}/{k}.jpg', 'wb').write(m.make_jpeg(c, s))
    box_rear_with_barcode(f'{tmp}/bottom_bc.jpg')
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, is_mobile=True, has_touch=True)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        ev = lambda js: page.evaluate(f"(async () => {{ const st = await import('./js/store.js'); {js} }})()")
        def shoot(label, path):
            with page.expect_file_chooser() as fc: page.get_by_role('button', name=label).click()
            fc.value.set_files(path)
        page.goto(base + '#/run'); page.wait_for_selector('text=Photo run')
        page.select_option('select[aria-label=Brand]', label='Hot Wheels'); page.wait_for_timeout(250)
        page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(250)
        page.fill('input.boxin', '5'); page.wait_for_timeout(100)
        page.get_by_role('button', name='Car visible', exact=True).click(); page.wait_for_timeout(200)
        page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(300)
        check(page.is_visible('text=Barcode close-up = the barcode filling about a quarter'), 'hint explains the barcode close-up')
        check(not page.is_visible('.card.extras'), 'no extra-sides card before any car is saved')
        # Car 1: front + a "barcode close-up" with no barcode (barcode is really on the bottom) → saves itself
        shoot('Box front', f'{tmp}/a.jpg'); page.wait_for_selector('button:has-text("Barcode close-up")')
        shoot('Barcode close-up', f'{tmp}/b.jpg'); page.wait_for_selector('text=Car 2 of this run', timeout=15000)
        page.wait_for_selector('.card.extras'); page.wait_for_timeout(1500); page.screenshot(path=f'{tmp}/shot-extras.png')
        check(page.is_visible('text=＋ Another side of car 1? (optional)'), 'after car 1 saves: "＋ Another side of car 1?"')
        chips = page.locator('.card.extras .chip').all_inner_texts()
        check([c.strip() for c in chips] == ['Back', 'Bottom', 'Top', 'End', 'Damage'], f'side choices {chips}')
        mid = ev("return (await st.list('models'))[0].model_id;")
        check(ev(f"return (await st.list('product_identifiers')).filter(i => i.model_id === '{mid}').length;") == 0, 'car 1 has no barcode yet')
        shoot('Bottom', f'{tmp}/bottom_bc.jpg'); page.wait_for_selector('text=1 extra photo added', timeout=15000)
        r = ev(f"""const ph = (await st.list('photos')).filter(p => p.model_id === '{mid}'); const ids = (await st.list('product_identifiers')).filter(i => i.model_id === '{mid}');
          return {{ roles: ph.map(p => p.shot_role).sort(), primary: ph.filter(p => p.is_primary === 'yes').map(p => p.shot_role), bars: ids.map(i => [i.value_cmp, i.source]),
            log: (await st.list('change_log')).filter(c => c.record_id === '{mid}' && c.field === 'barcode').map(c => c.reason) }};""")
        check(r['roles'] == ['box_bottom', 'box_front', 'box_rear'], f"bottom photo added to car 1 {r['roles']}")
        check(r['primary'] == ['box_front'], 'the front stays the main photo')
        check(len(r['bars']) == 1 and r['bars'][0][1] == 'extra_photo' and r['bars'][0][0].endswith(EAN[-12:]), f"barcode read from the bottom photo {r['bars']}")
        check(r['log'] == ['read from the box bottom photo'], f"logged {r['log']}")
        shoot('Back', f'{tmp}/c.jpg'); page.wait_for_selector('text=2 extra photos added', timeout=15000)
        n = ev(f"return (await st.list('product_identifiers')).filter(i => i.model_id === '{mid}').length;")
        check(n == 1, 'a second photo never adds or replaces a barcode')
        # Starting the next car hides the card (extras belong to the car just saved)
        shoot('Box front', f'{tmp}/d.jpg'); page.wait_for_selector('button:has-text("Barcode close-up")')
        check(not page.is_visible('.card.extras'), 'card hidden once the next car is started')
        # Car page ＋ Photo: new roles, and a barcode from a photo there too (on a car without one)
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('.pdp-head')
        opts = page.locator('select:has(option[value="box_bottom"]) option').all_inner_texts()
        check('Box back' in opts and 'Box bottom' in opts and 'Box top' in opts and 'Box end / side' in opts, 'car page ＋ Photo offers the new sides')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
