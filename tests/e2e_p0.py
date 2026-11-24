"""Developer test for release s1-0.2.0 (audit P0 fixes). NOT a phone acceptance test.
Runs the app in headless Chrome at phone size against the FAKE Google from e2e_mock.py.

Run:  python3 tests/e2e_p0.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

SHOTS = '/tmp/smg-p0'


def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)

    httpd = m.serve()
    fake = m.FakeGoogle()
    tmp = '/tmp/smg-p0-img'; os.makedirs(tmp, exist_ok=True); os.makedirs(SHOTS, exist_ok=True)
    for k, c, s in [('a', (150, 90, 40), 3), ('b', (40, 90, 150), 5), ('c', (90, 150, 40), 7)]:
        open(f'{tmp}/{k}.jpg', 'wb').write(m.make_jpeg(c, s))
    base = f'http://localhost:{m.PORT}/'

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 400, 'height': 860}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle)
        ctx.route('https://sheets.googleapis.com/**', fake.handle)
        pill = lambda: page.inner_text('#status')
        ev = lambda js: page.evaluate(js)
        count = lambda ent: ev(f"(async () => (await (await import('./js/store.js')).list('{ent}')).length)()")

        def pick(text, path):
            with page.expect_file_chooser() as fc:
                page.get_by_text(text, exact=False).first.click()
            fc.value.set_files(path)

        def start_box(brand='Mini GT', front='a', rear='b'):
            page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
            pick('Box front', f'{tmp}/{front}.jpg'); page.wait_for_selector('text=Box front ✓')
            pick('Box rear', f'{tmp}/{rear}.jpg'); page.wait_for_selector('text=Box rear ✓')
            page.select_option('select', label=brand); page.wait_for_timeout(200)
            page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(200)

        # S1: fresh install
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.wait_for_timeout(400)
        check(pill() == 'Nothing to sync', f'S1 fresh install pill says "Nothing to sync" (got "{pill()}")')

        # D2: new product banner is neutral, not green
        start_box()
        page.fill('input[inputmode=numeric]', '840456393215')
        page.fill('input[placeholder^="e.g. Range Rover"]', 'Range Rover 1981 Camel Trophy')
        page.locator('input[autocapitalize=characters]').fill('MGT01311-L'); page.wait_for_timeout(300)
        cls = page.locator('text=Not in your garage yet').first.get_attribute('class')
        check('new' in cls and 'ok' not in cls, f'D2 "Not in your garage yet" banner is neutral (class "{cls}")')
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('.toast'); page.wait_for_timeout(500)

        # S1 + S2: one box, not signed in
        check(pill() == 'Sign in to sync · 1 box', f'S1/S2 after 1 box pill says "Sign in to sync · 1 box" (got "{pill()}")')
        page.screenshot(path=f'{SHOTS}/01-pill-sign-in.png')

        # D2: exact duplicate banner uses the "have" style
        start_box(front='c')
        page.locator('input[autocapitalize=characters]').fill('mgt01311-l'); page.wait_for_timeout(300)
        cls = page.locator('.banner', has_text='You already own this').first.get_attribute('class')
        check('have' in cls and 'bad' not in cls, f'D2 exact duplicate banner is not red (class "{cls}")')
        page.get_by_role('button', name='Discard').click(); page.wait_for_timeout(300)

        # D1: barcode-only possible match can be added as a copy, no new model
        start_box(front='b', rear='c')
        page.fill('input[inputmode=numeric]', '840456393215'); page.wait_for_timeout(400)
        btn = page.get_by_role('button', name='Same model: add as copy')
        check(btn.count() == 1, 'D1 possible match shows "Same model: add as copy"')
        check(page.locator('.banner.warn a', has_text='Open').count() == 1, 'D1 possible match shows "Open"')
        page.locator('.banner.warn').scroll_into_view_if_needed(); page.screenshot(path=f'{SHOTS}/02-possible-match.png')
        models_before, inv_before = count('models'), count('inventory')
        btn.click(); page.wait_for_selector('text=Added as another copy'); page.wait_for_timeout(300)
        check(count('models') == models_before and count('inventory') == inv_before + 1,
              f'D1 add-as-copy adds a copy, not a model (models {models_before}->{count("models")}, copies {inv_before}->{count("inventory")})')

        # C6: box art taken then Sealed unticked -> box art not saved
        start_box(brand='Pop Race')
        page.locator('input[type=checkbox]').click(); page.wait_for_selector('text=Box art (sealed box)')
        pick('Box art (sealed box)', f'{tmp}/c.jpg'); page.wait_for_selector('text=Box art (sealed box) ✓')
        page.locator('input[type=checkbox]').click(); page.wait_for_timeout(300)
        page.fill('input[placeholder^="e.g. Range Rover"]', 'Unsealed after art')
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('.toast'); page.wait_for_timeout(400)
        roles = ev("""(async () => { const s = await import('./js/store.js'); const ms = await s.list('models');
          const mm = ms.find(x => x.display_name === 'Unsealed after art'); return (await s.list('photos')).filter(p => p.model_id === mm.model_id).map(p => p.shot_role); })()""")
        check('box_art' not in roles, f'C6 hidden box-art photo not saved (roles {roles})')

        # C4: capture times recorded under the new key
        times = ev("(async () => (await (await import('./js/idb.js')).meta.get('captureTimesV2', [])))()")
        check(len(times) == 3, f'C4 capture time logged for each save and copy (got {len(times)})')

        # C5: box in progress survives a reload
        start_box(brand='Tomica')
        page.fill('input[placeholder^="e.g. Range Rover"]', 'Draft survives reload'); page.wait_for_timeout(900)
        page.reload(); page.wait_for_selector('text=Quick capture'); page.wait_for_timeout(500)
        check(page.is_visible('text=Restored the box you were working on'), 'C5 restore banner shown after reload')
        check(page.input_value('input[placeholder^="e.g. Range Rover"]') == 'Draft survives reload', 'C5 name restored')
        check(page.is_visible('text=Box front ✓') and page.is_visible('text=Box rear ✓'), 'C5 photos restored')
        page.screenshot(path=f'{SHOTS}/03-draft-restored.png')
        page.get_by_role('button', name='Discard').click(); page.wait_for_timeout(400)
        page.reload(); page.wait_for_selector('text=Quick capture'); page.wait_for_timeout(400)
        check(not page.is_visible('text=Restored the box'), 'C5 Discard clears the draft')

        # I1: edit then "Mark complete" keeps the edit; edit then leave keeps the edit
        mid = ev("(async () => (await (await import('./js/store.js')).list('models')).find(x => x.display_name.startsWith('Range Rover')).model_id)()")
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('text=Product')
        page.locator('.card input').first.fill('Edited then Mark complete')
        page.get_by_role('button', name='Mark complete').click(); page.wait_for_timeout(600)
        got = ev(f"(async () => (await (await import('./js/store.js')).get('models', '{mid}')))()")
        check(got['display_name'] == 'Edited then Mark complete' and got['completeness_status'] == 'complete', 'I1 Mark complete keeps the typed name')
        page.evaluate('window.scrollTo(0,0)')
        page.locator('.card input').first.fill('Edited then left the page')
        page.get_by_text('← Garage').click(); page.wait_for_selector('text=My Garage'); page.wait_for_timeout(500)
        got = ev(f"(async () => (await (await import('./js/store.js')).get('models', '{mid}')))()")
        check(got['display_name'] == 'Edited then left the page', f"I1 leaving the page keeps the typed name (got '{got['display_name']}')")

        # S3: offline sync error is not green
        ctx.set_offline(True); page.wait_for_timeout(300)
        page.click('#syncBtn'); page.wait_for_selector('.toast'); page.wait_for_timeout(100)
        cls = page.locator('.toast').first.get_attribute('class')
        check('warn' in cls or 'bad' in cls, f'S3 offline sync toast is amber/red (class "{cls}")')
        page.screenshot(path=f'{SHOTS}/04-offline-toast.png')
        ctx.set_offline(False); page.evaluate("window.dispatchEvent(new Event('online'))"); page.wait_for_timeout(300)

        # S2: tapping the pill signs in and syncs
        ev("localStorage.setItem('smg.clientId', 'test-client.apps.googleusercontent.com')")
        page.click('#status')
        for _ in range(100):
            if pill() == 'All synced': break
            page.wait_for_timeout(200)
        check(pill() == 'All synced', f'S2 tapping the pill signs in and syncs (pill "{pill()}")')
        sid = next(iter(fake.sheets)); book = fake.sheets[sid]
        check(len(book['MODELS']) == 1 + 2 and len(book['INVENTORY']) == 1 + 3, f"sheet has 2 models + 3 copies (MODELS {len(book['MODELS'])-1}, INVENTORY {len(book['INVENTORY'])-1})")

        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account'); page.wait_for_timeout(300)
        txt = page.inner_text('main')
        check('Nothing waiting to sync.' in txt, 'Settings shows "Nothing waiting to sync."')
        check('median' in txt and 'time spent on each box only' in txt, 'Settings shows the new capture-time median')
        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:3]})')
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
