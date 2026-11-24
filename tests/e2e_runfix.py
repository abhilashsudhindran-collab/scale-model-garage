"""Developer test for s1-0.15.1 (B's phone, 24 Nov 18:03): in a mixed box after the app reloaded, a car took an old
brand ("Bburago") without asking; and Photo run had no way to discard or retake. NOT a phone test.

Run:  python3 tests/e2e_runfix.py
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
    os.makedirs('/tmp/smg-runfix', exist_ok=True)
    open('/tmp/smg-runfix/f.jpg', 'wb').write(m.make_jpeg((150, 90, 40), 3)); open('/tmp/smg-runfix/r.jpg', 'wb').write(m.make_jpeg((40, 90, 150), 5))
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        nmod = lambda: page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).length)()")
        def shoot(role, f):
            with page.expect_file_chooser() as fc: page.get_by_role('button', name=role).click()
            fc.value.set_files(f'/tmp/smg-runfix/{f}.jpg'); page.wait_for_timeout(900)

        # Bburago remembered as a recent brand (as on B's phone), then a mixed-brand, 1:43 box
        page.evaluate("(async () => { const st = await import('./js/store.js'); const br = await st.list('brands'); localStorage.setItem('smg.recentBrands', JSON.stringify([br.find(b => b.name === 'Bburago').brand_id])); })()")
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        page.locator('.boxcard .chip', has_text='Mixed brands').click(); page.wait_for_timeout(300)
        page.locator('.boxcard .chip', has_text='Only 1:43').click(); page.wait_for_timeout(300)
        page.get_by_role('button', name='Fill Box 1').click(); page.wait_for_selector('.banner.fill')
        if page.is_visible('text=Done: start shooting'):
            page.get_by_role('button', name='Car visible', exact=True).click(); page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(200)

        # The app reloads (as Chrome does while the camera is open), then the car is shot
        page.reload(); page.wait_for_selector('text=Photo run')
        check('brand after photos' in page.inner_text('.runhead') and 'Bburago' not in page.inner_text('.runhead'), f"after a reload the car has no brand yet ({page.inner_text('.runhead')!r})")
        shoot('Box front', 'f')
        page.reload(); page.wait_for_selector('text=Photo run')
        check('Box front ✓' in page.inner_text('.shots') and 'Bburago' not in page.inner_text('.runhead'), 'half-done car survives a reload, still without a brand')
        shoot('Box rear', 'r')
        check(page.is_visible('text=Which brand is this car?') and nmod() == 0, 'mixed box: asks the brand (nothing saved with an old brand)')

        # Retake one photo by tapping it
        page.get_by_role('button', name='Box front: tap to retake').click(); page.wait_for_timeout(500)
        check('Box front ✓' not in page.inner_text('.shots') and 'Box rear ✓' in page.inner_text('.shots'), 'tap a photo: retake just that photo')
        shoot('Box front', 'f'); page.wait_for_selector('text=Which brand is this car?')
        # Discard the whole car
        page.get_by_role('button', name='Discard this car').click(); page.wait_for_timeout(500)
        check('✓' not in page.inner_text('.shots') and nmod() == 0 and page.is_visible('text=Car discarded'), 'Discard this car: photos gone, nothing saved')
        # A normal car afterwards still works: brand asked, then saved
        shoot('Box front', 'f'); shoot('Box rear', 'r'); page.wait_for_selector('text=Which brand is this car?')
        page.select_option('select[aria-label="Brand for this car"]', label='Mini GT'); page.wait_for_timeout(1200)
        if page.is_visible('text=Different model: save new'): page.get_by_role('button', name='Different model: save new').click(); page.wait_for_timeout(800)
        got = page.evaluate("(async () => { const st = await import('./js/store.js'); const m = (await st.list('models'))[0]; const br = await st.list('brands'); const sc = await st.list('scales'); return m ? br.find(b => b.brand_id === m.brand_id).name + ' ' + sc.find(s => s.scale_id === m.scale_id).label : null; })()")
        check(got == 'Mini GT 1:43', f'car saved with the picked brand and the box scale ({got})')
        page.screenshot(path='/tmp/smg-runfix/after.png')
        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:2]})')
        b.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}"); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
