"""Developer test for s1-0.54.0: re-check barcodes on saved cars. A car is imported (barcode read), synced to the fake
Drive (the phone then drops its full-size rear photo), and its barcode is removed, so it lands in To check → No
barcode. The re-check card downloads the rear photo from Drive, reads it (zoomed retry), and adds the barcode back
(source rear_photo_recheck, logged), leaving cars without a readable barcode alone. Fake Google; NOT a phone test.

Run:  python3 tests/e2e_recheck.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from e2e_barcode_retry import rear_photo, EAN
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    tmp = '/tmp/smg_recheck'; os.makedirs(tmp, exist_ok=True)
    f1, r1, f2, r2 = f'{tmp}/f1.jpg', f'{tmp}/r1.jpg', f'{tmp}/f2.jpg', f'{tmp}/r2.jpg'
    rear_photo(f1, with_barcode=False, blur=0); rear_photo(r1)  # r1: blurred barcode, read only by the zoomed retry
    rear_photo(f2, with_barcode=False, blur=0); rear_photo(r2, with_barcode=False)
    t0 = time.time() - 900
    for k, f in enumerate([f1, r1, f2, r2]): os.utime(f, (t0 + 15 * k, t0 + 15 * k))
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        ev = page.evaluate
        page.goto(base + '#/import'); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(300)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(200)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f1, r1, f2, r2]); page.wait_for_selector('.importgrid')
        page.get_by_role('button', name='Import 2 cars').click(); page.wait_for_url('**/#/name', timeout=90000); page.wait_for_timeout(600)
        # Sync, so the originals go to Drive and leave the phone
        ev(f"localStorage.setItem('smg.clientId', '{CID}')")
        page.click('#status')
        for _ in range(150):
            if page.inner_text('#status') == 'All synced': break
            page.wait_for_timeout(200)
        check(page.inner_text('#status') == 'All synced', 'imported cars synced to the (fake) Drive')
        local = ev("""(async () => { const { blobs } = await import('./js/idb.js'); const st = await import('./js/store.js');
          const ph = (await st.list('photos')).filter(p => p.shot_role === 'box_rear'); const out = [];
          for (const p of ph) out.push(!!(await blobs.get(p.photo_id + ':original'))); return out; })()""")
        check(local and not any(local), f'full-size rear photos are no longer on the phone after sync {local}')
        # Remove the barcode the import read, so the car is in To check → No barcode
        ev("""(async () => { const st = await import('./js/store.js'); for (const i of await st.list('product_identifiers')) if (i.identifier_type === 'barcode') await st.archive('product_identifiers', i.identifier_id); })()""")
        # Open the No barcode list the way the Dashboard does
        page.goto(base + '#/dash'); page.wait_for_selector('.card.hero'); page.wait_for_timeout(300)
        lnk = page.locator('text=No barcode').first
        lnk.click(); page.wait_for_selector('.card.recheck', timeout=10000)
        txt = page.inner_text('.card.recheck')
        check('Re-check 2 rear photos' in txt and 'Wi-Fi' in txt, f'No barcode list offers the re-check for both cars ({txt[:90]!r})')
        page.get_by_role('button', name='🔁 Re-check 2 rear photos').click()
        page.wait_for_selector('.toast:has-text("Found")', timeout=60000)
        toast = page.inner_text('.toast')
        check('Found 1 barcode in 2 photos' in toast, f'result: one barcode found, the other photo has none ({toast!r})')
        page.wait_for_timeout(500)
        res = ev("""(async () => { const st = await import('./js/store.js'); const ids = (await st.list('product_identifiers')).filter(i => i.identifier_type === 'barcode' && !i.deleted_at);
          const log = (await st.list('change_log')).filter(c => c.field === 'barcode');
          return { ids: ids.map(i => [i.value_raw, i.source, !!i.evidence_photo_id]), log: log.map(c => [c.new_value, c.reason]) }; })()""")
        check(res['ids'] == [[EAN, 'rear_photo_recheck', True]], f"barcode added with source and evidence photo {res['ids']}")
        check(any(l[0] == EAN and 're-check' in (l[1] or '') for l in res['log']), f"the fill is in the change log {res['log']}")
        try: page.wait_for_selector('.card.recheck:has-text("already re-checked")', timeout=8000)
        except Exception: pass
        txt2 = page.inner_text('.card.recheck') if page.locator('.card.recheck').count() else ''
        check('Re-check' not in txt2 and 'already re-checked' in txt2, f'the photo already re-checked is not downloaded again ({txt2[:80]!r})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED'); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
