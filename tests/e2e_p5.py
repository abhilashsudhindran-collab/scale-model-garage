"""Developer test for releases s1-0.7.0/0.8.0 (Dashboard, Name tab, box names, grouped views, tab migration). NOT a phone test.
Seeds boxes straight into the phone database, then checks the dashboard's numbers and taps.

Run:  python3 tests/e2e_p5.py
"""
import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

SHOTS = '/tmp/smg-p5'
SEED = """(async () => {
  const store = await import('./js/store.js');
  const brands = await store.list('brands'), scales = await store.list('scales');
  const B = (n) => brands.find(b => b.name === n).brand_id, S = (l) => scales.find(s => s.label === l).scale_id;
  const plan = [
    ['Mini GT', '1:64', 'Box 3', 'Nissan Skyline', 'opened'], ['Mini GT', '1:64', 'Box 3', 'Honda NSX', 'opened'],
    ['Mini GT', '1:64', 'Box 3', '', 'sealed'], ['Bburago', '1:43', 'Box 12', 'Toyota GR010', 'opened'],
    ['Bburago', '1:43', 'Box 12', 'Ferrari 499P', ''], ['Hot Wheels', '1:64', '', 'Civic', ''],
    ['Bburago', '1:18', 'Box 30', '', ''],
  ];
  for (const [b, s, box, name, state] of plan) {
    const md = await store.create('models', { brand_id: B(b), scale_id: S(s), display_name: name, namespace_status: 'confirmed' });
    await store.create('inventory', { model_id: md.model_id, ownership_status: 'Owned', storage_location: box, packaging_state: state });
  }
  const gone = await store.create('models', { brand_id: B('Mini GT'), scale_id: S('1:64'), display_name: 'Archived one' });
  await store.create('inventory', { model_id: gone.model_id, ownership_status: 'Owned', storage_location: 'Box 3' });
  await store.archive('models', gone.model_id);
})()"""


