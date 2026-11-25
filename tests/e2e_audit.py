"""Developer test for s1-0.31.0: Settings → Check sync (read-only comparison of the phone with the Sheet and Drive).
Story: import 2 cars with photos → sync → check = all good → damage the fake Google (duplicate row, missing row,
binned photo, changed photo) → check reports each → nothing written by the check. Fake Google; NOT a phone test.

Run:  python3 tests/e2e_audit.py
"""
import os, sys, time, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-audit'; os.makedirs(d, exist_ok=True); t0 = time.time() - 3600
    for k in range(4):
        open(f'{d}/p{k}.jpg', 'wb').write(m.make_jpeg((60 + 40 * k, 120, 180), 4 + k)); os.utime(f'{d}/p{k}.jpg', (t0 + k * 10, t0 + k * 10))
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.evaluate(f"localStorage.setItem('smg.clientId', '{CID}')")
        def sync():
            page.goto(base + '#/'); page.wait_for_selector('#status'); page.click('#status')
            for _ in range(200):
                if page.inner_text('#status') == 'All synced': return True
                page.wait_for_timeout(200)
            return False
        # 2 cars with photos via the gallery import
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        page.locator('.boxcard button', has_text='📥 Import photos into Box').click(); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(300)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(300)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f'{d}/p{k}.jpg' for k in range(4)]); page.wait_for_selector('.importgrid')
        page.get_by_role('button', name='Import 2 cars').click(); page.wait_for_url('**/#/name', timeout=60000)
        page.goto(base + '#/settings'); page.wait_for_selector('#auditCard')
        check(page.locator('#auditCard button').is_disabled(), 'signed out: the check is greyed')
        check(sync(), 'sync finished (All synced)')
        page.goto(base + '#/settings'); page.wait_for_selector('#auditCard')
        page.get_by_role('button', name='Check that everything reached Google').click(); page.wait_for_selector('.auditres', timeout=30000)
        txt = page.inner_text('.auditres'); print('   ', txt.splitlines()[0])
        check('All good: 2 cars in the sheet once, 4 photo files intact' in txt, 'all good after a clean sync (2 cars, 4 photo files)')
        before = copy.deepcopy(fake.sheets)
        # damage: duplicate a MODELS row, drop an INVENTORY row, bin one photo, change another
        wb = [k for k, f in fake.files.items() if f['appProperties'].get('smgRole') == 'workbook'][0]
        sh = fake.sheets[wb]
        sh['MODELS'].append(list(sh['MODELS'][1]))
        del sh['INVENTORY'][1]
        ph = page.evaluate("(async () => (await (await import('./js/store.js')).list('photos')).map(p => p.original_file_id))()")
        fake.files[ph[0]]['trashed'] = True
        fake.files[ph[1]]['md5'] = 'not-the-same'
        damaged = copy.deepcopy(fake.sheets)
        page.get_by_role('button', name='Check again').click(); page.wait_for_timeout(300); page.wait_for_selector('#auditCard button:not([disabled])', timeout=30000)
        txt = page.inner_text('.auditres'); print('   ', ' | '.join(txt.splitlines()[:6]))
        check('4 problems found' in txt, 'problems counted (4)')
        check('car appears twice in the sheet' in txt, 'duplicate row reported')
        check('copy is on this phone but not in the sheet' in txt, 'missing row reported')
        check('photo file is in the Drive bin' in txt and 'photo file is different from what was uploaded' in txt, 'binned and changed photo files reported')
        check(fake.sheets == damaged, 'the check wrote nothing to the sheet')
        page.reload(); page.wait_for_selector('.auditres')
        check('4 problems found' in page.inner_text('.auditres'), 'last result kept after reopening Settings')
        check('not on this phone' not in txt, 'no false "not on this phone" rows (starter brands/scales counted)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
