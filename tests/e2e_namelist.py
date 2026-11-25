"""Developer test for s1-0.28.0: faster Gemini rounds — all suggestions checked on one page, edit / untick / discard,
one Save for the batch, next batch prepared straight after. Fake data; NOT a phone test.

Run:  python3 tests/e2e_namelist.py
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
        page.evaluate(SEED + '(6)')
        page.evaluate("""(async () => {
          const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          for (const r of ms) { r.data.display_name = ''; r.data.product_code = ''; r.data.product_code_cmp = ''; r.data.colour_family = ''; } await idb.records.putMany(ms);
          await st.create('ai_log', { ai_log_id: 'ai_nl', prompt_version: 'names-v8' });
          await idb.meta.set('aiSuggest', {
            [ms[0].id]: { name: 'Nissan Skyline GT-R R34', code: 'MGT00341', brand: 'Mini GT', colour: 'Bayside Blue', carNote: 'History: raced at Fuji.', notes: [], logId: 'ai_nl', pv: 5 },
            [ms[1].id]: { name: 'Porsche 911 GT3 RS', code: 'MGT00500', brand: 'Mini GT', colour: 'Red', carNote: '', notes: [], logId: 'ai_nl', pv: 5 },
            [ms[2].id]: { name: 'Honda NSX', code: 'MGT00777', brand: 'Mini GT', colour: '', carNote: '', notes: [], logId: 'ai_nl', pv: 5 },
            [ms[3].id]: { name: 'Toyota Supra', code: '', brand: 'Mini GT', colour: '', carNote: '', notes: [], logId: 'ai_nl', pv: 5 } });
        })()""")
        page.goto(base + '#/name'); page.wait_for_selector('.namelist')
        check(page.locator('.nl-row').count() == 4, 'all 4 suggestions on one page')
        if os.environ.get('SHOTS'): page.wait_for_timeout(600); page.screenshot(path='/tmp/namelist.png')
        check(page.inner_text('#nameSaveAll') == 'Save 4', 'one Save button for the batch (Save 4)')
        check(page.locator('.nl-row >> nth=0 >> .cdot').count() == 1, 'colour from Gemini shown with its dot')
        rows = page.locator('.nl-row')
        rows.nth(1).locator('input[aria-label="Name"]').fill('Porsche 911 GT3 RS (992)')    # B fixes one
        rows.nth(2).locator('input[aria-label="Save this one"]').uncheck()                   # unsure about one
        check(page.inner_text('#nameSaveAll') == 'Save 3', 'unticking updates the count (Save 3)')
        rows.nth(3).get_by_role('button', name='Discard suggestion').click(); page.wait_for_timeout(700)  # wrong one goes back to Gemini
        check(page.locator('.nl-row').count() == 3, 'discard removes that suggestion from the page')
        page.locator('.nl-row').nth(2).locator('input[aria-label="Save this one"]').uncheck()
        page.locator('.nl-row').nth(0).locator('input[aria-label="Name"]').fill('')
        page.locator('#nameSaveAll').click(); page.wait_for_timeout(400)
        check(page.is_visible('text=A ticked car has no name'), 'a ticked car with no name is refused, nothing saved')
        page.locator('.nl-row').nth(0).locator('input[aria-label="Name"]').fill('Nissan Skyline GT-R R34')
        page.locator('#nameSaveAll').click(); page.wait_for_timeout(1500)
        ms = page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(m => [m.display_name, m.product_code, m.colour_family, m.car_note, m.identification_status]))()")
        check(ms[0][:4] == ['Nissan Skyline GT-R R34', 'MGT00341', 'blue', 'History: raced at Fuji.'] and ms[0][4] == 'confirmed', f'car 1 saved with code, colour and note ({ms[0]})')
        check(ms[1][0] == 'Porsche 911 GT3 RS (992)' and ms[1][2] == 'red', f"B's edit saved ({ms[1][0]})")
        check(ms[2][0] == '' and ms[3][0] == '', 'unticked and discarded cars not saved')
        left = page.evaluate("(async () => Object.keys((await (await import('./js/idb.js')).meta.get('aiSuggest'))).length)()")
        check(left == 1, 'the unticked suggestion stays for later')
        conf = page.evaluate("(async () => JSON.parse((await (await import('./js/store.js')).get('ai_log', 'ai_nl')).confirmed_values || '{}'))()")
        check(len(conf) == 2 and any(v['edited'] for v in conf.values()), 'AI_LOG records both confirmations, one marked edited')
        check(page.locator('text=photos ready').count() == 1, 'next batch prepared straight after saving (no extra tap)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
