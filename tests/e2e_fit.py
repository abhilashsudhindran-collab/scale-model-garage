"""Developer test for s1-0.21.1: straightened/rotated photos are shown whole in Garage tiles; raw photos fill the tile. NOT a phone test.

Run:  python3 tests/e2e_fit.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright
httpd = m.serve(); base = f'http://localhost:{m.PORT}/'; fails = []
def check(c, msg): print(('PASS ' if c else 'FAIL ') + msg); c or fails.append(msg)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 400, 'height': 860})
    ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.evaluate(SEED + '(2)')
    # Car 1: a wide straightened copy (like the 1:18 box)
    page.evaluate("""(async () => { const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
      const c = document.createElement('canvas'); c.width = 1000; c.height = 380; const x = c.getContext('2d');
      x.fillStyle = '#3a4fc0'; x.fillRect(0, 0, 1000, 380); x.fillStyle = '#d22'; x.fillRect(0, 0, 120, 380); x.fillRect(880, 0, 120, 380);
      const bl = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
      const ms = (await st.list('models')).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const ph = (await st.list('photos')).find(p => p.model_id === ms[0].model_id && p.shot_role === 'box_front');
      for (const k of ['cropped', 'cropthumb', 'display']) await idb.blobs.put(ph.photo_id + ':' + k, bl);
      await st.update('photos', ph.photo_id, { crop_corners: '[[0,0],[1,0],[1,1],[0,1]]' });
      await st.update('models', ms[0].model_id, { primary_photo_id: ph.photo_id, display_name: 'AAA wide straightened' }); })()""")
    page.reload(); page.wait_for_selector('.grid .tile img'); page.wait_for_timeout(800)
    tile = page.locator('.tile', has_text='AAA wide straightened')
    check(tile.locator('.ph.fit').count() == 1, 'straightened photo tile uses the whole-photo style')
    fit = tile.locator('.ph img').evaluate("e => getComputedStyle(e).objectFit")
    check(fit == 'contain', f'shown whole (object-fit {fit})')
    other = page.locator('.tile').filter(has_not_text='AAA').first.locator('.ph img').evaluate("e => getComputedStyle(e).objectFit")
    check(other == 'cover', 'raw photos still fill the tile')
    pass
    check(not errs, f'no errors {errs[:2]}')
    b.close()
httpd.shutdown(); print('ALL PASS' if not fails else 'FAILED')
