"""Developer test for s1-0.46.0: Needs review (Dashboard card, five kinds, one-tap fixes, "Not a problem"
remembered and undone by a change). Fake data; NOT a phone test.

Run:  python3 tests/e2e_review.py
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
        page.on('dialog', lambda d: d.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(12)')  # 6 brands × 2; codes MGT000NN-L, unique barcodes
        page.goto(base + '#/dash'); page.wait_for_selector('.reviewlink')
        check('Nothing the app is unsure about' in page.inner_text('.reviewlink'), 'clean garage: nothing to review')
        info = page.evaluate("""(async () => { const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await st.list('models')).sort((a, b) => a.display_name.localeCompare(b.display_name));
          const hw = (await st.list('brands')).find(b => b.name === 'Hot Wheels');
          // a typed brand nobody checked, on one car, that looks like Hot Wheels
          const nb = await st.create('brands', { name: 'Hotwheels', record_status: 'needs_review' });
          await st.update('models', ms[0].model_id, { brand_id: nb.brand_id, namespace_status: 'needs_review', duplicate_check_status: 'needs_review' });
          // same code as another car of the same brand → possible duplicate
          const hwCars = ms.filter(m => m.brand_id === hw.brand_id);
          await st.update('models', hwCars[1].model_id, { product_code: hwCars[0].product_code, product_code_cmp: hwCars[0].product_code_cmp });
          // Gemini unsure code on a car with no code
          await st.update('models', ms[5].model_id, { product_code: '', product_code_cmp: '' });
          await idb.meta.set('aiSuggest', { [ms[5].model_id]: { notes: ["AI wasn't sure of the code (it said: \\"MGT00733 or similar\\"). Read it from the box."] } });
          return { first: ms[0].model_id, nb: nb.brand_id, dupe: hwCars[0].model_id }; })()""")
        page.reload(); page.wait_for_selector('.reviewlink.has')
        check('4 things' in page.inner_text('.reviewlink'), f'Dashboard card counts them ({page.inner_text(".reviewlink")!r})')
        page.locator('.reviewlink').click(); page.wait_for_selector('.review')
        heads = page.locator('.ghead .g-name').all_inner_texts()
        check(heads == ['Brands to confirm', 'Same car twice?', 'Look-alike brands', "Codes Gemini wasn't sure of"], f'grouped, most important first ({heads})')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/review.png', full_page=True)
        # confirm the brand
        page.locator('.review.r-brand button', has_text='Hotwheels is right').click(); page.wait_for_timeout(600)
        st = page.evaluate(f"(async () => {{ const st = await import('./js/store.js'); return [(await st.get('brands', '{info['nb']}')).record_status, (await st.get('models', '{info['first']}')).namespace_status]; }})()")
        check(st == ['confirmed', 'confirmed'], f'"is right" confirms the brand and its car ({st})')
        check(page.locator('.review.r-brand').count() == 0, 'brand item gone')
        # look-alike: Different brands → remembered
        page.locator('.review.r-alike button', has_text='Different brands').click(); page.wait_for_timeout(500)
        check(page.locator('.review.r-alike').count() == 0, '"Different brands" hides the look-alike')
        page.reload(); page.wait_for_selector('.review')
        check(page.locator('.review.r-alike').count() == 0, '…and stays hidden after reopening')
        # duplicate → Compare & merge opens the car with the merge panel
        page.locator('.review.r-dupe button', has_text='Compare & merge').click(); page.wait_for_selector('#mergePanel', timeout=8000)
        check(info['dupe'] in page.url or page.locator('#mergePanel').count() == 1, 'Compare & merge opens the car with the merge panel')
        # unsure → typing a code clears it
        page.goto(base + '#/review'); page.wait_for_selector('.review.r-unsure')
        page.locator('.review.r-unsure button', has_text='Open car').click(); page.wait_for_selector('#pdpDetails')
        page.locator('#pdpDetails input').nth(1).fill('MGT00733'); page.click('#pdpSave'); page.wait_for_timeout(600)
        page.goto(base + '#/review'); page.wait_for_timeout(800)
        check(page.locator('.review.r-unsure').count() == 0, 'typing the code clears the unsure item')
        # dupe: Not the same car
        page.locator('.review.r-dupe button', has_text='Not the same car').click(); page.wait_for_timeout(500)
        check('Nothing needs review' in page.inner_text('body') and 'marked "Not a problem"' in page.inner_text('body'), 'all clear, with a count of dismissed items')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
