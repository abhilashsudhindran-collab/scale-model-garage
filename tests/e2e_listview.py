"""Developer test for s1-0.44.0: Garage list view + sorting (Photos/List switch, six sorts, blanks last,
remembered after reload, sort applies inside groups). Fake data; NOT a phone test.

Run:  python3 tests/e2e_listview.py
"""
import os, sys
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
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(12)')  # names "<word> #i", car 9 nameless; codes MGT00000-L…; Box 1..12
        page.reload(); page.wait_for_selector('.viewbar')
        names = lambda: [t.split('\n')[0] for t in page.locator('.grid .tile .nm').all_inner_texts()]
        check(page.locator('.viewbar .seg.on').inner_text().strip().endswith('Photos') and page.locator('.grid.list').count() == 0, 'starts in Photos view')
        check(page.input_value('.sortsel') == 'newest' and names()[0].endswith('#11'), f'newest first by default ({names()[:2]})')
        page.select_option('.sortsel', 'name'); page.wait_for_timeout(300)
        n = names()
        check(n[-1] == '(no name yet)' and n[:2] == ['BMW M3 #6', 'Ferrari 499P #4'], f'Name A–Z, nameless last ({n[:2]}…{n[-1]})')
        page.select_option('.sortsel', 'code'); page.wait_for_timeout(300)
        subs = [s.split(' · ')[-1] for s in page.locator('.grid .tile .sub').all_inner_texts()]
        check(subs == sorted(subs), f'Product code order ({subs[:3]})')
        page.select_option('.sortsel', 'box'); page.wait_for_timeout(300)
        boxes = [t for t in page.locator('.grid .tile .badges .b.box').all_inner_texts()]
        check(boxes[:3] == ['Box 1', 'Box 2', 'Box 3'] and boxes.index('Box 10') > boxes.index('Box 9'), f'Box 2 before Box 10 ({boxes[:4]}…)')
        page.locator('.viewbar .seg', has_text='List').click(); page.wait_for_timeout(200)
        check(page.locator('.grid.list').count() == 1, 'List switch turns the grid into a list')
        tb = page.locator('.grid .tile').first.bounding_box(); tb2 = page.locator('.grid .tile').nth(1).bounding_box()
        check(tb['height'] < 110 and tb2['y'] > tb['y'] and abs(tb2['x'] - tb['x']) < 2, f'list rows are compact, one per line (h={tb["height"]:.0f})')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/listview.png')
        page.reload(); page.wait_for_selector('.viewbar')
        check(page.locator('.grid.list').count() == 1 and page.input_value('.sortsel') == 'box', 'view and sort remembered after reopening')
        # sort inside groups: By brand + Name A–Z
        page.select_option('.sortsel', 'name'); page.locator('.chip', has_text='By brand').click(); page.wait_for_timeout(400)
        first_group = page.locator('.grid .group').first.inner_text()
        grp = page.evaluate("""() => { const out = []; let cur = null; for (const el of document.querySelectorAll('.grid > *')) {
            if (el.classList.contains('group')) { cur = []; out.push(cur); } else if (el.classList.contains('tile') && cur) cur.push(el.querySelector('.nm').innerText.trim()); } return out; }""")
        ok = all(g == sorted(g, key=lambda s: (s == '(no name yet)', s.lower())) for g in grp)
        check(ok and 'Bburago' in first_group, f'groups stay A–Z, names sorted inside each ({grp[0]})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
