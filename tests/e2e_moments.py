"""Developer test for s1-0.35.0: open-box selection (A + C) and moments (drive-in, milestone flag, packed, start
lights), plus the Off switch. Fake Google; NOT a phone test (feel and timing need B's eye).

Run:  python3 tests/e2e_moments.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-mom'; os.makedirs(d, exist_ok=True); t0 = time.time() - 3600
    for k in range(2):
        open(f'{d}/p{k}.jpg', 'wb').write(m.make_jpeg((70 + 50 * k, 120, 160), 4 + k)); os.utime(f'{d}/p{k}.jpg', (t0 + k * 10, t0 + k * 10))
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, reduced_motion='no-preference')
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.evaluate(f"localStorage.setItem('smg.clientId', '{CID}')")
        page.evaluate(SEED + '(24)'); page.evaluate("localStorage.setItem('smg.milestone', '24')")
        # selection: A + C
        page.reload(); page.wait_for_selector('.shelfhome .boxtile:not(.newbox)')
        page.locator('.shelfhome .boxtile', has_text='Box 2').first.click(); page.wait_for_selector('.boxcard'); page.wait_for_timeout(500)
        os.environ.get('SHOTS') and page.locator('.shelfhome').screenshot(path='/tmp/mom-sel.png')
        sel = page.locator('.shelfhome .boxtile.sel')
        check(sel.count() == 1 and sel.locator('.selck').count() == 1, 'open box: tick badge')
        check(page.locator('.shelfhome .shelf.hassel').count() == 1, 'shelf knows a box is open')
        op = page.evaluate("getComputedStyle(document.querySelector('.shelfhome .boxtile:not(.sel):not(.newbox)')).opacity")
        tr = page.evaluate("getComputedStyle(document.querySelector('.shelfhome .boxtile.sel')).transform")
        rim = page.evaluate("getComputedStyle(document.querySelector('.shelfhome .boxtile.sel svg .rim')).fill")
        check(float(op) < 0.6, f'other boxes fade back (opacity {op})')
        check(tr not in ('none', '') and '-6' in tr, f'open box lifts ({tr})')
        check(rim.startswith('rgb(47, 106, 79)'), f'open box lid filled with the accent ({rim})')
        # import 1 car into Box 2 → drive-in, then the 25-car flag
        page.locator('.boxcard button', has_text='📥 Import photos into Box').click(); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(300)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(300)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f'{d}/p0.jpg', f'{d}/p1.jpg']); page.wait_for_selector('.importgrid')
        page.get_by_role('button', name='Import 1 car').click()
        page.wait_for_selector('.m-drive', timeout=20000)
        os.environ.get('SHOTS') and (page.wait_for_timeout(700), page.screenshot(path='/tmp/mom-drive.png', clip={'x':0,'y':0,'width':400,'height':200}))
        odo = page.locator('.md-odo i').all_inner_texts()
        check(len(odo) == 2 and int(odo[1]) == int(odo[0]) + 1, f'drive-in: box count rolls up ({odo})')
        page.wait_for_selector('.m-flag', timeout=5000)
        os.environ.get('SHOTS') and (page.wait_for_timeout(250), page.screenshot(path='/tmp/mom-flag.png'))
        check('25 cars catalogued' in page.inner_text('.m-flag'), 'milestone: chequered flag at 25 cars')
        check(page.locator('.m-cf').count() > 10, 'flag confetti flies')
        page.wait_for_timeout(2800)
        check(page.locator('.moment').count() == 0, 'moments clean themselves up')
        # packed
        page.goto(base + '#/'); page.fill('input[type=search]', 'Box 2'); page.wait_for_selector('.boxcard')
        page.get_by_role('button', name='📦 Mark as packed').click(); page.wait_for_selector('.m-pack', timeout=5000)
        os.environ.get('SHOTS') and (page.wait_for_timeout(1400), page.screenshot(path='/tmp/mom-pack.png'))
        check('BOX 2 ✓' in page.inner_text('.mp-lbl'), f"packed: label stamps on ({page.inner_text('.mp-lbl')})")
        page.wait_for_timeout(2200)
        # sync lights
        page.goto(base + '#/'); page.wait_for_selector('#status'); page.click('#status')
        seen = False
        for _ in range(100):
            if page.locator('#status .sl.g').count() == 5: seen = True; break
            page.wait_for_timeout(100)
        check(seen, 'sync: five green start lights when done')
        page.wait_for_timeout(1900)
        check(page.locator('#status .lights').count() == 0 and 'All synced' in page.inner_text('#status'), 'lights clear back to "All synced"')
        # Off switch
        page.goto(base + '#/settings'); page.locator('.card:has(h3:text("Look")) .chip', has_text='Off').click(); page.wait_for_timeout(300)
        page.goto(base + '#/'); page.fill('input[type=search]', 'Box 2'); page.wait_for_selector('.boxcard')
        page.get_by_role('button', name='Open again').click(); page.wait_for_timeout(300)
        page.get_by_role('button', name='📦 Mark as packed').click(); page.wait_for_timeout(600)
        check(page.locator('.m-pack').count() == 0, 'Moments off: no packing animation')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
