"""Design review screenshots (not a test): six cars catalogued through the real Photo run, then key screens in each
accent, mobile and desktop. Uses the fake Google from e2e_mock.py. Output: /tmp/des/out/*.png

Run:  python3 tests/shots_design.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

IMG = '/tmp/des/img'; OUT = '/tmp/des/out'
CARS = [('Toyota GR010 Hybrid 2024', 'Bburago', '1:43', '1'), ('Nissan Skyline GT-R R34', 'Mini GT', '1:64', '2'),
        ('Porsche 911 GT3 RS', 'Mini GT', '1:64', '2'), ('Ferrari 499P', 'Bburago', '1:43', '1'),
        ('Honda Civic EF', 'Hot Wheels', '1:64', '3'), ('Toyota Supra A80', 'Mini GT', '1:64', '2')]


def main():
    os.makedirs(OUT, exist_ok=True)
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); page.on('dialog', lambda d: d.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        # Boxes 1-3 with settings, then fill each through the real Photo run
        for n, (bname, sc, size, name) in {'1': ('Bburago', '1:43', 'L', 'Le Mans racers'), '2': ('Mini GT', '1:64', 'M', 'JDM'), '3': ('mixed', '1:64', 'S', '')}.items():
            page.goto(base + '#/'); page.fill('input[type=search]', ''); page.wait_for_timeout(200)
            page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
            if bname == 'mixed': page.locator('.boxcard .chip', has_text='Mixed brands').click()
            else: page.select_option('select[aria-label="Brand for this box"]', label=bname)
            page.wait_for_timeout(300)
            page.locator('.boxcard .chip', has_text=f'Only {sc}').click(); page.wait_for_timeout(300)
            page.locator('.boxcard').get_by_role('button', name=size, exact=True).click(); page.wait_for_timeout(300)
            if name: page.fill('input[aria-label="Box name"]', name); page.get_by_role('button', name='Save name').click(); page.wait_for_timeout(300)
        for i, (nm, brand, sc, box) in enumerate(CARS):
            page.goto(base + '#/'); page.fill('input[type=search]', f'box {box}'); page.wait_for_selector('.boxcard')
            page.get_by_role('button', name=f'Fill Box {box}').click(); page.wait_for_selector('text=Photo run')
            if page.is_visible('text=Done: start shooting'):
                page.get_by_role('button', name='Car visible', exact=True).click(); page.wait_for_timeout(200)
                page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(200)
            for role, s in [('Box front', 'f'), ('Barcode side', 'r')]:
                with page.expect_file_chooser() as fc: page.get_by_role('button', name=f'{role}').click()
                fc.value.set_files(f'{IMG}/c{i}{s}.jpg'); page.wait_for_timeout(900)
            if page.is_visible('text=Which brand is this car?'):
                page.select_option('select[aria-label="Brand for this car"]', label=brand); page.wait_for_timeout(900)
            if page.is_visible('text=Different model: save new'): page.get_by_role('button', name='Different model: save new').click(); page.wait_for_timeout(700)
            for _ in range(50):
                if page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).length)()") > i: break
                page.wait_for_timeout(200)
        # Names for five of the six (one stays nameless, as after a real run)
        page.evaluate("""(async (cars) => { const st = await import('./js/store.js'); const ms = (await st.list('models')).sort((a, b) => a.created_at.localeCompare(b.created_at));
          for (let i = 0; i < ms.length && i < 5; i++) await st.update('models', ms[i].model_id, { display_name: cars[i] }); })""", [c[0] for c in CARS])
        first = page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).sort((a, b) => a.created_at.localeCompare(b.created_at))[1].model_id)()")

        def shots(acc, prefix='m'):
            page.evaluate(f"localStorage.setItem('smg.accent', '{acc}')")
            page.goto(base + '#/'); page.reload(); page.wait_for_selector('.tile'); page.fill('input[type=search]', ''); page.wait_for_timeout(900)
            page.screenshot(path=f'{OUT}/{prefix}-{acc}-1home.png')
            page.locator('.shelfhome .boxtile', has_text='Box 2').click(); page.wait_for_selector('.boxcard'); page.wait_for_timeout(700)
            page.screenshot(path=f'{OUT}/{prefix}-{acc}-2box.png')
            page.goto(base + '#/dash'); page.wait_for_selector('.card.hero'); page.wait_for_timeout(500)
            page.screenshot(path=f'{OUT}/{prefix}-{acc}-3dash.png')
            page.goto(base + f'#/item/{first}'); page.wait_for_timeout(1200)
            page.screenshot(path=f'{OUT}/{prefix}-{acc}-4item.png'); page.screenshot(path=f'{OUT}/{prefix}-{acc}-4itemfull.png', full_page=True)
            page.goto(base + '#/settings'); page.wait_for_selector('text=Look'); page.locator('.card', has_text='Accent colour').scroll_into_view_if_needed(); page.wait_for_timeout(300)
            page.screenshot(path=f'{OUT}/{prefix}-{acc}-5settings.png')
            page.goto(base + '#/'); page.fill('input[type=search]', 'box 3'); page.wait_for_selector('.boxcard')
            page.get_by_role('button', name='Fill Box 3').click(); page.wait_for_selector('text=Photo run'); page.wait_for_timeout(500)
            page.screenshot(path=f'{OUT}/{prefix}-{acc}-6run.png')
        for acc in ['forest', 'cobalt', 'burnt']: shots(acc)
        # Desktop (same page, wider window)
        page.set_viewport_size({'width': 1280, 'height': 860}); page.evaluate("localStorage.setItem('smg.accent', 'forest')")
        page.goto(base + '#/'); page.reload(); page.wait_for_selector('.tile'); page.fill('input[type=search]', ''); page.wait_for_timeout(900)
        page.screenshot(path=f'{OUT}/d-forest-1home.png')
        page.goto(base + '#/dash'); page.wait_for_selector('.card.hero'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/d-forest-3dash.png')
        b.close()
    httpd.shutdown(); print('done')


if __name__ == '__main__':
    main()
