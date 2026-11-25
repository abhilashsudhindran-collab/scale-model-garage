"""Developer test for s1-0.30.0: packing progress (mark a storage box packed, Dashboard progress, open again,
warning when adding to a packed box). Fake data; NOT a phone test.

Run:  python3 tests/e2e_packing.py
"""
import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright


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
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(30)')
        boxes = page.evaluate("(async () => { const inv = await (await import('./js/store.js')).list('inventory'); const c = {}; for (const i of inv) if (i.storage_location) c[i.storage_location] = (c[i.storage_location] || 0) + 1; return c; })()")
        total = sum(boxes.values()); nbox = len(boxes); b1 = boxes.get('Box 1', 0)
        print('   boxes:', boxes)
        page.goto(base + '#/dash'); page.wait_for_selector('.packing')
        check(f'Packed: 0 of {nbox} boxes' in page.inner_text('.packing'), f'Dashboard: 0 of {nbox} boxes packed at the start')
        page.goto(base + '#/'); page.fill('input[type=search]', 'Box 1'); page.wait_for_selector('.boxcard')
        page.get_by_role('button', name='📦 Mark as packed').click(); page.wait_for_selector('.packedrow')
        check('Packed' in page.inner_text('.packedrow'), 'box card shows Packed with the date')
        rec = page.evaluate("(async () => (await (await import('./js/store.js')).list('storage_boxes')).find(r => r.box_label === 'Box 1'))()")
        check(bool(re.match(r'\d{4}-\d{2}-\d{2}T', rec.get('box_packed_at', ''))), 'packed date saved on the storage box record (synced column)')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => r.field === 'box_packed_at').length)()")
        check(log == 1, 'change logged')
        page.goto(base + '#/dash'); page.wait_for_selector('.packing')
        txt = page.inner_text('.packing')
        check(f'Packed: 1 of {nbox} boxes' in txt and f'{b1} car' in txt and f'{total - b1} still to pack' in txt, f'Dashboard progress after packing Box 1 ({txt.splitlines()[-1]})')
        check(page.locator('.boxtile .packedmark').count() == 1, 'packed box tile shows ✓')
        page.goto(base + '#/boxsheet/1'); page.wait_for_selector('.boxsheet')
        check(page.locator('.packedrow').count() == 1, 'contents sheet shows the packed state')
        page.goto(base + '#/'); page.fill('input[type=search]', 'Box 1'); page.wait_for_selector('.boxcard')
        page.locator('.boxcard button', has_text='📥 Import photos into Box').click(); page.wait_for_timeout(300)
        check(page.locator('text=is marked packed').count() >= 1, 'adding to a packed box warns (cars still allowed)')
        page.goto(base + '#/'); page.fill('input[type=search]', 'Box 1'); page.wait_for_selector('.boxcard')
        page.get_by_role('button', name='Open again').click(); page.wait_for_selector('text=📦 Mark as packed')
        page.goto(base + '#/dash'); page.wait_for_selector('.packing')
        check(f'Packed: 0 of {nbox} boxes' in page.inner_text('.packing'), 'Open again: back to 0 packed')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
