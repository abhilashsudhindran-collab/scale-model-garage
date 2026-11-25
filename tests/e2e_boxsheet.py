"""Developer test for s1-0.27.0: box contents sheet & label (list, copies, text copy, print layout). Fake Google; NOT a phone test.

Run:  python3 tests/e2e_boxsheet.py
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
    d = '/tmp/smg-sheet'; os.makedirs(d, exist_ok=True)
    t0 = time.time() - 3600
    for k in range(4):
        open(f'{d}/p{k}.jpg', 'wb').write(m.make_jpeg((80 + 40 * k, 120, 160), 4 + k)); os.utime(f'{d}/p{k}.jpg', (t0 + k * 10, t0 + k * 10))
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}); ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        check(page.locator('text=🧾 Contents sheet & label').count() == 0, 'empty box: no contents sheet button')
        page.locator('.boxcard button', has_text='📥 Import photos into Box').click(); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(300)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(300)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f'{d}/p{k}.jpg' for k in range(4)]); page.wait_for_selector('.importgrid')
        page.get_by_role('button', name='Import 2 cars').click(); page.wait_for_url('**/#/name', timeout=60000); page.wait_for_timeout(500)
        # name one car, give it a code + colour + a second copy
        page.evaluate("""(async () => { const st = await import('./js/store.js'); const ms = (await st.list('models')).sort((a, b) => a.created_at.localeCompare(b.created_at));
          await st.update('models', ms[0].model_id, { display_name: 'Nissan Skyline GT-R R34', product_code: 'MGT00123', colour_family: 'blue', colour_name: 'Bayside Blue' });
          const inv = (await st.list('inventory')).find(i => i.model_id === ms[0].model_id);
          const { newId } = await import('./js/ids.js');
          await st.create('inventory', { ...inv, inventory_id: newId('inventory'), created_at: undefined, updated_at: undefined }); })()""")
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.fill('input[type=search]', 'Box 1'); page.wait_for_selector('.boxcard')
        page.locator('text=🧾 Contents sheet & label').click(); page.wait_for_selector('.boxsheet')
        check(page.inner_text('.bl-num') == 'BOX 1', 'label shows BOX 1 in large type')
        page.wait_for_selector('.bl-qr svg', timeout=10000)
        url = page.evaluate('''(async () => {
          const svg = document.querySelector('.bl-qr svg').outerHTML;
          const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
          const c = document.createElement('canvas'); c.width = c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400); g.drawImage(img, 0, 0, 400, 400);
          await new Promise((res, rej) => { const s = document.createElement('script'); s.src = './vendor/barcode/ponyfill.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
          window.BarcodeDetectionAPI.prepareZXingModule({ overrides: { locateFile: (p, pre) => p.endsWith('.wasm') ? './vendor/barcode/zxing_reader.wasm' : pre + p } });
          const det = new window.BarcodeDetectionAPI.BarcodeDetector({ formats: ['qr_code'] });
          const r = await det.detect(c); return r[0] ? r[0].rawValue : null; })()''')
        print('   QR reads:', url)
        check(bool(url) and url.endswith('#/box/1') and url.startswith(base.rstrip('/')), f'QR on the label decodes to this box link ({url})')
        page.goto(url); page.wait_for_selector('.boxcard')
        check(page.is_visible('text=Fill Box 1'), 'opening the QR link shows Box 1 and its cars')
        page.goto(base + '#/boxsheet/1'); page.wait_for_selector('.boxsheet')
        meta = page.inner_text('.bl-meta')
        check('3 cars' in meta and 'Mini GT' in meta and '1:64' in meta, f'label: count incl. copies, brand, scale ({meta!r})')
        check(page.locator('.bs-list li').count() == 2, 'two different cars listed')
        first = page.inner_text('.bs-list li >> nth=0')
        check('Nissan Skyline GT-R R34' in first and '×2' in first and 'MGT00123' in first, f'named car with code and ×2 copies ({first!r})')
        check(page.locator('.bs-list li >> nth=0 >> .cdot').count() == 1, 'colour dot shown')
        check('Name not set' in page.inner_text('.bs-list li >> nth=1') and page.is_visible('text=1 car has no name yet'), 'unnamed car flagged, with a hint')
        page.get_by_role('button', name='Copy as text').click(); page.wait_for_timeout(300)
        txt = page.evaluate('navigator.clipboard.readText()')
        check(txt.startswith('Box 1') and '1. Mini GT · Nissan Skyline GT-R R34 · MGT00123 · 1:64 · Bayside Blue ×2' in txt, f'copy as text ({txt.splitlines()[1] if len(txt.splitlines()) > 1 else txt!r})')
        page.wait_for_timeout(500); page.screenshot(path='/tmp/sheet_phone.png', full_page=True)
        page.emulate_media(media='print')
        if os.environ.get('SHOTS'): page.pdf(path='/tmp/sheet.pdf', format='A4')
        check(not page.is_visible('nav.bottom') and not page.is_visible('header.top') and not page.get_by_role('button', name='Copy as text').is_visible(), 'print hides menus and buttons')
        check(page.is_visible('.boxlabel') and page.is_visible('.bs-list'), 'print keeps the label and the list')
        page.emulate_media(media='screen')
        page.locator('a.back').click(); page.wait_for_selector('.boxcard')
        check(page.is_visible('text=Fill Box 1'), 'back goes to the box')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
