"""Developer test for s1-0.16.0: the in-memory read cache never shows stale rows (same tab, a second tab), and
the Garage list pages with "Show more" at a big size. Fake Google; NOT a phone test.

Run:  python3 tests/e2e_cache.py
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
        page.evaluate(SEED + '(400)'); page.reload(); page.wait_for_selector('.grid .tile')

        tiles = lambda: page.locator('.grid .tile').count()
        check(tiles() == 120 and page.is_visible('text=Showing 120 of 400'), f'first page shows 120 of 400 ({tiles()})')
        page.locator('.showmore').click(); page.wait_for_timeout(400)
        check(tiles() == 360, f'Show more adds 240 ({tiles()})')
        page.locator('.showmore').click(); page.wait_for_timeout(400)
        check(tiles() == 400 and page.locator('.showmore').count() == 0, 'all 400 shown, button gone')
        page.fill('input[type=search]', 'skyline'); page.wait_for_timeout(400)
        check(tiles() == 40, f'search narrows (40 Skylines; {tiles()})')
        page.fill('input[type=search]', ''); page.wait_for_timeout(400)
        check(tiles() == 120, 'clearing the search starts at the top again')
        page.locator('.chip', has_text='By box').click(); page.wait_for_timeout(500)
        check(page.locator('.grid h3.group').first.inner_text().startswith('Box 1'), 'By box starts at Box 1')

        # Same tab: a caller changing what it got must not change the cache
        r = page.evaluate("""(async () => { const idb = await import('./js/idb.js');
          const a = await idb.records.byEntity('models'); a[0].data.display_name = 'MUTATED';
          const b = await idb.records.byEntity('models'); return b.some(x => x.data.display_name === 'MUTATED'); })()""")
        check(r is False, 'changing a returned list does not leak into the cache')
        # Same tab: a write is seen by the next read
        r = page.evaluate("""(async () => { const idb = await import('./js/idb.js');
          const a = await idb.records.byEntity('models'); a[0].data.display_name = 'RENAMED IN TAB 1'; await idb.records.put(a[0]);
          return (await idb.records.byEntity('models')).some(x => x.data.display_name === 'RENAMED IN TAB 1'); })()""")
        check(r is True, 'a write is seen by the next read in the same tab')

        # Second tab: warm its cache, write in tab 1, tab 2 must see it
        page2 = ctx.new_page(); page2.goto(base + '#/'); page2.wait_for_selector('.grid .tile')
        page2.evaluate("(async () => (await (await import('./js/idb.js')).records.byEntity('models')).length)()")
        page.evaluate("""(async () => { const idb = await import('./js/idb.js');
          const a = await idb.records.byEntity('models'); a[1].data.display_name = 'FROM TAB 1'; await idb.records.put(a[1]); })()""")
        page2.wait_for_timeout(300)
        r = page2.evaluate("(async () => (await (await import('./js/idb.js')).records.byEntity('models')).some(x => x.data.display_name === 'FROM TAB 1'))()")
        check(r is True, 'another open tab sees the change (cache dropped there too)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
