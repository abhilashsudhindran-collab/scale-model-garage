"""Developer test for s1-0.37.0: box journey (Photos → Names → Gaps → Label → Packed) on the box card and the
Dashboard. Story: import 2 cars into a new box, then walk every step to "done". Fake data; NOT a phone test.

Run:  python3 tests/e2e_journey.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-jr'; os.makedirs(d, exist_ok=True); t0 = time.time() - 3600
    for k in range(4):
        open(f'{d}/p{k}.jpg', 'wb').write(m.make_jpeg((60 + 40 * k, 110, 170), 4 + k)); os.utime(f'{d}/p{k}.jpg', (t0 + k * 10, t0 + k * 10))
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}); ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.evaluate("localStorage.setItem('smg.motion', 'off')")
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        check(page.locator('.boxcard .journey').count() == 0, 'empty box: no journey yet')
        page.locator('.boxcard button', has_text='📥 Import photos into Box').click(); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(300)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(300)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f'{d}/p{k}.jpg' for k in range(4)]); page.wait_for_selector('.importgrid')
        page.get_by_role('button', name='Import 2 cars').click(); page.wait_for_url('**/#/name', timeout=60000)
        def box():
            page.goto(base + '#/box/1'); page.wait_for_selector('.boxcard .journey'); page.wait_for_timeout(300)
            return [li.get_attribute('class') or '' for li in page.locator('.boxcard .journey li').all()], page.inner_text('.boxcard .jnext')
        st, nx = box()
        check(st == ['done', 'next', '', '', ''] and 'Name 2 cars' in nx and 'Name them ›' in nx, f'after import: Photos ✓, next = Names ({st}, {nx!r})')
        if os.environ.get('SHOTS'): page.locator('.boxcard').screenshot(path='/tmp/jr-card.png')
        page.evaluate("""(async () => { const st = await import('./js/store.js'); for (const m of await st.list('models')) await st.update('models', m.model_id, { display_name: 'Car ' + m.model_id.slice(-3) }); })()""")
        st, nx = box()
        check(st[:3] == ['done', 'done', 'next'] and '2 need a barcode' in nx, f'named: next = Gaps, says what is missing ({nx!r})')
        # one car gets a real scanned barcode (product_identifiers), the other is marked as having none
        page.evaluate("""(async () => { const st = await import('./js/store.js'); const ids = await import('./js/ids.js'); const ms = await st.list('models');
          await st.create('product_identifiers', { identifier_id: ids.newId('product_identifiers'), model_id: ms[0].model_id, identifier_type: 'barcode', value_raw: '4006381333931', value_cmp: '4006381333931' });
          await st.update('models', ms[1].model_id, { barcode_absent: 'yes' }); })()""")
        st, nx = box()
        check(st[:4] == ['done', 'done', 'done', 'next'] and 'Open the label ›' in nx, 'gaps fixed: next = Label')
        page.get_by_role('button', name='Open the label ›').click(); page.wait_for_selector('.boxsheet')
        page.get_by_role('button', name='Copy as text').click(); page.wait_for_timeout(500)
        st, nx = box()
        check(st == ['done'] * 4 + ['next'] and 'Mark as packed ›' in nx, 'copying the label ticks Label: next = Packed')
        page.get_by_role('button', name='Mark as packed ›').click(); page.wait_for_timeout(500)
        st, nx = box()
        check(st == ['done'] * 5 and 'This box is done' in nx, f'all five done ({nx!r})')
        page.goto(base + '#/dash'); page.wait_for_selector('.jlist')
        txt = page.inner_text('.jlist')
        check('Box journey · 1 of 1 box done' in txt and page.locator('.jrow .journey.mini li.done').count() == 5, f'Dashboard journey list ({txt.splitlines()[0]})')
        if os.environ.get('SHOTS'): page.locator('.jlist').screenshot(path='/tmp/jr-dash.png')
        page.locator('.jrow').first.click(); page.wait_for_selector('.boxcard')
        check(page.is_visible('text=Fill Box 1'), 'tapping a row opens the box')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
