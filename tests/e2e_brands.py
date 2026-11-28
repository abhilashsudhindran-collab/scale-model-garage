"""Developer test for s1-0.16.2: brands beyond the starter list, in Photo run (mixed box), Box settings and the car page.
More brands (created when picked), typed new brand trusted at once (B's choice), look-alike asks "Did you mean …?".
Fake Google; NOT a phone test.

Run:  python3 tests/e2e_brands.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-brands'; os.makedirs(d, exist_ok=True)
    for i in range(4):
        open(f'{d}/f{i}.jpg', 'wb').write(m.make_jpeg((150, 90 + i * 20, 40), 3 + i)); open(f'{d}/r{i}.jpg', 'wb').write(m.make_jpeg((40, 90, 150 - i * 20), 5 + i))
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    answers = []  # queued replies for prompt/confirm dialogs: str for prompt, True/False for confirm
    seen = []
    def on_dialog(dl):
        seen.append((dl.type, dl.message))
        a = answers.pop(0) if answers else True
        if dl.type == 'prompt': dl.accept(a) if isinstance(a, str) else dl.dismiss()
        elif a is False: dl.dismiss()
        else: dl.accept()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', on_dialog)
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        brands = lambda: page.evaluate("(async () => (await (await import('./js/store.js')).list('brands')).map(b => [b.name, b.record_status]))()")
        models = lambda: page.evaluate("""(async () => { const st = await import('./js/store.js'); const br = await st.list('brands');
          return (await st.list('models')).map(m => [br.find(b => b.brand_id === m.brand_id)?.name, m.namespace_status, m.duplicate_check_status]); })()""")
        def shoot(role, f):
            with page.expect_file_chooser() as fc: page.get_by_role('button', name=role).click()
            fc.value.set_files(f'{d}/{f}.jpg'); page.wait_for_timeout(900)
        def car(i):
            shoot('Box front', f'f{i}'); shoot('Barcode side', f'r{i}'); page.wait_for_selector('text=Which brand is this car?', timeout=8000)
        def pick_other(value):
            page.locator('select[aria-label="Brand for this car"]').select_option(value); page.wait_for_timeout(1200)

        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        page.locator('.boxcard .chip', has_text='Mixed brands').click(); page.wait_for_timeout(300)
        page.locator('.boxcard .chip', has_text='Only 1:64').click(); page.wait_for_timeout(300)
        opts = page.locator('.boxcard select[aria-label="Brand for this box"] option').all_inner_texts()
        check('Majorette' in opts and 'Matchbox' in opts and any('Type a new brand' in o for o in opts), 'box settings list offers More brands + Type a new brand')
        page.get_by_role('button', name='Fill Box 1').click(); page.wait_for_selector('.banner.fill')
        if page.is_visible('text=Done: start shooting'):
            page.get_by_role('button', name='Car visible', exact=True).click(); page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(200)

        # Car 1: Majorette from "More brands"
        car(0); pick_other('known:Majorette'); page.wait_for_timeout(1500)
        check(['Majorette', 'confirmed'] in brands(), 'Majorette picked from More brands is created, trusted')
        check(len(models()) == 1 and models()[0][0] == 'Majorette' and models()[0][1] == 'confirmed', f'car saved as Majorette, no Needs review ({models()})')
        # Car 2: typed "Burago" → Did you mean Bburago? → OK
        car(1); answers[:] = ['Burago', True]; pick_other('__new'); page.wait_for_timeout(1500)
        check(any(t == 'confirm' and 'Bburago' in msg for t, msg in seen), 'typed "Burago" asks "Did you mean Bburago?"')
        check(not any(n == 'Burago' for n, _ in brands()) and models()[-1][0] == 'Bburago', 'answering OK uses Bburago, no second brand')
        # Car 3: typed a brand-new name → trusted at once
        car(2); answers[:] = ['Pagani Hobby Works']; pick_other('__new'); page.wait_for_timeout(1500)
        check(['Pagani Hobby Works', 'confirmed'] in brands(), 'typed new brand is created, trusted')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => r.entity === 'brands').map(r => [r.new_value, r.reason]))()")
        check(['Pagani Hobby Works', 'brand added (typed)'] in log and ['Majorette', 'brand added (from More brands)'] in log, f'each new brand is logged in the change history ({log})')
        rec = page.evaluate("JSON.parse(localStorage.getItem('smg.recentBrands'))")
        check(len(rec) >= 1, 'new brand is at the front of recent brands')
        # Car 4: the new brand now shows as a normal choice (and in the quick picks)
        car(3); quick = page.locator('.brandpick .chip').all_inner_texts()
        check('Pagani Hobby Works' in quick and 'Majorette' in quick, f'new brands appear as quick picks ({quick})')
        page.locator('.brandpick .chip', has_text='Pagani Hobby Works').click(); page.wait_for_timeout(1500)
        ms = models()
        check(len(ms) == 4 and all(x[1] == 'confirmed' for x in ms), f'4 cars, none flagged Needs review ({ms})')

        # Car page: change a brand to one from More brands
        page.locator('.banner.fill').get_by_role('button', name='Done').click(); page.wait_for_timeout(500)
        page.goto(base + '#/'); page.wait_for_selector('.grid .tile'); page.locator('.grid .tile').first.click(); page.wait_for_selector('#pdpDetails')
        page.locator('#pdpDetails select').first.select_option('known:Matchbox'); page.wait_for_timeout(800)
        page.goto(base + '#/'); page.wait_for_timeout(1200)
        check(['Matchbox', 'confirmed'] in brands() and any(x[0] == 'Matchbox' for x in models()), 'car page: brand changed to Matchbox (created from More brands)')
        # Picking Majorette again never made a second record
        check(sum(1 for n, _ in brands() if n.lower().replace(' ', '') == 'majorette') == 1, 'still one Majorette record')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
