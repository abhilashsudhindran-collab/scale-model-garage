"""Developer test for release s1-0.7.0 (Dashboard tab, Name tab with badge). NOT a phone test.
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
        check(tiles == ['3 3 models', '12 2 models', '30 1 model'], f'storage boxes in number order ({tiles})')
        check(page.is_visible('text=1 box has no storage box yet'), 'boxes without a storage box are counted')
        week = page.query_selector_all('.col .cn')
        check(week[-1].inner_text() == '7' and 'boxes this week' in txt('.card:has(h3:text("Last 7 days"))'), 'last 7 days: today shows 7')
        st = [r.inner_text().replace('\n', ' ') for r in page.query_selector_all('.card:has(h3:text("Box state")) .barrow')]
        check(st == ['Opened 3', 'Sealed 1'], f'box state ({st})')
        page.screenshot(path=f'{SHOTS}/01-dash-top.png')
        page.evaluate('window.scrollTo(0, 700)'); page.wait_for_timeout(200); page.screenshot(path=f'{SHOTS}/02-dash-more.png')

        # Taps lead to the matching lists
        page.evaluate('window.scrollTo(0, 0)')
        page.locator('.boxtile', has_text='12').click(); page.wait_for_selector('.tile')
        names = [t.inner_text() for t in page.query_selector_all('.tile')]
        check(len(names) == 2 and all('Box 12' in n for n in names), f'tapping Box 12 shows only what is in Box 12 ({len(names)} tiles)')
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

        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:3]})')
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
