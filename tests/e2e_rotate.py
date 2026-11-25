"""Developer test for s1-0.21.0: rotate photos (quarter turns via the straighten pipeline; original untouched).
Fake data; NOT a phone test.

Run:  python3 tests/e2e_rotate.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

PROBE = """(async (pid) => { const idb = await import('./js/idb.js'); const b = await idb.blobs.get(pid + ':cropped'); if (!b) return null;
  const bm = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  const x = c.getContext('2d'); x.drawImage(bm, 0, 0); const px = (u, v) => Array.from(x.getImageData(Math.floor(u * (bm.width - 1)), Math.floor(v * (bm.height - 1)), 1, 1).data.slice(0, 3));
  return { w: bm.width, h: bm.height, tl: px(0.05, 0.05), tr: px(0.95, 0.05) }; })"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(1)')
        # A wide photo (like a 1:18 box shot sideways): grey, with a red block in the top-left corner
        mid, pid = page.evaluate("""(async () => { const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const c = document.createElement('canvas'); c.width = 1000; c.height = 400; const x = c.getContext('2d');
          x.fillStyle = '#888'; x.fillRect(0, 0, 1000, 400); x.fillStyle = '#f00'; x.fillRect(0, 0, 200, 120);
          const bl = await new Promise(r => c.toBlob(r, 'image/jpeg', .92));
          const ph = (await st.list('photos')).find(p => p.shot_role === 'box_front');
          await idb.blobs.put(ph.photo_id + ':display', bl); await idb.blobs.put(ph.photo_id + ':original', bl);
          return [ph.model_id, ph.photo_id]; })()""")
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('.gallery')
        page.locator('.gallery .fig', has_text='Box front').click(); page.wait_for_selector('text=Rotate right ↻')
        page.get_by_role('button', name='Rotate right ↻').click(); page.wait_for_timeout(2500)
        r = page.evaluate(PROBE, pid)
        red = lambda c: c and c[0] > 180 and c[1] < 90 and c[2] < 90
        check(r and r['h'] > r['w'], f'rotate right: wide photo becomes tall ({r and (r["w"], r["h"])})')
        check(r and red(r['tr']) and not red(r['tl']), 'rotate right: the red corner moves from top-left to top-right')
        orig = page.evaluate(f"(async () => {{ const b = await (await import('./js/idb.js')).blobs.get('{pid}:original'); const bm = await createImageBitmap(b); return [bm.width, bm.height]; }})()")
        check(orig == [1000, 400], 'original photo untouched')
        check(page.is_visible('text=Box front · edited'), 'photo marked "edited"')
        page.locator('.gallery .fig', has_text='Box front').click() if not page.is_visible('text=↺ Rotate left') else None
        page.get_by_role('button', name='↺ Rotate left').click(); page.wait_for_timeout(2500)
        r = page.evaluate(PROBE, pid)
        check(r and r['w'] > r['h'] and red(r['tl']), 'rotate left: back to wide, red corner top-left again')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => /rotated/.test(r.reason)).length)()")
        check(log == 2, 'each rotation logged')
        page.locator('.gallery .fig', has_text='Box front').click() if not page.is_visible('text=Back to original') else None
        page.get_by_role('button', name='Back to original').click(); page.wait_for_timeout(700)
        check(page.evaluate(PROBE, pid) is None, 'Back to original removes the edited copy')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
