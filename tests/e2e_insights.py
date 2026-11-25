"""Developer test for s1-0.41.0: Collection insights on the Dashboard (facts, cars added per day,
by colour, car notes, by model year). Fake data; NOT a phone test.

Run:  python3 tests/e2e_insights.py
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
        # 30 cars: colours on 20, notes on 12 (8 History by Gemini, 4 Casting by B), years on 10,
        # front photos over 3 days (10 on 22 Nov, none on 23 Nov, 20 on 24 Nov)
        page.evaluate("""(async () => { const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.display_name.localeCompare(b.data.display_name));
          const order = new Map(ms.map((r, k) => [r.id, k]));
          ms.forEach((r, k) => { if (k < 20) r.data.colour_family = k < 12 ? 'red' : 'blue';
            if (k < 8) { r.data.car_note = 'History: Note ' + k + '.'; r.data.car_note_source = 'gemini'; }
            else if (k < 12) { r.data.car_note = 'Casting: Rare one ' + k + '.'; r.data.car_note_source = 'you'; }
            if (k < 10) r.data.release_year = k < 6 ? '1995' : '2021'; });
          await idb.records.putMany(ms);
          const ps = await idb.records.byEntity('photos');
          ps.forEach(r => { const k = order.get(r.data.model_id); const d = k < 10 ? '2026-11-22' : '2026-11-24';
            r.data.captured_at = new Date(d + 'T10:' + String(k % 60).padStart(2, '0') + ':00').toISOString(); });
          await idb.records.putMany(ps); })()""")
        page.goto(base + '#/dash'); page.wait_for_selector('text=Collection insights')
        check(page.locator('.facts .fact').count() == 3, 'three facts at a glance')
        facts = page.inner_text('.facts')
        check('top brand' in facts and 'fullest storage box' in facts, f'top brand and fullest box shown ({facts[:60]!r})')
        check('Duplicates' in facts and 'none yet' in facts, 'no duplicates in the sample')
        cols = page.locator('.cols .col')
        check(cols.count() == 3, f'one column per day, empty day kept ({cols.count()})')
        check(page.locator('.cols .col').nth(1).get_attribute('title').endswith('0 cars'), 'middle day shows 0 cars')
        check('Busiest day: 24 Nov, 20 cars' in page.inner_text('body'), 'busiest day named')
        colour = page.locator('.card:has(h3:text-is("By colour"))')
        check(colour.count() == 1 and 'Red' in colour.inner_text() and 'Colour saved for 20 of 30 cars' in colour.inner_text(), 'by colour with how many have a colour')
        check(colour.locator('.cdot').count() == 2, 'colour swatches beside each colour')
        notes = page.locator('.card:has(h3:text-is("Car notes"))').inner_text()
        check('History' in notes and 'Casting' in notes and '12 cars have a note' in notes and '4 written or edited by you, 8 from Gemini' in notes, 'note kinds and who checked them')
        yrs = page.locator('.card:has(h3:text-is("By model year"))').inner_text()
        check('1990s' in yrs and '2020s' in yrs and 'Year saved for 10 of 30' in yrs, 'by model year, with coverage')
        if os.environ.get('SHOTS'):
            page.locator('.facts').screenshot(path='/tmp/ins-facts.png'); page.locator('.card:has(.cols)').screenshot(path='/tmp/ins-cols.png')
            page.set_viewport_size({'width': 1280, 'height': 900}); page.wait_for_timeout(600); page.locator('text=Collection insights').scroll_into_view_if_needed(); page.screenshot(path='/tmp/ins-wide.png'); page.set_viewport_size({'width': 400, 'height': 860}); page.wait_for_timeout(600)
        page.locator('.facts .fact').first.click(); page.wait_for_selector('text=My Garage')
        check(page.input_value('input[type=search]') != '', 'tapping top brand opens the Garage filtered to it')
        page.goto(base + '#/dash'); page.wait_for_selector('text=Collection insights')
        colour = page.locator('.card:has(h3:text-is("By colour"))')
        colour.locator('.barrow').first.click(); page.wait_for_selector('text=My Garage')
        check('on' in (page.get_attribute('.chip:text-is("By colour")', 'class') or ''), 'tapping a colour opens Garage → By colour')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
