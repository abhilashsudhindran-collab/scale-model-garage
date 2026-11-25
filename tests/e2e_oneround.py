"""Developer test for s1-0.39.0: ONE Gemini round does everything (B, 25 Nov). Nameless boxes and named cars missing a
code/colour/note go in the same round; one share, one paste, one check page, one Save fills name, code, colour and
note; a car Gemini already had a go at isn't sent again. Simulated share; NOT a phone test.

Run:  python3 tests/e2e_oneround.py
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright
from e2e_combine import MOCK


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}); ctx.add_init_script(MOCK)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.evaluate("localStorage.setItem('smg.motion', 'off')")
        page.evaluate(SEED + '(4)')
        page.evaluate("""(async () => { const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          const d = (k) => ms[k].data;
          for (const k of [0, 1]) Object.assign(d(k), { display_name: '', product_code: '', product_code_cmp: '', colour_family: '', car_note: '' });
          Object.assign(d(2), { display_name: 'Porsche 917K', product_code: 'T64-001', product_code_cmp: 'T64-001', colour_family: '', car_note: '' });
          Object.assign(d(3), { display_name: 'Complete car', colour_family: 'red', colour_name: 'Red', car_note: 'History: done.', car_note_source: 'gemini' });
          await idb.records.putMany(ms); })()""")
        page.goto(base + '#/name'); page.wait_for_selector('text=Names, codes, colours and notes from Gemini')
        hdr = page.inner_text('.row:has(h2)')
        check('2 boxes need a name' in hdr and '1 named car misses a code, colour or note' in hdr, f'header counts both kinds ({hdr.splitlines()[-1]})')
        btn = page.get_by_role('button', name='Do the next 3 boxes with Gemini')
        check(btn.count() == 1, 'one button covers all 3 (2 unnamed + 1 incomplete); the complete car is left out')
        btn.click(); page.wait_for_selector('text=photos ready', timeout=20000)
        page.get_by_role('button', name='Share to Gemini or Claude').click(); page.wait_for_selector('.pastehint')
        sh = page.evaluate('window.__shared')
        check('Porsche 917K' in sh['text'] and sh['n'] == 6, 'one share: 3 boxes, the named one marked as already named')
        ans = '| Box | Car name | Year | Product code | Brand | Colour | Note |\n|---|---|---|---|---|---|---|\n' + \
              '| Box 1 | Ford GT40 Mk II | 1966 | MGT00500 | Mini GT | Blue | History: Won Le Mans in 1966. |\n' + \
              '| Box 2 | Nissan R390 | 1998 | - | Mini GT | White | Fun fact: Only a few road cars. |\n' + \
              '| Box 3 | Porsche 917K Gulf | 1970 | T64-001 | Tarmac | Light blue | Pop culture: Le Mans, the film. |'
        page.evaluate(f'window.__clip = {json.dumps(ans)}')
        page.get_by_role('button', name='📋 Paste & use').click(); page.wait_for_selector('.namelist')
        rows = page.locator('.nl-row')
        check(rows.count() == 3, 'one check page with all 3')
        r3 = rows.nth(2)
        check(r3.locator('input[aria-label="Name"]').input_value() == 'Porsche 917K' and 'Gemini read the name as' in r3.inner_text(), 'named car keeps its name; Gemini\'s reading shown')
        check('Note: History: Won Le Mans' in rows.nth(0).inner_text(), 'the note to be saved is previewed')
        page.locator('#nameSaveAll').click(); page.wait_for_timeout(2500)
        ms = page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(m => [m.display_name, m.product_code, m.colour_family, (m.car_note || '').slice(0, 12)]))()")
        print('   saved:', ms[:3])
        check(ms[0][0].startswith('Ford GT40 Mk II') and ms[0][1:] == ['MGT00500', 'blue', 'History: Won'], 'unnamed box 1: name, code, colour and note in one save')
        check(ms[1][0].startswith('Nissan R390') and ms[1][1] == '' and ms[1][2] == 'white', "unnamed box 2: no code where Gemini couldn't read one")
        check(ms[2][0] == 'Porsche 917K' and ms[2][1] == 'T64-001' and ms[2][2] == 'blue' and ms[2][3].startswith('Pop culture'), 'named car: name and code kept, colour and note added')
        page.goto(base + '#/name'); page.wait_for_timeout(800)
        check(page.is_visible('text=Every car has its name, code, colour and note'), "done; the code-less car isn't sent again")
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
