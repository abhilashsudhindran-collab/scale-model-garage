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
        tiles = [t.inner_text().replace('\n', ' ') for t in page.query_selector_all('.boxtile:not(.newbox)')]
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
        page.locator('.boxcard').get_by_role('button', name='L', exact=True).click(); page.wait_for_timeout(500)
        check('📦 Box 12 · L' in txt('.boxcard') and page.locator('.boxcard').get_by_role('button', name='L', exact=True).get_attribute('aria-pressed') == 'true', 'box size L set')
        page.locator('.boxcard').get_by_role('button', name='XL', exact=True).click(); page.wait_for_timeout(500)
        check(page.locator('.boxcard').get_by_role('button', name='XL', exact=True).get_attribute('aria-pressed') == 'true', 'box size changed to XL')
        page.locator('.boxcard').get_by_role('button', name='XL', exact=True).click(); page.wait_for_timeout(500)
        check(all(page.locator('.boxcard').get_by_role('button', name=z, exact=True).get_attribute('aria-pressed') == 'false' for z in ['S', 'M', 'L', 'XL']), 'tapping the chosen size again clears it')
        page.locator('.boxcard').get_by_role('button', name='L', exact=True).click(); page.wait_for_timeout(500)
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
        check(len(home) == 4 and home[1].startswith('2LBox12') and home[-1] == '＋Newbox', f'home screen shows the shelf + New box ({home})')
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

        # Box-first flow: New box -> Fill it -> shoot -> Done -> the box shows the car
        tmp = '/tmp/smg-p5-img'; os.makedirs(tmp, exist_ok=True)
        open(f'{tmp}/f.jpg', 'wb').write(m.make_jpeg((150, 90, 40), 3)); open(f'{tmp}/r.jpg', 'wb').write(m.make_jpeg((40, 90, 150), 5))
        page.goto(base + '#/'); page.wait_for_selector('.shelfhome'); page.fill('input[type=search]', ''); page.wait_for_timeout(200)
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        card = txt('.boxcard')
        check('📦 Box 31' in card and 'Empty so far' in card, f'New box = next number (Box 31), opened empty ({card[:40]!r})')
        check(page.is_visible('text=No cars in this box yet'), 'empty box says so')
        page.get_by_role('button', name='📷 Fill Box 31').click(); page.wait_for_selector('text=Photo run')
        check(page.is_visible('text=📦 Filling Box 31'), 'Photo run opens with "Filling Box 31"')
        if page.is_visible('select[aria-label=Brand]'):
            page.select_option('select[aria-label=Brand]', label='Hot Wheels'); page.wait_for_timeout(250)
            page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(250)
            page.get_by_role('button', name='Car visible', exact=True).click(); page.wait_for_timeout(200)
            page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(300)
        page.screenshot(path=f'{SHOTS}/08-filling.png')
        for label, f in [('Box front', 'f'), ('Box rear', 'r')]:
            with page.expect_file_chooser() as fc: page.get_by_role('button', name=f'📷 {label}').click()
            fc.value.set_files(f'{tmp}/{f}.jpg'); page.wait_for_timeout(700)
        page.wait_for_selector('text=Car 2 of this run', timeout=8000)
        page.get_by_role('button', name='Done with Box 31').click(); page.wait_for_selector('.boxcard')
        c31 = txt('.boxcard'); n31 = len(page.query_selector_all('.tile'))
        check('1 car inside · Hot Wheels 1' in c31 and n31 == 1, f'Done: Box 31 shows its new car ({c31[:60]!r}, {n31} tiles)')
        page.screenshot(path=f'{SHOTS}/09-box31.png')

        # Brand boxes vs mixed boxes: the box decides the brand
        page.goto(base + '#/'); page.wait_for_selector('.shelfhome'); page.fill('input[type=search]', ''); page.wait_for_timeout(200)
        page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        check('📦 Box 32' in txt('.boxcard'), 'second new box = Box 32')
        page.select_option('select[aria-label="Brand for this box"]', label='Mini GT'); page.wait_for_timeout(500)
        check(page.locator('.boxcard .chip.on', has_text='Only Mini GT').count() == 1, 'Box 32 set to "Only Mini GT"')
        page.get_by_role('button', name='📷 Fill Box 32').click(); page.wait_for_selector('text=📦 Filling Box 32')
        check('Mini GT' in txt('.runsum') and not page.is_visible('text=Which brand is this car?'), 'brand box: run preset to Mini GT, no brand question')
        nmod = lambda: page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).length)()")
        before = nmod()
        for label, f in [('Box front', 'f'), ('Box rear', 'r')]:
            with page.expect_file_chooser() as fc: page.get_by_role('button', name=f'📷 {label}').click()
            fc.value.set_files(f'{tmp}/{f}.jpg'); page.wait_for_timeout(700)
        if page.is_visible('text=Different model: save new'): page.get_by_role('button', name='Different model: save new').click(); page.wait_for_timeout(700)
        for _ in range(40):
            if nmod() > before: break
            page.wait_for_timeout(200)
        page.get_by_role('button', name='Done with Box 32').click(); page.wait_for_selector('.boxcard')
        check('1 car inside · Mini GT 1' in txt('.boxcard'), 'brand box: car saved as Mini GT')
        page.locator('.boxcard .chip', has_text='Mixed brands').click(); page.wait_for_timeout(500)
        page.get_by_role('button', name='📷 Fill Box 32').click(); page.wait_for_selector('text=📦 Filling Box 32')
        check('Mixed brands' in txt('.runsum'), 'mixed box: run shows "Mixed brands"')
        brands_seen = []
        for want in ['Bburago', 'Hot Wheels']:
            for label, f in [('Box front', 'f'), ('Box rear', 'r')]:
                with page.expect_file_chooser() as fc: page.get_by_role('button', name=f'📷 {label}').click()
                fc.value.set_files(f'{tmp}/{f}.jpg'); page.wait_for_timeout(700)
            page.wait_for_selector('text=Which brand is this car?', timeout=8000)
            brands_seen.append(page.is_visible(".brandpick"))
            if want == 'Bburago': page.screenshot(path=f'{SHOTS}/10-which-brand.png')
            page.select_option('select[aria-label="Brand for this car"]', label=want); page.wait_for_timeout(900)
            # a barcode/photo match may ask "same model?": treat as a different car
            if page.is_visible('text=Different model: save new'): page.get_by_role('button', name='Different model: save new').click(); page.wait_for_timeout(700)
        check(all(brands_seen), 'mixed box: after photos, asks the brand with the photo in view (each car)')
        page.get_by_role('button', name='Done with Box 32').click(); page.wait_for_selector('.boxcard')
        c32 = txt('.boxcard')
        check('3 cars inside' in c32 and 'Bburago 1' in c32 and 'Hot Wheels 1' in c32 and 'Mini GT 1' in c32, f'mixed box: each car saved with its own brand ({c32[:70]!r})')
        page.goto(base + '#/'); page.wait_for_selector('.shelfhome .boxtile')
        check('Mixed' in page.locator('.shelfhome .boxtile', has_text='Box 32').inner_text(), 'unnamed mixed box tile says "Mixed"')

        # Brand and scale per box: "Mixed brands, only 1:43" and "only Bburago, mixed scales"
        def shoot_car():
            for label, f in [('Box front', 'f'), ('Box rear', 'r')]:
                with page.expect_file_chooser() as fc: page.get_by_role('button', name=f'📷 {label}').click()
                fc.value.set_files(f'{tmp}/{f}.jpg'); page.wait_for_timeout(700)
        def after_save():
            if page.is_visible('text=Different model: save new'): page.get_by_role('button', name='Different model: save new').click(); page.wait_for_timeout(700)
        def new_box(n):
            page.goto(base + '#/'); page.wait_for_selector('.shelfhome'); page.fill('input[type=search]', ''); page.wait_for_timeout(200)
            page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
            check(f'📦 Box {n}' in txt('.boxcard'), f'new Box {n}')
        new_box(33)
        page.locator('.boxcard .chip', has_text='Mixed brands').click(); page.wait_for_timeout(400)
        page.locator('.boxcard .chip', has_text='Only 1:43').click(); page.wait_for_timeout(400)
        page.get_by_role('button', name='📷 Fill Box 33').click(); page.wait_for_selector('text=📦 Filling Box 33')
        check('Mixed brands · 1:43' in txt('.runsum'), f"run: Mixed brands · 1:43 ({txt('.runsum')[:40]!r})")
        shoot_car(); page.wait_for_selector('text=Which brand is this car?', timeout=8000)
        check(not page.is_visible('text=Which scale?'), 'only the brand is asked (scale fixed by the box)')
        page.screenshot(path=f'{SHOTS}/11-mixed-143.png')
        page.select_option('select[aria-label="Brand for this car"]', label='Mini GT'); page.wait_for_timeout(900); after_save()
        page.get_by_role('button', name='Done with Box 33').click(); page.wait_for_selector('.boxcard')
        new_box(34)
        page.select_option('select[aria-label="Brand for this box"]', label='Bburago'); page.wait_for_timeout(400)
        page.locator('.boxcard .chip', has_text='Mixed scales').click(); page.wait_for_timeout(400)
        page.get_by_role('button', name='📷 Fill Box 34').click(); page.wait_for_selector('text=📦 Filling Box 34')
        shoot_car(); page.wait_for_selector('text=Which scale?', timeout=8000)
        check(not page.is_visible('text=Which brand is this car?'), 'only the scale is asked (brand fixed by the box)')
        page.locator('.brandpick .chip', has_text='1:18').click(); page.wait_for_timeout(900); after_save()
        page.get_by_role('button', name='Done with Box 34').click(); page.wait_for_selector('.boxcard')
        got = page.evaluate("""(async () => { const st = await import('./js/store.js'); const inv = await st.list('inventory'); const ms = await st.list('models'); const sc = await st.list('scales'); const br = await st.list('brands');
          const one = (b) => { const i = inv.find(x => x.storage_location === b); const m = ms.find(x => x.model_id === i.model_id); return br.find(x => x.brand_id === m.brand_id).name + ' ' + sc.find(x => x.scale_id === m.scale_id).label; };
          return [one('Box 33'), one('Box 34')]; })()""")
        check(got == ['Mini GT 1:43', 'Bburago 1:18'], f'cars saved with box scale/brand + the one picked ({got})')
        page.goto(base + '#/'); page.wait_for_selector('.shelfhome .boxtile')
        t33 = page.locator('.shelfhome .boxtile', has_text='Box 33').inner_text(); t34 = page.locator('.shelfhome .boxtile', has_text='Box 34').inner_text()
        check('Mixed · 1:43' in t33 and 'Bburago' in t34, f'tiles describe the box ({t33!r}, {t34!r})')

        # Removing boxes: empty = straight away; with cars = asks, cars move to "No box yet"; Restore puts them back
        dialogs = []
        def on_dialog(d): dialogs.append(d.message); d.accept()
        page.on('dialog', on_dialog)
        new_box(35)
        page.get_by_role('button', name='Remove Box 35').click(); page.wait_for_timeout(600)
        check(not dialogs and page.locator('.shelfhome .boxtile', has_text='Box 35').count() == 0, 'empty box removed without a question')
        page.locator('.shelfhome .boxtile', has_text='Box 31').click(); page.wait_for_selector('.boxcard')
        page.get_by_role('button', name='Remove Box 31').click(); page.wait_for_timeout(800)
        check(len(dialogs) == 1 and '1 car' in dialogs[0] and 'stay in your collection' in dialogs[0], f'box with a car: asks first ({dialogs[-1][:50] if dialogs else None!r})')
        check(page.locator('.shelfhome .boxtile', has_text='Box 31').count() == 0, 'Box 31 gone from the shelf')
        page.get_by_role('button', name='By box', exact=True).click(); page.wait_for_timeout(300)
        nobox = [g.inner_text() for g in page.query_selector_all('h3.group') if g.inner_text().startswith('NO BOX YET')]
        check(nobox and '2 MODELS' in nobox[0], f'its car is kept, now under "No box yet" ({nobox})')
        page.get_by_role('button', name='All', exact=True).click()
        page.goto(base + '#/dash'); page.wait_for_selector('text=Removed boxes')
        page.wait_for_selector('.card h3:text("Removed boxes")')
        rem = txt('.card:has(h3:text("Removed boxes"))')
        check('Box 31' in rem and '1 car was inside' in rem and 'Box 35' in rem, f'Dashboard lists removed boxes ({rem[:80]!r})')
        page.screenshot(path=f'{SHOTS}/12-removed.png', full_page=True)
        page.locator('.row.removed', has_text='Box 31').get_by_role('button', name='Restore').click(); page.wait_for_timeout(800)
        page.goto(base + '#/'); page.wait_for_selector('.shelfhome .boxtile:has-text("Box 31")')
        page.locator('.shelfhome .boxtile', has_text='Box 31').click(); page.wait_for_selector('.boxcard')
        check('1 car inside · Hot Wheels 1' in txt('.boxcard'), 'Restore: Box 31 is back with its car')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(c => /box (removed|restored)|removed in app|restored in app/.test(c.reason)).length)()")
        check(log >= 4, f'every step is in the change log ({log} entries)')
        page.remove_listener('dialog', on_dialog)

        # Grouped views in the Garage
        page.goto(base + '#/'); page.wait_for_selector('.tile'); page.fill('input[type=search]', ''); page.wait_for_timeout(200)
        page.get_by_role('button', name='By brand', exact=True).click(); page.wait_for_timeout(300)
        groups = [g.inner_text() for g in page.query_selector_all('h3.group')]
        check(groups == ['BBURAGO · 5 MODELS', 'HOT WHEELS · 3 MODELS', 'MINI GT · 5 MODELS'], f'By brand groups A–Z ({groups})')
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
        lm = [r for r in sb[1:] if 'Le Mans racers' in r]
        check(len(lm) == 1 and lm[0][sb[0].index('box_size')] == 'L' and any('Box 31' in r for r in sb[1:]), f'box names, sizes and new boxes synced to STORAGE_BOXES ({len(sb) - 1} rows)')
        for _ in range(100):  # let any sync/backup still running finish, so it can't write the old setup back
            if not page.evaluate("(async () => (await import('./js/sync.js')).isSyncing())()"): break
            page.wait_for_timeout(200)
        page.wait_for_timeout(1500)
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
