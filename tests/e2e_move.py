"""Developer test for s1-0.17.0 (B's phone feedback, 24 Nov 22:00):
- car page: Move box (existing box, new box, no box), one row per copy, warns when the box is brand/scale-only, logged
- Sync now greyed out ("Syncing…") while a sync runs
- photos counter drops as photos reach Drive
- a dropped connection mid-sync is retried once by itself
Fake Google; NOT a phone test.

Run:  python3 tests/e2e_move.py
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
    d = '/tmp/smg-move'; os.makedirs(d, exist_ok=True)
    for i in range(3):
        open(f'{d}/f{i}.jpg', 'wb').write(m.make_jpeg((150, 90 + 30 * i, 40), 3 + i)); open(f'{d}/r{i}.jpg', 'wb').write(m.make_jpeg((40, 90, 150 - 30 * i), 5 + i))
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    dialogs = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        drop = {'n': 0}
        def google(route, request):
            if drop['n'] > 0 and '/upload/drive/' in request.url:
                drop['n'] -= 1; return route.abort('connectionreset')
            return fake.handle(route, request)
        ctx.route('https://www.googleapis.com/**', google); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda dl: (dialogs.append(dl.message), dl.accept()))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')

        # --- Move box (local) on seeded cars in Box 1..15
        page.evaluate(SEED + '(30)')
        page.evaluate("""(async () => { const st = await import('./js/store.js'); const br = await st.list('brands');
          await st.create('storage_boxes', { box_label: 'Box 3', box_name: 'Le Mans', box_brand: br.find(b => b.name === 'Mini GT').brand_id, box_scale: 'mixed' }); })()""")
        mid = page.evaluate("""(async () => { const st = await import('./js/store.js'); const br = await st.list('brands');
          const hw = br.find(b => b.name === 'Hot Wheels').brand_id; const inv = await st.list('inventory');
          const ms = await st.list('models'); const mm = ms.find(x => x.brand_id === hw && inv.find(i => i.model_id === x.model_id).storage_location === 'Box 1'); return mm.model_id; })()""")
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('.pdp-actions')
        check(page.get_by_role('button', name='Move box').is_visible(), 'car page shows Move box next to Edit details and Remove')
        page.get_by_role('button', name='Move box').click(); page.wait_for_selector('.movebox')
        chips = page.locator('.movebox .chip').all_inner_texts()
        check(any(c.startswith('Box 1') for c in chips) and any('Box 3 · Le Mans' in c for c in chips) and '＋ New box' in chips and 'No box' in chips, f'offers existing boxes (with names), New box, No box ({chips[:4]}…)')
        page.locator('.movebox .chip', has_text='Box 3 · Le Mans').click(); page.wait_for_timeout(800)
        check(any('only Mini GT' in x for x in dialogs), 'moving a Hot Wheels into a Mini GT-only box asks first')
        loc = lambda: page.evaluate(f"(async () => (await (await import('./js/store.js')).list('inventory')).find(i => i.model_id === '{mid}').storage_location)()")
        check(loc() == 'Box 3', f'car moved to Box 3 ({loc()})')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => r.reason === 'moved to another box').map(r => [r.old_value, r.new_value]))()")
        check(['Box 1', 'Box 3'] in log, 'move is logged in the change history (Box 1 → Box 3)')
        page.get_by_role('button', name='Move box').click(); page.wait_for_selector('.movebox')
        page.locator('.movebox .chip', has_text='＋ New box').click(); page.wait_for_timeout(800)
        check(loc() == 'Box 16', f'＋ New box makes the next number and moves the car there ({loc()})')
        page.get_by_role('button', name='Move box').click(); page.wait_for_selector('.movebox')
        page.locator('.movebox .chip', has_text='No box').click(); page.wait_for_timeout(800)
        check(loc() == '', 'No box takes it out of its box')
        page.evaluate(f"""(async () => {{ const st = await import('./js/store.js'); await st.create('inventory', {{ model_id: '{mid}', ownership_status: 'Owned', storage_location: 'Box 2' }}); }})()""")
        page.reload(); page.wait_for_selector('.pdp-actions'); page.get_by_role('button', name='Move box').click(); page.wait_for_selector('.movebox')
        check(page.locator('.movebox p', has_text='Copy 2 · now Box 2').count() == 1, 'two copies: one row per copy')

        # --- Sync: button greyed while syncing, counter drops, dropped connection retried
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        page.fill('input[placeholder^="OAuth Client ID"]', 'test-client.apps.googleusercontent.com')
        page.get_by_role('button', name='Sign in & set up').click(); page.wait_for_selector('text=Synced:', timeout=60000)
        for i in range(3):
            page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
            for role, f in (('Box front', f'f{i}'), ('Barcode side', f'r{i}')):
                with page.expect_file_chooser() as fc: page.get_by_text(role, exact=False).first.click()
                fc.value.set_files(f'{d}/{f}.jpg'); page.wait_for_selector(f'text={role} ✓')
            page.select_option('select[aria-label="Brand"]', label='Mini GT'); page.wait_for_timeout(200)
            page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(200)
            page.fill('input[placeholder^="e.g. Range Rover"]', f'Move test {i}'); page.wait_for_timeout(300)
            page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('text=Saved ✓')
        page.goto(base + '#/settings'); page.wait_for_selector('.syncbtn')
        card0 = page.inner_text('.card:has(.syncbtn)')
        check('photos not uploaded yet' in card0 or 'photo not uploaded yet' in card0, f'counter shows photos still to upload ({card0[:90]!r})')
        drop['n'] = 2
        page.locator('.syncbtn').click()
        check(page.locator('.syncbtn').is_disabled() and page.inner_text('.syncbtn') == 'Syncing…', 'Sync now is greyed out and says Syncing… while it runs')
        for _ in range(120):
            if not page.locator('.syncbtn').is_disabled(): break
            page.wait_for_timeout(500)
        page.wait_for_timeout(500)
        msg = page.inner_text('#syncMsg'); card = page.inner_text('.card:has(.syncbtn)')
        check(msg.startswith('Synced:') and 'error' not in msg, f'dropped uploads were retried and the sync finished cleanly ({msg[:80]})')
        check('Nothing waiting to sync' in card, f'nothing left waiting after the retry ({card[:90]!r})')
        n_files = len([f for f in fake.files.values() if f.get('appProperties', {}).get('smgPhotoId')])
        check(n_files == 6 * 3, f'each photo uploaded once (3 files × 6 photos = 18; got {n_files})')
        check(page.inner_text('.syncbtn') == 'Sync now' and not page.locator('.syncbtn').is_disabled(), 'button back to Sync now afterwards')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
