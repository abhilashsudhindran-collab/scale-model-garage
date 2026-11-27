"""Developer test for release s1-0.4.0 (storage boxes, overview, backups, photos on another device).
NOT a phone acceptance test. Headless Chrome at phone size against the FAKE Google from e2e_mock.py.

Run:  python3 tests/e2e_p2.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

SHOTS = '/tmp/smg-p2'
CID = 'test-client.apps.googleusercontent.com'


def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)

    httpd = m.serve()
    fake = m.FakeGoogle()
    tmp = '/tmp/smg-p2-img'; os.makedirs(tmp, exist_ok=True); os.makedirs(SHOTS, exist_ok=True)
    for k, c, s in [('a', (150, 90, 40), 3), ('b', (40, 90, 150), 5), ('c', (90, 150, 40), 7)]:
        open(f'{tmp}/{k}.jpg', 'wb').write(m.make_jpeg(c, s))
    base = f'http://localhost:{m.PORT}/'

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        errors = []

        def new_device():
            ctx = browser.new_context(viewport={'width': 400, 'height': 860}, is_mobile=True, has_touch=True)
            ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
            ctx.route('https://www.googleapis.com/**', fake.handle)
            ctx.route('https://sheets.googleapis.com/**', fake.handle)
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('dialog', lambda d: d.accept())
            return ctx, pg

        ctx, page = new_device()
        ev = lambda js, pg=None: (pg or page).evaluate(js)
        pill = lambda pg=None: (pg or page).inner_text('#status')

        def pick(text, path):
            with page.expect_file_chooser() as fc:
                page.get_by_text(text, exact=False).first.click()
            fc.value.set_files(path)

        def box(name, brand, front='a', rear='b'):
            page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
            pick('Box front', f'{tmp}/{front}.jpg'); page.wait_for_selector('text=Box front ✓')
            pick('Box rear', f'{tmp}/{rear}.jpg'); page.wait_for_selector('text=Box rear ✓')
            page.select_option('select', label=brand); page.wait_for_timeout(200)
            page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(200)
            page.fill('input[placeholder^="e.g. Range Rover"]', name)

        def wait_synced(pg):
            for _ in range(100):
                if pill(pg) == 'All synced': return True
                pg.wait_for_timeout(200)
            return False

        # Storage box: typed once, remembered, "Next box" moves on
        box('Mini GT Skyline', 'Mini GT')
        page.fill('input.boxin', '1'); page.wait_for_timeout(300)
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('.toast')
        check('Box 1' in page.inner_text('.toast'), f'saved toast names the box ("{page.inner_text(".toast")}")')
        page.wait_for_timeout(400)
        check(page.input_value('input.boxin') == '1', 'storage box remembered for the next box')
        page.get_by_role('button', name='Next box → 2').click(); page.wait_for_timeout(300)
        check(page.input_value('input.boxin') == '2', '"Next box → 2" moves to Box 2')
        page.screenshot(path=f'{SHOTS}/01-storage-box.png')
        box('Tarmac Porsche', 'Tarmac Works', front='c')
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('.toast'); page.wait_for_timeout(400)
        locs = ev("(async () => (await (await import('./js/store.js')).list('inventory')).map(i => i.storage_location).sort())()")
        check(locs == ['Box 1', 'Box 2'], f'copies stored as "Box 1", "Box 2" ({locs})')

        # Garage: overview, box badges, group by box, search by box
        page.goto(base + '#/'); page.wait_for_selector('.tile'); page.wait_for_timeout(300)
        ov = page.inner_text('.overview')
        check('2 boxes catalogued' in ov and '1,000' not in ov and '2 storage boxes in use' in ov, f'overview shows progress and boxes ("{ov}")')
        check(page.locator('.tile .b.box', has_text='Box 1').count() == 1, 'tile shows its storage box')
        page.get_by_role('button', name='By box').click(); page.wait_for_timeout(300)
        heads = [' · '.join(x.upper().replace('\n›', ' ›').split('\n')) for x in page.locator('h3.group').all_inner_texts()]
        check(heads == ['BOX 1 · 1 MODEL ›', 'BOX 2 · 1 MODEL ›'] or heads == ['Box 1 · 1 model', 'Box 2 · 1 model'], f'"By box" groups in box order ({heads})')
        page.screenshot(path=f'{SHOTS}/02-by-box.png')
        page.get_by_role('button', name='All', exact=True).click(); page.wait_for_timeout(200)
        page.fill('input[type=search]', 'box 2'); page.wait_for_timeout(150)
        check(page.locator('.tile').count() == 1 and page.is_visible('text=Tarmac Porsche'), 'search "box 2" finds what is in Box 2')
        page.fill('input[type=search]', '')

        # Collection size setting
        page.goto(base + '#/settings'); page.wait_for_selector('text=Your collection')
        page.locator('.card', has_text='Your collection').locator('input').fill('500')
        page.locator('.card', has_text='Your collection').get_by_role('button', name='Save').click(); page.wait_for_timeout(200)
        page.goto(base + '#/'); page.wait_for_selector('.overview')
        check(page.get_attribute('.overview .bar', 'aria-valuenow') == '0', 'collection size setting feeds the progress bar (2 of 500 rounds to 0%)')

        # Backups after the first successful sync: one daily + one monthly copy, recorded in SETTINGS
        ev(f"localStorage.setItem('smg.clientId', '{CID}')")
        page.click('#status')
        check(wait_synced(page), 'first sync completes')
        page.wait_for_timeout(1500)
        tagged = lambda kind: [f for f in fake.files.values() if f['appProperties'].get('smgBackup') == kind and not f['trashed']]
        check(len(tagged('daily')) == 1 and len(tagged('monthly')) == 1, f"daily + monthly backup made (daily {len(tagged('daily'))}, monthly {len(tagged('monthly'))})")
        root = next(k for k, f in fake.files.items() if f.get('appProperties', {}).get('smgRole') == 'folder:06_BACKUPS/DAILY')
        check(all(root in f['parents'] for f in tagged('daily')), 'daily copy is in 06_BACKUPS/DAILY')
        sid = next(iter(fake.sheets)); settings = fake.sheets[sid]['SETTINGS']
        lb = next((r for r in settings if r and r[0] == 'last_backup_at'), ['', ''])
        check(bool(lb[1]), f'SETTINGS last_backup_at filled ({lb[1][:19]})')
        page.click('#status'); page.wait_for_timeout(2000)
        check(len(tagged('daily')) == 1, 'second sync the same day makes no new daily copy')

        # Keep 7 daily copies: pretend the last daily copy is 2 days old, eight more times
        for _ in range(7):
            ev("(async () => { const i = await import('./js/idb.js'); const lb = await i.meta.get('lastBackup', {}); lb.dailyAt = new Date(Date.now() - 2 * 864e5).toISOString(); await i.meta.set('lastBackup', lb); })()")
            page.click('#status'); page.wait_for_timeout(1500)
        check(len(tagged('daily')) == 7, f"only 7 daily copies kept, older ones trashed (kept {len(tagged('daily'))})")

        # Back up now
        page.goto(base + '#/settings'); page.wait_for_selector('text=Backups')
        page.get_by_role('button', name='Back up now').click(); page.wait_for_selector('text=Backup made'); page.wait_for_timeout(300)
        check(len(tagged('manual')) == 1, 'Back up now makes a manual copy')
        page.screenshot(path=f'{SHOTS}/03-backups.png', full_page=True)

        # Photos on another device (G3): a fresh "laptop" sees real thumbnails after one sync
        ctx2, lap = new_device()
        lap.goto(base + '#/'); lap.wait_for_selector('text=My Garage')
        lap.evaluate(f"localStorage.setItem('smg.clientId', '{CID}')")
        lap.click('#status')
        check(wait_synced(lap), 'laptop: sync completes')
        lap.goto(base + '#/'); lap.wait_for_selector('.tile'); lap.wait_for_timeout(800)
        imgs = lap.locator('.tile .ph img').count()
        check(imgs == 2, f'laptop: both tiles show real photos ({imgs} of 2)')
        main = [k for k in fake.sheets if not fake.files[k]['appProperties'].get('smgBackup')]
        lap_wb = lap.evaluate("(async () => (await (await import('./js/idb.js')).meta.get('config')).workbookId)()")
        backups = [k for k in fake.sheets if fake.files[k]['appProperties'].get('smgBackup')]
        check(len(main) == 1 and lap_wb == main[0], f'laptop uses the main sheet, never a backup ({len(backups)} backups exist)')
        check(all(not fake.files[k]['appProperties'].get('smgRole') for k in backups), 'backup copies carry no main-sheet tag')
        lap.screenshot(path=f'{SHOTS}/04-laptop.png')

        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:3]})')
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
