"""Developer test for s1-0.43.0: Data health on the Dashboard (score, complete cars, weakest three, fix links)
and the new To check → Missing front or back photo. Fake data; NOT a phone test.

Run:  python3 tests/e2e_health.py
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
        page.evaluate(SEED + '(10)')  # 10 cars: everything except colour (all 10) and one name
        page.goto(base + '#/dash'); page.wait_for_selector('.health')
        txt = page.inner_text('.health')
        check('87%' in txt and 'Good' in txt, f'79 of 90 ticks → 87% Good ({txt[:40]!r})')
        check('0 of 10 cars have everything · 9 things checked per car' in txt, 'complete-car count and what is checked')
        rows = page.locator('.health .checkrow').all_inner_texts()
        check(len(rows) == 2 and rows[0].startswith('Colour') and '10 missing' in rows[0] and rows[1].startswith('Name') and '1 missing' in rows[1], f'weakest first, only real gaps ({rows})')
        if os.environ.get('SHOTS'): page.locator('.health').screenshot(path='/tmp/health.png')
        page.locator('.health .checkrow', has_text='Colour').click(); page.wait_for_selector('text=My Garage')
        check('on' in (page.get_attribute('.chip:has-text("No colour")', 'class') or ''), 'Colour row opens Garage → No colour')
        page.evaluate("""(async () => { const st = await import('./js/store.js');
          for (const m of await st.list('models')) await st.update('models', m.model_id, { colour_family: 'red' }); })()""")
        page.goto(base + '#/dash'); page.wait_for_selector('.health')
        txt = page.inner_text('.health')
        rows = page.locator('.health .checkrow').all_inner_texts()
        check(rows[0].startswith('Synced to Google') and '10 missing' in rows[0] and not any(r.startswith('Colour') for r in rows), f'colours set; the 10 edits not yet synced become the gap ({rows})')
        page.locator('.health .checkrow', has_text='Name').click(); page.wait_for_timeout(600)
        check(page.url.endswith('#/name'), 'Name row opens the Name tab')
        # remove one rear photo → missing photo
        page.evaluate("""(async () => { const st = await import('./js/store.js'); const ph = (await st.list('photos')).find(p => p.shot_role === 'box_rear');
          await st.archive('photos', ph.photo_id); })()""")
        page.goto(base + '#/dash'); page.wait_for_selector('.health')
        check(page.locator('.tocheck .checkrow', has_text='Missing front or back photo').count() == 1, 'To check lists the missing photo')
        page.locator('.health .checkrow', has_text='Front + back photo').click(); page.wait_for_selector('text=My Garage'); page.wait_for_timeout(400)
        check(page.locator('.grid .tile').count() == 1, f'Garage → Missing photo shows the one car ({page.locator(".grid .tile").count()})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
