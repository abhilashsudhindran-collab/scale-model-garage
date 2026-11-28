"""Developer test for release s1-0.3.0 (audit P1 speed and retrieval fixes). NOT a phone acceptance test.
Headless Chrome at phone size against the FAKE Google from e2e_mock.py. Needs: pip install python-barcode.

Run:  python3 tests/e2e_p1.py
"""
import io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from PIL import Image
from playwright.sync_api import sync_playwright

SHOTS = '/tmp/smg-p1'
EAN = '4006381333931'  # a valid EAN-13 (check digit correct)


def box_rear_with_barcode(path):
    """A 1200x1600 'box rear' photo with a printed EAN-13 in the lower half."""
    import barcode
    from barcode.writer import ImageWriter
    buf = io.BytesIO()
    barcode.get('ean13', EAN[:12], writer=ImageWriter()).write(buf, {'module_width': 0.5, 'module_height': 22, 'quiet_zone': 8, 'font_size': 10})
    bc = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    img = Image.new('RGB', (1200, 1600), (235, 230, 220))
    bc = bc.resize((int(bc.width * 700 / bc.width), int(bc.height * 700 / bc.width)))
    img.paste(bc, (250, 1000))
    img.save(path, 'JPEG', quality=92)


def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)

    httpd = m.serve()
    fake = m.FakeGoogle()
    tmp = '/tmp/smg-p1-img'; os.makedirs(tmp, exist_ok=True); os.makedirs(SHOTS, exist_ok=True)
    for k, c, s in [('a', (150, 90, 40), 3), ('b', (40, 90, 150), 5), ('c', (90, 150, 40), 7)]:
        open(f'{tmp}/{k}.jpg', 'wb').write(m.make_jpeg(c, s))
    box_rear_with_barcode(f'{tmp}/rear_bc.jpg')
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
        ev = lambda js: page.evaluate(js)
        pill = lambda: page.inner_text('#status')

        def pick(text, path):
            with page.expect_file_chooser() as fc:
                page.get_by_text(text, exact=False).first.click()
            fc.value.set_files(path)

        def save_visible():
            return ev("""(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Save & next box'));
              const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return r.top >= 0 && r.bottom <= innerHeight && (el === b || b.contains(el)); })()""")

        # C3: Save reachable without scrolling, two phone sizes
        page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture'); page.wait_for_timeout(300)
        check(save_visible(), 'C3 Save button visible without scrolling at 400x860')
        page.set_viewport_size({'width': 360, 'height': 640}); page.wait_for_timeout(200)
        check(save_visible(), 'C3 Save button visible without scrolling at 360x640')
        page.set_viewport_size({'width': 400, 'height': 860})

        # C2: barcode read from the rear photo
        pick('Box front', f'{tmp}/a.jpg'); page.wait_for_selector('text=Box front ✓')
        pick('Barcode close-up', f'{tmp}/rear_bc.jpg'); page.wait_for_selector('text=Barcode close-up ✓'); page.wait_for_timeout(500)
        val = page.input_value('input[inputmode=numeric]')
        check(val == EAN, f'C2 barcode read from the rear photo (got "{val}")')
        check(page.is_visible('text=Read from the barcode photo'), 'C2 tells B where the barcode came from')
        page.screenshot(path=f'{SHOTS}/01-barcode-from-photo.png')

        # C1: Sealed is a toggle and is remembered for the next box
        page.get_by_role('button', name='Sealed box', exact=True).click(); page.wait_for_timeout(200)
        page.select_option('select', label='Pop Race'); page.wait_for_timeout(200)
        page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(200)
        page.fill('input[placeholder^="e.g. Range Rover"]', 'Nissan Skyline GT-R R34')
        page.locator('input[autocapitalize=characters]').fill('PR64-0161'); page.wait_for_timeout(200)
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('.toast'); page.wait_for_timeout(400)
        pressed = page.get_by_role('button', name='Sealed box', exact=True).get_attribute('aria-pressed')
        check(pressed == 'true', 'C1 "Sealed box" remembered for the next box')

        # A few more models, so the Garage scrolls (no photos needed for this check)
        ev("""(async () => { const s = await import('./js/store.js'); const b = (await s.list('brands')).find(x => x.name === 'Hot Wheels');
          await s.createMany([...Array(8).keys()].map(i => ({ entity: 'models', fields: { display_name: 'Filler car ' + i, brand_id: b.brand_id, completeness_status: 'quick' } }))); })()""")

        # G5/G6/G2: one chip row, no zero-count chips, no "Quick" badge, 3:4 tiles
        page.goto(base + '#/'); page.wait_for_selector('.tile'); page.wait_for_timeout(400)
        chips = page.locator('.chips.scroll .chip').all_inner_texts()
        check(not any(t.startswith(('Needs review', 'Clashes', 'Archived')) for t in chips), f'G5 empty filters hidden ({chips})')
        h = ev("document.querySelector('.chips.scroll').getBoundingClientRect().height")
        check(h < 60, f'G5 filters fit one row (height {h:.0f}px)')
        check(page.locator('.tile .b', has_text='Quick').count() == 0, 'G6 no "Quick" badge on tiles')
        ratio = ev("(() => { const r = document.querySelector('.tile .ph').getBoundingClientRect(); return r.height / r.width; })()")
        check(abs(ratio - 5 / 4) < 0.02, f'G2 tile photos are portrait 4:5 (ratio {ratio:.2f})')
        bg = ev("getComputedStyle(document.querySelector('header.top')).backgroundColor")
        check(bg.startswith('rgb(') and not bg.startswith('rgba'), f'V8 header fully opaque ({bg})')
        page.screenshot(path=f'{SHOTS}/02-garage.png')

        # G1: search
        res = {}
        for q in ['gt-r skyline', 'skyline gtr', 'pop race skyline', 'pr64 0161', 'pr640161', '1:64', EAN]:
            page.fill('input[type=search]', q); page.wait_for_timeout(120)
            res[q] = page.locator('.tile').count()
        check(all(v == 1 for v in res.values()), f'G1 search finds the Skyline every way ({res})')
        page.fill('input[type=search]', ''); page.wait_for_timeout(150)

        # I3: item opens at the top; Back returns to the same place in the Garage
        page.evaluate('window.scrollTo(0, document.body.scrollHeight)'); page.wait_for_timeout(200)
        y0 = ev('scrollY')
        page.locator('.tile').last.click(); page.wait_for_selector('text=Product'); page.wait_for_timeout(300)
        check(ev('scrollY') == 0, 'I3 item page opens at the top')
        page.get_by_text('← Garage').click(); page.wait_for_selector('.tile'); page.wait_for_timeout(400)
        y1 = ev('scrollY')
        check(y0 > 100 and abs(y1 - y0) < 40, f'I3 Back returns to the same Garage position ({y0} -> {y1})')

        # I2: barcode editable; photo relabel, make main, remove; archive and restore
        mid = ev("(async () => (await (await import('./js/store.js')).list('models')).find(x => x.display_name.startsWith('Nissan')).model_id)()")
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('text=Product'); page.wait_for_timeout(300)
        bc_in = page.locator('.card input[inputmode=numeric]').first
        check(bc_in.input_value() == EAN, 'I2 barcode shown in an editable field')
        bc_in.fill('8 40456393215'); page.wait_for_timeout(100)
        page.get_by_role('button', name='Save', exact=True).click(); page.wait_for_timeout(500)
        stored = ev(f"(async () => (await (await import('./js/store.js')).list('product_identifiers')).filter(i => i.model_id === '{mid}').map(i => i.value_cmp))()")
        check(stored == ['0840456393215'], f'I2 corrected barcode saved and standardised ({stored})')
        n_photos = page.locator('.gallery .fig').count()
        page.locator('.gallery .fig', has_text='Barcode close-up').click(); page.wait_for_selector('text=This photo')
        page.screenshot(path=f'{SHOTS}/03-photo-options.png')
        page.locator('.card', has_text='This photo').locator('select').select_option(label='Box end / side'); page.wait_for_timeout(500)
        check(page.locator('.gallery .fig', has_text='Box end / side').count() == 1, 'I2 photo relabelled')
        # the relabelled photo stays selected, so its options are still open
        page.get_by_role('button', name='Make main photo').click(); page.wait_for_timeout(500)
        check(page.locator('.gallery .fig', has_text='★ Box end').count() == 1, 'I2 relabelled photo made the main photo')
        page.get_by_role('button', name='Remove photo').click(); page.wait_for_timeout(500)
        check(page.locator('.gallery .fig').count() == n_photos - 1, 'I2 photo removed')
        check(page.locator('.gallery .fig', has_text='★ Box front').count() == 1, 'I2 removing the main photo falls back to the box front')
        page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        page.get_by_role('button', name='Remove', exact=True).click(); page.wait_for_selector('.tile'); page.wait_for_timeout(400)
        check(page.locator('.chips.scroll .chip', has_text='Archived (1)').count() == 1, 'I2 archived model listed under "Archived (1)"')
        page.locator('.chips.scroll .chip', has_text='Archived').click(); page.wait_for_timeout(300)
        page.locator('.tile').first.click(); page.wait_for_selector('text=Archived: hidden from your garage')
        page.get_by_role('button', name='Restore to garage').first.click(); page.wait_for_timeout(500)
        restored = ev(f"(async () => (await (await import('./js/store.js')).get('models', '{mid}')).deleted_at)()")
        check(restored == '', 'I2 archived model restored')

        # Sync: the photo removed before upload doesn't stay "waiting" forever
        ev("localStorage.setItem('smg.clientId', 'test-client.apps.googleusercontent.com')")
        page.goto(base + '#/'); page.wait_for_selector('.tile')
        page.click('#status')
        for _ in range(100):
            if pill() == 'All synced': break
            page.wait_for_timeout(200)
        check(pill() == 'All synced', f'sync completes with a removed, never-uploaded photo (pill "{pill()}")')
        sid = next(iter(fake.sheets)); book = fake.sheets[sid]
        hdr = book['PHOTOS'][0]
        roles = [dict(zip(hdr, r))['shot_role'] for r in book['PHOTOS'][1:] if dict(zip(hdr, r))['model_id'] == mid]
        check(roles == ['box_front'], f'sheet has only the kept photo ({roles})')

        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:3]})')
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
