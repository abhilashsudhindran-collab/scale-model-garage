"""Developer test for s1-0.53.0: reading a barcode from a photo retries on zoomed sections when the whole-photo read
finds nothing. A 4000x3000 'box rear' with a slightly blurred EAN-13 on a busy background is NOT read in one pass but IS
read by the retry; a sharp barcode is still read in one pass (no retry); a photo with no barcode gives nothing within
the time cap; a gallery import reads the blurred barcode into the car. Fake Google; NOT a phone test (a phone uses
Chrome's built-in reader, this test uses the ZXing fallback).

Run:  python3 tests/e2e_barcode_retry.py
"""
import io, os, sys, random, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from PIL import Image, ImageFilter, ImageDraw
from playwright.sync_api import sync_playwright

EAN = '4006381333931'


def rear_photo(path, bc_w=600, blur=1.2, with_barcode=True):
    import barcode
    from barcode.writer import ImageWriter
    img = Image.new('RGB', (4000, 3000), (200, 60, 50)); d = ImageDraw.Draw(img); rnd = random.Random(1)
    for _ in range(400):
        x, y = rnd.randrange(4000), rnd.randrange(3000); d.rectangle([x, y, x + rnd.randrange(20, 200), y + rnd.randrange(5, 60)], fill=tuple(rnd.randrange(256) for _ in range(3)))
    if with_barcode:
        buf = io.BytesIO(); barcode.get('ean13', EAN[:12], writer=ImageWriter()).write(buf, {'module_width': 0.5, 'module_height': 22, 'quiet_zone': 8, 'font_size': 10})
        bc = Image.open(io.BytesIO(buf.getvalue())).convert('RGB'); bc = bc.resize((bc_w, int(bc.height * bc_w / bc.width)), Image.LANCZOS)
        d.rounded_rectangle([2660, 1160, 2740 + bc_w, 1260 + bc.height], 30, fill=(235, 235, 232)); img.paste(bc, (2700, 1200))
    if blur: img = img.filter(ImageFilter.GaussianBlur(blur))
    img.save(path, 'JPEG', quality=88)


SCAN = """async ([bytes, retry]) => { const { scanPhoto } = await import('./js/barcode.js');
  const t = performance.now(); const r = await scanPhoto(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), { retry });
  return { value: r && r.value, retried: (r && r.retried) || null, ms: Math.round(performance.now() - t) }; }"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    tmp = '/tmp/smg_bcretry'; os.makedirs(tmp, exist_ok=True)
    blurred, sharp, none, front = f'{tmp}/rear_blur.jpg', f'{tmp}/rear_sharp.jpg', f'{tmp}/rear_none.jpg', f'{tmp}/front.jpg'
    rear_photo(blurred); rear_photo(sharp, blur=0); rear_photo(none, with_barcode=False); rear_photo(front, with_barcode=False, blur=0)
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/settings'); page.wait_for_selector('text=Settings')
        data = list(open(blurred, 'rb').read())
        one = page.evaluate(SCAN, [data, False])
        check(one['value'] is None, f'blurred, busy photo: one pass over the whole photo finds nothing (as before) {one}')
        r = page.evaluate(SCAN, [data, True])
        check(r['value'] == EAN and r['retried'], f'the retry on zoomed sections reads it {r}')
        s = page.evaluate(SCAN, [list(open(sharp, 'rb').read()), True])
        check(s['value'] == EAN and not s['retried'], f'a sharp barcode is still read in one pass {s}')
        n = page.evaluate(SCAN, [list(open(none, 'rb').read()), True])
        check(n['value'] is None and n['ms'] < 4000, f'no barcode: nothing found, within the time cap {n}')
        # Through a real gallery import (front + blurred rear, front taken first): the barcode lands on the car
        import time as _t
        t0 = _t.time() - 600; os.utime(front, (t0, t0)); os.utime(blurred, (t0 + 15, t0 + 15))
        page.goto(base + '#/import'); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(300)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(200)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([front, blurred]); page.wait_for_selector('.importgrid')
        page.get_by_role('button', name='Import 1 car').click(); page.wait_for_url('**/#/name', timeout=60000); page.wait_for_timeout(800)
        bc = page.evaluate("""(async () => { const st = await import('./js/store.js'); const ids = await st.list('product_identifiers');
          return ids.filter(i => i.identifier_type === 'barcode').map(i => i.value_raw); })()""")
        check(EAN in bc, f'gallery import reads the blurred barcode into the car {bc}')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED'); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
