"""Developer test for s1-0.34.0: photos upload 3 at a time, and stay safe when replies are lost mid-upload.
Story: import 3 boxes (6 photos = 18 files) → 3 upload replies lost (R0 F1 case) → sync, sync again →
no duplicate Drive files, every photo row has its files, Check sync = all good, uploads really overlapped.
Fake Google; NOT a phone test (real speed on B's network is not measured here).

Run:  python3 tests/e2e_parallel.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'
COUNT = """(() => { let now = 0; window.__maxUploads = 0; const f = window.fetch;
  window.fetch = async (u, o) => { const up = String(u).includes('uploadType=multipart'); if (up) { now++; window.__maxUploads = Math.max(window.__maxUploads, now); }
    try { return await f(u, o); } finally { if (up) now--; } }; })();"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-par'; os.makedirs(d, exist_ok=True); t0 = time.time() - 3600
    for k in range(6):
        open(f'{d}/p{k}.jpg', 'wb').write(m.make_jpeg((50 + 30 * k, 110, 170), 5 + k)); os.utime(f'{d}/p{k}.jpg', (t0 + k * 15, t0 + k * 15))
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}); ctx.add_init_script(COUNT)
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
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        page.locator('.boxcard button', has_text='📥 Import photos into Box').click(); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(300)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(300)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f'{d}/p{k}.jpg' for k in range(6)]); page.wait_for_selector('.importgrid')
        page.get_by_role('button', name='Import 3 cars').click(); page.wait_for_url('**/#/name', timeout=60000)
        fake.fail_next_upload_after_store = 3      # three replies lost after the file was stored
        first = sync()
        second = sync()
        check(first or second, 'sync completes after lost replies (All synced)')
        photo_files = [f for f in fake.files.values() if f.get('md5') and (f.get('appProperties') or {}).get('smgPhotoId')]
        keys = [(f['appProperties']['smgPhotoId'], f['appProperties']['smgVariant']) for f in photo_files if not f.get('trashed')]
        check(len(keys) == 18 and len(set(keys)) == 18, f'18 photo files on Drive, none duplicated ({len(keys)} files, {len(set(keys))} distinct)')
        mx = page.evaluate('window.__maxUploads')
        check(mx >= 2, f'uploads overlapped (up to {mx} at once)')
        page.goto(base + '#/settings'); page.wait_for_selector('#auditCard')
        page.get_by_role('button', name='Check that everything reached Google').click(); page.wait_for_selector('.auditres', timeout=30000)
        txt = page.inner_text('.auditres')
        check('All good: 3 cars in the sheet once, 6 photo files intact' in txt, f"Check sync after parallel upload: {txt.splitlines()[0]}")
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
