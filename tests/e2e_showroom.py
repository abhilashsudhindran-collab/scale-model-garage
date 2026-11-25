"""Developer test for s1-0.36.0: Car of the day (Garage home, flips, stays the same all day, hide until tomorrow)
and Showroom (swipe through a box: ticks, next/prev, note, close). Fake data; NOT a phone test.

Run:  python3 tests/e2e_showroom.py
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
        page.evaluate(SEED + '(30)')
        page.evaluate("""(async () => { const idb = await import('./js/idb.js'); const ms = await idb.records.byEntity('models');
          ms.forEach((r, k) => { r.data.car_note = 'History: Sample note for car ' + k + '.'; r.data.car_note_source = 'gemini'; r.data.colour_family = 'red'; }); await idb.records.putMany(ms); })()""")
        page.reload(); page.wait_for_selector('.cotd')
        name1 = page.locator('.cotd .cd-txt b').inner_text()
        check(bool(name1), f'Car of the day on the Garage home ({name1})')
        page.locator('.cotd').click(); page.wait_for_timeout(800)
        check('on' in page.get_attribute('.cotd', 'class') and 'Sample note' in page.inner_text('.cd-bk'), 'tap flips it to the note')
        page.reload(); page.wait_for_selector('.cotd')
        check(page.locator('.cotd .cd-txt b').inner_text() == name1, 'same car all day')
        if os.environ.get('SHOTS'): page.locator('.cotd').screenshot(path='/tmp/sr-cotd-back.png'); page.locator('.cotd').click(); page.wait_for_timeout(800); page.screenshot(path='/tmp/sr-home.png')
        page.locator('.cd-x').click(); page.wait_for_timeout(500); page.reload(); page.wait_for_selector('.shelfhome')
        check(page.locator('.cotd').count() == 0, '× hides it until tomorrow (still hidden after reopening)')
        # showroom
        page.goto(base + '#/box/1'); page.wait_for_selector('.boxcard')
        page.locator('text=▶ Showroom').click(); page.wait_for_selector('.showroom')
        n = page.locator('.sr-ticks i').count()
        check(n >= 2, f'showroom opens with one tick per car ({n})')
        if os.environ.get('SHOTS'): page.wait_for_timeout(700); page.screenshot(path='/tmp/sr-show.png')
        first = page.inner_text('.sr-name')
        check('Sample note' in page.inner_text('.sr-note') and page.locator('.sr-name .cdot').count() == 1, 'car name, colour dot and note shown')
        page.locator('.sr-next').click(); page.wait_for_timeout(300)
        check(page.inner_text('.sr-name') != first and page.locator('.sr-ticks i.d').count() == 1, 'tap right: next car, first tick filled')
        page.locator('.sr-prev').click(); page.wait_for_timeout(300)
        check(page.inner_text('.sr-name') == first, 'tap left: back')
        page.keyboard.press('ArrowRight'); page.wait_for_timeout(200)
        check(page.inner_text('.sr-name') != first, 'arrow key works (desktop)')
        page.locator('.sr-x').click(); page.wait_for_selector('.boxcard')
        check(page.locator('.showroom').count() == 0 and page.is_visible('text=Fill Box 1'), 'close goes back to the box')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