def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)

    httpd = m.serve(); fake = m.FakeGoogle(); os.makedirs(SHOTS, exist_ok=True)
    base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 400, 'height': 860}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle)
        ctx.route('https://sheets.googleapis.com/**', fake.handle)
        txt = lambda sel: page.inner_text(sel)

        page.goto(base + '#/dash'); page.wait_for_selector('text=Nothing catalogued yet')
        check(page.is_visible('text=Start a photo run'), 'empty dashboard points to a photo run')
        check(len(page.query_selector_all('nav.bottom a')) == 5, 'bottom menu has 5 tabs')

        page.evaluate(SEED)
        page.goto(base + '#/'); page.wait_for_selector('.tile')
        page.goto(base + '#/dash'); page.wait_for_selector('.card.hero')
        check(txt('.card.hero .big') == '7', f"headline counts 7 boxes, archived one excluded ({txt('.card.hero .big')})")
        hero = txt('.card.hero')
        check('boxes catalogued' in hero and '1,000' not in hero and 'rough progress' in hero and '7 different models' in hero and '3 storage boxes in use' in hero, 'headline: progress, models, storage boxes')
        stats = [s.inner_text().replace('\n', ' ') for s in page.query_selector_all('.stat')]
        check(any(s.startswith('✓ 5 named') for s in stats) and any('2 need a name' in s for s in stats), f'status tiles ({stats})')
        check(any('7 waiting to sync' in s for s in stats), 'waiting-to-sync tile counts unsynced boxes')
        badge = page.query_selector('#navname .badge')
        check(badge.is_visible() and badge.inner_text() == '2', 'Name tab badge shows 2')

        bars = [r.inner_text().replace('\n', ' ') for r in page.query_selector_all('.card:has(h3:text("By brand")) .barrow')]
        check(bars == ['Bburago 3', 'Mini GT 3', 'Hot Wheels 1'], f'by brand, largest first ({bars})')
        sc = [r.inner_text().replace('\n', ' ') for r in page.query_selector_all('.card:has(h3:text("By scale")) .barrow')]
        check(sc[0] == '1:64 4' and len(sc) == 3, f'by scale ({sc})')
        tiles = [t.inner_text().replace('\n', ' ') for t in page.query_selector_all('.boxtile')]
        check(tiles == ['3 Box 3', '2 Box 12', '1 Box 30'], f'storage boxes in number order, count inside ({tiles})')
        check(page.is_visible('text=1 box has no storage box yet'), 'boxes without a storage box are counted')
        check(not page.is_visible('text=Last 7 days'), 'no "last 7 days" chart (B: not useful)')
        st = [r.inner_text().replace('\n', ' ') for r in page.query_selector_all('.card:has(h3:text("Box state")) .barrow')]
        check(st == ['Opened 3', 'Sealed 1'], f'box state ({st})')
        page.screenshot(path=f'{SHOTS}/01-dash-top.png')
        page.evaluate('window.scrollTo(0, 700)'); page.wait_for_timeout(200); page.screenshot(path=f'{SHOTS}/02-dash-more.png')

        # Taps lead to the matching lists
        page.evaluate('window.scrollTo(0, 0)')
        page.locator('.boxtile', has_text='Box 12').click(); page.wait_for_selector('.tile')
        names = [t.inner_text() for t in page.query_selector_all('.tile')]
        check(len(names) == 2 and all('Box 12' in n for n in names), f'tapping Box 12 shows only what is in Box 12 ({len(names)} tiles)')
        card = txt('.boxcard')
        check('📦 Box 12' in card and '2 cars inside · Bburago 2' in card, f'box card: label, count, brands ({card[:60]!r})')
        page.fill('input[aria-label="Box name"]', 'Le Mans racers'); page.get_by_role('button', name='Save name').click(); page.wait_for_timeout(600)
        check('Le Mans racers' in page.input_value('input[aria-label="Box name"]'), 'box name saved and shown')
        page.locator('.boxcard .chip', has_text='L').first.click(); page.wait_for_timeout(500)
        check('📦 Box 12 · L' in txt('.boxcard') and page.locator('.boxcard .chip.on').inner_text() == 'L', 'box size L set')
        page.locator('.boxcard .chip', has_text='XL').click(); page.wait_for_timeout(500)
        check(page.locator('.boxcard .chip.on').inner_text() == 'XL', 'box size changed to XL')
        page.locator('.boxcard .chip', has_text='XL').click(); page.wait_for_timeout(500)
        check(page.query_selector('.boxcard .chip.on') is None, 'tapping the chosen size again clears it')
        page.locator('.boxcard .chip', has_text='L').first.click(); page.wait_for_timeout(500)
        page.screenshot(path=f'{SHOTS}/03-box12.png')
        page.goto(base + '#/dash'); page.wait_for_selector('.boxtile')
        t12 = page.locator('.boxtile', has_text='Box 12').inner_text().replace('\n', ' ')
        check(t12.replace(' ', '') == '2LBox12LeMansracers', f'dashboard tile: count inside, size, number, name ({t12!r})')
        page.locator('.card:has(.shelf)').screenshot(path=f'{SHOTS}/05-shelf.png')
        page.goto(base + '#/dash'); page.wait_for_selector('.boxtile')
        page.locator('.boxtile').first.click(); page.wait_for_selector('.tile')
        t3 = [t.inner_text() for t in page.query_selector_all('.tile')]
        check(len(t3) == 3 and not any('Box 30' in n for n in t3), f'tapping Box 3 does not include Box 30 ({len(t3)} tiles)')
        page.goto(base + '#/dash'); page.wait_for_selector('.barrow')
        page.locator('.barrow', has_text='Hot Wheels').click(); page.wait_for_selector('.tile')
        check(len(page.query_selector_all('.tile')) == 1, 'tapping a brand shows that brand')
        page.goto(base + '#/dash'); page.wait_for_selector('.stat')
        page.locator('.stat', has_text='need a name').click(); page.wait_for_selector('text=Name them')
        check(page.query_selector('#navname').get_attribute('class') == 'on', 'need-a-name tile opens Name them; Name tab highlighted')

        # Badge updates after naming
        page.fill('input[aria-label=Name]', 'Mini GT sealed one'); page.get_by_role('button', name='Save & next').click(); page.wait_for_timeout(700)
        check(page.query_selector('#navname .badge').inner_text() == '1', 'badge drops to 1 after naming a box')

        # The shelf on the home screen: tap a box to see inside, tap again for everything
        page.goto(base + '#/'); page.wait_for_selector('.shelfhome'); page.fill('input[type=search]', ''); page.wait_for_timeout(200)
        page.goto(base + '#/dash'); page.goto(base + '#/'); page.wait_for_selector('.shelfhome .boxtile')
        home = [t.inner_text().replace('\n', ' ').replace(' ', '') for t in page.query_selector_all('.shelfhome .boxtile')]
        check(len(home) == 3 and home[1].startswith('2LBox12'), f'home screen shows the shelf ({home})')
        allt = len(page.query_selector_all('.tile'))
        page.locator('.shelfhome .boxtile', has_text='Box 30').click(); page.wait_for_selector('.boxcard')
        check(len(page.query_selector_all('.tile')) == 1 and page.locator('.shelfhome .boxtile.sel').count() == 1, 'tap a box on the home shelf: only its cars, box highlighted')
        page.screenshot(path=f'{SHOTS}/06-home-shelf.png')
        page.locator('.shelfhome .boxtile', has_text='Box 30').click(); page.wait_for_timeout(300)
        check(len(page.query_selector_all('.tile')) == allt and page.query_selector('.boxcard') is None, 'tap it again: everything shown')
        # Photo run: jump to any box in use with one tap (no "box full" needed)
        page.goto(base + '#/run'); page.wait_for_selector('text=Photo run')
        if page.is_visible('text=Change'): page.get_by_role('button', name='Change').click(); page.wait_for_timeout(200)
        chips = [c.inner_text() for c in page.query_selector_all('.chips.scroll .chip')]
        check('3' in ' '.join(chips) and any('Le Mans racers' in c for c in chips), f'box chips list boxes in use, with names ({chips})')
        page.locator('.chips.scroll .chip', has_text='Le Mans racers').click(); page.wait_for_timeout(300)
        check(page.input_value('input.boxin') == '12', 'tapping a box chip sets the storage box')
        page.screenshot(path=f'{SHOTS}/07-run-chips.png')

        # Grouped views in the Garage
        page.goto(base + '#/'); page.wait_for_selector('.tile'); page.fill('input[type=search]', ''); page.wait_for_timeout(200)
        page.get_by_role('button', name='By brand', exact=True).click(); page.wait_for_timeout(300)
        groups = [g.inner_text() for g in page.query_selector_all('h3.group')]
        check(groups == ['BBURAGO · 3 MODELS', 'HOT WHEELS · 1 MODEL', 'MINI GT · 3 MODELS'], f'By brand groups A–Z ({groups})')
        page.get_by_role('button', name='By scale', exact=True).click(); page.wait_for_timeout(300)
        groups = [g.inner_text() for g in page.query_selector_all('h3.group')]
        check([g.split(' ·')[0] for g in groups] == ['1:64', '1:43', '1:18'], f'By scale groups in scale order ({groups})')
        page.get_by_role('button', name='By box', exact=True).click(); page.wait_for_timeout(300)
        groups = [g.inner_text() for g in page.query_selector_all('h3.group')]
        check(groups[1].startswith('BOX 12 · L · LE MANS RACERS · 2 MODELS') and groups[-1].startswith('NO BOX YET'), f'By box headers carry box names ({groups})')
        page.screenshot(path=f'{SHOTS}/04-bybox.png')
        page.locator('h3.group a', has_text='BOX 30').click(); page.wait_for_selector('.boxcard')
        check('Box 30' in txt('.boxcard') and len(page.query_selector_all('.tile')) == 1, 'tapping a box header opens that box')

        # Box names reach the sheet; an older sheet without STORAGE_BOXES gets the tab added (never deleted)
        page.evaluate("localStorage.setItem('smg.clientId', 'test-client.apps.googleusercontent.com')")
        page.goto(base + '#/'); page.wait_for_selector('.tile')
        def sync_all():
            page.click('#status')
            for _ in range(150):
                if page.inner_text('#status') == 'All synced': return True
                page.wait_for_timeout(200)
            return False
        check(sync_all(), 'first sync completes')
        sid = next(iter(fake.sheets)); book = fake.sheets[sid]
        sb = book.get('STORAGE_BOXES', [])
        check(len(sb) == 2 and 'Le Mans racers' in sb[1] and sb[1][sb[0].index('box_size')] == 'L', 'box name and size synced to STORAGE_BOXES')
        del book['STORAGE_BOXES']
        page.evaluate("(async () => { const i = await import('./js/idb.js'); const c = await i.meta.get('config'); c.tabsVersion = 1; await i.meta.set('config', c); })()")
        page.goto(base + '#/'); page.wait_for_selector('.tile')
        page.fill('input[type=search]', 'box 3'); page.wait_for_selector('.boxcard')
        page.fill('input[aria-label="Box name"]', 'Mini GT JDM'); page.get_by_role('button', name='Save name').click(); page.wait_for_timeout(500)
        check(sync_all(), 'sync after app update completes')
        for _ in range(50):
            left = page.evaluate("(async () => (await (await import('./js/idb.js')).records.dirty()).filter(r => !r.seed).length)()")
            if not left: break
            page.wait_for_timeout(200)
        rows = book.get('STORAGE_BOXES', [])
        check(len(rows) >= 2 and rows[0][:3] == ['storage_box_id', 'created_at', 'updated_at'] and any('Mini GT JDM' in r for r in rows), f'older sheet: STORAGE_BOXES tab added with headers, new name synced ({len(rows)} rows)')
        check('MODELS' in book and len(book['MODELS']) > 1, 'existing tabs untouched')

        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:3]})')
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
