"""Developer test for s1-0.26.0: import from the gallery (pairs by time taken, preview, swap, import into a box,
same photo records). Fake Google; NOT a phone test.

Run:  python3 tests/e2e_import.py
"""
import os, sys, time, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-import'; os.makedirs(d, exist_ok=True)
    # 3 cars × (front, back), taken in this order; file names deliberately NOT in that order
    names = ['zz.jpg', 'aa.jpg', 'mm.jpg', 'bb.jpg', 'yy.jpg', 'cc.jpg']
    t0 = time.time() - 3600; md5 = []
    for k, n in enumerate(names):
        data = m.make_jpeg((60 + 30 * k, 120, 200 - 25 * k), 3 + k)
        open(f'{d}/{n}', 'wb').write(data); os.utime(f'{d}/{n}', (t0 + k * 20, t0 + k * 20)); md5.append(hashlib.md5(data).hexdigest())
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        page.locator('.boxcard button', has_text='📥 Import photos into Box').click(); page.wait_for_selector('text=📥 Import from gallery')
        check(page.is_visible('text=Into Box 1'), 'import goes into the box being filled (Box 1)')
        page.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); page.wait_for_timeout(400)
        page.locator('.chip', has_text='1:64').first.click(); page.wait_for_timeout(300)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f'{d}/{n}' for n in sorted(names)])  # handed over alphabetically on purpose
        page.wait_for_selector('.importgrid')
        check(page.is_visible('text=6 photos → 3 cars') and page.locator('.importcar').count() == 3, 'preview: 6 photos → 3 cars')
        page.get_by_role('button', name='⇄ Swap front and back').click(); page.wait_for_timeout(200)
        check(page.is_visible('text=↺ Undo swap'), 'swap offered (and can be undone)')
        page.get_by_role('button', name='↺ Undo swap').click(); page.wait_for_timeout(200)
        page.get_by_role('button', name='Import 3 cars').click()
        page.wait_for_url('**/#/name', timeout=60000); page.wait_for_timeout(800)
        res = page.evaluate("""(async () => { const st = await import('./js/store.js');
          const ms = await st.list('models'); const ph = await st.list('photos'); const inv = await st.list('inventory');
          return ms.sort((a, b) => a.created_at.localeCompare(b.created_at)).map(m => ({ brand: m.brand_id, scale: m.scale_id,
            box: inv.find(i => i.model_id === m.model_id)?.storage_location,
            front: ph.find(p => p.model_id === m.model_id && p.shot_role === 'box_front')?.original_md5,
            rear: ph.find(p => p.model_id === m.model_id && p.shot_role === 'box_rear')?.original_md5 })); })()""")
        check(len(res) == 3, f'3 cars saved ({len(res)})')
        pairs_ok = all(r['front'] == md5[2 * k] and r['rear'] == md5[2 * k + 1] for k, r in enumerate(res))
        check(pairs_ok, 'paired by time taken (zz+aa, mm+bb, yy+cc), not by file name')
        check(all(r['box'] == 'Box 1' for r in res) and all(r['brand'] and r['scale'] for r in res), 'all in Box 1 with brand Mini GT and 1:64')
        check(page.is_visible('text=3 boxes need a name') or page.is_visible('text=Do the next 3 boxes with Gemini'), 'lands on the Name tab, ready for Gemini')
        times = page.evaluate("(async () => (await (await import('./js/idb.js')).meta.get('captureTimesV2', [])).length)()")
        check(times == 0, f'imports do not add near-zero capture times ({times})')
        page.goto(base + '#/dash'); page.wait_for_selector('.pacecard')
        pace = page.inner_text('.pacecard'); print('   ', pace.splitlines()[1])
        check('40 s per box' in pace and '40 s on average' in pace and '3 boxes timed' in pace and '3 boxes in 1 min' in pace, 'Dashboard pace from photo times: fronts 40 s apart → 40 s per box')
        # Mixed box: brands later (Gemini fills them on the Name tab)
        page.goto(base + '#/import'); page.wait_for_selector('text=📥 Import from gallery')
        page.select_option('select[aria-label="Brand for imported cars"]', value='later'); page.wait_for_timeout(400)
        with page.expect_file_chooser() as fc: page.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files([f'{d}/aa.jpg', f'{d}/zz.jpg', f'{d}/mm.jpg'])
        page.wait_for_selector('.importgrid')
        check(page.is_visible("text=1 photo is left over"), 'odd photo count warns about the left-over photo')
        page.get_by_role('button', name='Import 1 car').click(); page.wait_for_url('**/#/name', timeout=60000); page.wait_for_timeout(600)
        nb = page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).filter(m => !m.brand_id).length)()")
        check(nb == 1, f'brands-later car saved without a brand ({nb})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
