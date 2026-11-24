"""Developer test for s1-0.16.1: car page shows Edit details and Remove at the top; a wide photo is not padded into a tall frame. NOT a phone test.

Run:  python3 tests/e2e_pdp.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright
httpd = m.serve(); base = f'http://localhost:{m.PORT}/'; fails=[]
def check(c,msg): print(('PASS ' if c else 'FAIL ')+msg); c or fails.append(msg)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 400, 'height': 860})
    ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
    page = ctx.new_page(); errs=[]; page.on('pageerror', lambda e: errs.append(str(e))); page.on('dialog', lambda d: d.accept())
    page.goto(base+'#/'); page.wait_for_selector('text=My Garage')
    # a wide (landscape) photo, like a 1:43 window box
    page.evaluate(SEED + '(3)')
    page.evaluate("""(async () => { const idb = await import('./js/idb.js'); const c = document.createElement('canvas'); c.width = 1000; c.height = 420; const x = c.getContext('2d'); x.fillStyle = '#933'; x.fillRect(0,0,1000,420);
      const bl = await new Promise(r => c.toBlob(r, 'image/jpeg', .8)); const ph = await idb.records.byEntity('photos'); for (const p of ph) { await idb.blobs.put(p.id + ':display', bl); await idb.blobs.put(p.id + ':thumb', bl); } })()""")
    page.reload(); page.wait_for_selector('.grid .tile'); page.locator('.grid .tile').first.click(); page.wait_for_selector('.pdp-actions'); page.wait_for_timeout(600)
    eb = page.get_by_role('button', name='Edit details').bounding_box(); rb = page.get_by_role('button', name='Remove', exact=True).bounding_box()
    check(eb and rb and eb['y'] + eb['height'] < 860 and rb['y'] + rb['height'] < 860, f'Edit and Remove visible without scrolling (y={eb and int(eb["y"])})')
    hb = page.locator('.pdp-hero').bounding_box()
    check(hb['height'] < 220, f'wide photo: frame follows the photo, no tall white frame (height {int(hb["height"])})')
    page.screenshot(path='/tmp/pdp_top.png')
    page.get_by_role('button', name='Edit details').click(); page.wait_for_timeout(900)
    check(page.evaluate("document.activeElement === document.querySelector('#pdpDetails input')"), 'Edit details jumps to the fields, Name ready to type')
    page.get_by_role('button', name='Remove', exact=True).click(); page.wait_for_timeout(800)
    check(page.url.endswith('#/') and page.locator('.grid .tile').count() == 2, 'Remove: car leaves the garage (archived)')
    check(not errs, f'no errors {errs[:2]}')
    b.close()
httpd.shutdown(); print('ALL PASS' if not fails else 'FAILED')
