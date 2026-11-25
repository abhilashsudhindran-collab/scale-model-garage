"""Developer test for s1-0.15.0: crop / straighten (D14). NOT a phone test. Fake Google from e2e_mock.py.

A photo of a tilted red "box" on white is catalogued; its four corners are dragged into place by pointer; the saved
copy must be straight (almost all red), the original untouched; it syncs as a 'cropped' Drive file; crossed corners
are refused; undo returns to the original; a second device downloads the straightened copy.

Run:  python3 tests/e2e_crop.py
"""
import os, sys, json, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'
QUAD = [(200, 250), (720, 310), (690, 950), (160, 900)]  # tilted box, in photo pixels (900 x 1200)


def photos():
    os.makedirs('/tmp/smg-crop', exist_ok=True)
    im = Image.new('RGB', (900, 1200), (250, 250, 248)); ImageDraw.Draw(im).polygon(QUAD, fill=(210, 30, 30))
    im.save('/tmp/smg-crop/front.jpg', quality=92)
    Image.new('RGB', (900, 1200), (200, 200, 200)).save('/tmp/smg-crop/rear.jpg', quality=90)


def main():
    photos()
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def device():
            ctx = b.new_context(viewport={'width': 400, 'height': 860}, has_touch=True)
            ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
            ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
            pg = ctx.new_page(); pg.goto(base + '#/'); pg.wait_for_selector('text=My Garage')
            pg.evaluate(f"localStorage.setItem('smg.clientId', '{CID}')"); return pg
        page = device(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        def sync(pg):
            pg.goto(base + '#/'); pg.wait_for_selector('#status'); pg.click('#status')
            for _ in range(150):
                if pg.inner_text('#status') == 'All synced': return True
                pg.wait_for_timeout(200)
            return False

        # Catalogue one car through a photo run
        page.goto(base + '#/run'); page.wait_for_selector('text=Photo run')
        page.select_option('select[aria-label=Brand]', label='Mini GT'); page.wait_for_timeout(200)
        page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(200)
        page.get_by_role('button', name='Car visible', exact=True).click(); page.wait_for_timeout(200)
        page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(200)
        for role, f in [('Box front', 'front'), ('Box rear', 'rear')]:
            with page.expect_file_chooser() as fc: page.get_by_role('button', name=role).click()
            fc.value.set_files(f'/tmp/smg-crop/{f}.jpg'); page.wait_for_timeout(900)
        page.wait_for_selector('text=Car 2 of this run', timeout=8000)
        check(sync(page), 'car synced (originals freed from the phone)')
        mid = page.evaluate("(async () => (await (await import('./js/store.js')).list('models'))[0].model_id)()")
        pid = page.evaluate("(async () => (await (await import('./js/store.js')).list('photos')).find(p => p.shot_role === 'box_front').photo_id)()")
        has_disp = page.evaluate(f"(async () => !!(await (await import('./js/idb.js')).blobs.get('{pid}:display')))()")

        # Open the crop screen from the photo options
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('.gallery .fig')
        page.locator('.gallery .fig', has_text='Box front').click(); page.wait_for_selector('text=This photo')
        page.get_by_role('link', name='Crop / straighten').click(); page.wait_for_selector('.cropstage img')
        page.wait_for_timeout(800)
        nat = page.evaluate("(() => { const i = document.querySelector('.cropstage img'); return [i.naturalWidth, i.naturalHeight]; })()")
        check(nat[0] > 0 and abs(nat[1] / nat[0] - 4 / 3) < 0.02, f'crop screen shows the full photo ({nat}; display copy on phone: {has_disp})')

        # Drag each corner onto the red box with the pointer; the magnifier shows while dragging
        def drag(i, x, y):
            box = page.locator('.cropstage img').bounding_box()
            hb = page.locator('.croph').nth(i).bounding_box()
            page.mouse.move(hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2); page.mouse.down()
            tx, ty = box['x'] + x / 900 * box['width'], box['y'] + y / 1200 * box['height']
            page.mouse.move((hb['x'] + tx) / 2, (hb['y'] + ty) / 2, steps=3)
            mag = page.is_visible('.cropmag.on')
            if i == 2 and x == QUAD[2][0]: page.screenshot(path='/tmp/smg-crop/mag-drag.png')
            page.mouse.move(tx, ty, steps=4); page.mouse.up(); return mag
        # Crossed corners first: refused
        drag(0, 720, 310); drag(1, 200, 250)
        check(page.locator('.cropstage.bad').count() == 1, 'crossed corners shown in red')
        page.get_by_role('button', name='Save straightened copy').click(); page.wait_for_timeout(400)
        check(page.is_visible('text=The corners cross over'), 'crossed corners refused')
        page.get_by_role('button', name='Reset corners').click(); page.wait_for_timeout(200)
        mags = [drag(i, *QUAD[i]) for i in range(4)]
        check(all(mags), 'magnifier shows while dragging each corner')
        check(page.locator('.cropstage.bad').count() == 0, 'corners in order: outline normal')
        page.screenshot(path='/tmp/smg-crop/crop-screen.png')
        page.get_by_role('button', name='Save straightened copy').click(); page.wait_for_selector('.pdp-hero img', timeout=10000); page.wait_for_timeout(800)
        check(page.is_visible('text=Box front · edited'), 'photo marked "edited"')
        info = page.evaluate(f"""(async () => {{ const i = await import('./js/idb.js'); const b = await i.blobs.get('{pid}:cropped'); const t = await i.blobs.get('{pid}:cropthumb');
          const bmp = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data; let red = 0, n = 0;
          for (let y = Math.floor(c.height * .06); y < c.height * .94; y += 4) for (let xx = Math.floor(c.width * .06); xx < c.width * .94; xx += 4) {{ const o = (y * c.width + xx) * 4; n++; if (d[o] > 150 && d[o + 1] < 90 && d[o + 2] < 90) red++; }}
          return {{ w: c.width, h: c.height, red: red / n, thumb: !!t }}; }})()""")
        check(info['red'] > 0.97, f"straightened copy is straight: {info['red']:.1%} of its inside is the box ({info['w']}x{info['h']})")
        check(0.55 < info['w'] / info['h'] < 0.95 and info['thumb'], 'sensible proportions; small copy made for tiles')
        ph = page.evaluate(f"(async () => (await (await import('./js/store.js')).list('photos')).find(p => p.photo_id === '{pid}'))()")
        check(len(json.loads(ph['crop_corners'])) == 4 and ph['original_file_id'], 'corners saved; original file untouched')

        # Sync: the straightened copy goes to Drive as its own file
        check(sync(page), 'sync after straightening')
        cropped_files = [f for f in fake.files.values() if f['appProperties'].get('smgVariant') == 'cropped']
        ph = page.evaluate(f"(async () => (await (await import('./js/store.js')).list('photos')).find(p => p.photo_id === '{pid}'))()")
        check(len(cropped_files) == 1 and ph['cropped_file_id'], 'cropped copy uploaded and linked to the photo')

        # A second device downloads the straightened copy
        lap = device(); check(sync(lap), 'second device synced')
        got = lap.evaluate(f"(async () => !!(await (await import('./js/idb.js')).blobs.get('{pid}:cropped')))()")
        check(got, 'second device has the straightened copy')

        # Undo returns to the original
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('.gallery .fig')
        if not page.is_visible('text=Back to original'): page.locator('.gallery .fig', has_text='Box front').click(); page.wait_for_selector('text=Undo straightening')
        page.get_by_role('button', name='Back to original').click(); page.wait_for_timeout(600)
        ph = page.evaluate(f"(async () => (await (await import('./js/store.js')).list('photos')).find(p => p.photo_id === '{pid}'))()")
        check(not ph['crop_corners'] and not page.is_visible('text=straightened'), 'undo: back to the original photo')
        # Rear photo: its full copy was freed after sync, so the crop screen fetches it from Drive
        rid = page.evaluate("(async () => (await (await import('./js/store.js')).list('photos')).find(p => p.shot_role === 'box_rear').photo_id)()")
        local = page.evaluate(f"(async () => !!(await (await import('./js/idb.js')).blobs.get('{rid}:display')))()")
        page.goto(base + f'#/crop/{rid}'); page.wait_for_selector('.cropstage img', timeout=10000); page.wait_for_timeout(800)
        nat = page.evaluate("document.querySelector('.cropstage img').naturalWidth")
        check(not local and nat > 0, f'rear photo: full copy not on the phone ({local}), fetched from Drive for cropping ({nat}px wide)')
        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:2]})')
        b.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}"); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
