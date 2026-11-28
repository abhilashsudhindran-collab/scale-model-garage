"""Developer test for s1-0.54.0: Helper mode (D32). Two separate phones (browser contexts): the owner makes a helper
file, the helper loads it, catalogues a box offline with no sign-in, sends it; the owner reviews and imports it,
and a signed-in owner syncs the imported photos to (fake) Drive. Fake Google, desktop Chrome; NOT a phone test.

Run:  python3 tests/e2e_helper.py
"""
import json, os, sys, time, zipfile, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

N = 20


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    d = '/tmp/smg-helper'; os.makedirs(d, exist_ok=True)
    t0 = time.time() - 3600; pics = []
    for k in range(4):
        data = m.make_jpeg((70 + 40 * k, 110, 190 - 30 * k), 5 + k)
        f = f'{d}/h{k}.jpg'; open(f, 'wb').write(data); os.utime(f, (t0 + k * 20, t0 + k * 20)); pics.append(f)
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def phone():
            ctx = b.new_context(viewport={'width': 400, 'height': 860}, accept_downloads=True)
            ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
            pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda dl: dl.accept())
            return ctx, pg, errs
        js = lambda pg, code: pg.evaluate(f"(async () => {{ const st = await import('./js/store.js'); const idb = await import('./js/idb.js'); {code} }})()")

        # ---------- owner: 20 cars with prices, then the helper file ----------
        octx, owner, oerr = phone()
        owner.goto(base + '#/'); owner.wait_for_selector('text=My Garage')
        owner.evaluate(SEED + f'({N})')
        js(owner, "const inv = await idb.records.byEntity('inventory'); inv.forEach(r => { r.data.purchase_price = '1499'; r.data.purchase_source = 'Secret Shop'; r.data.notes = 'birthday gift'; }); await idb.records.putMany(inv); const ms = await idb.records.byEntity('models'); ms.forEach(r => { r.data.code_namespace_type = 'brand'; r.data.code_namespace_id = r.data.brand_id; }); await idb.records.putMany(ms);")
        bmodels = js(owner, "return (await st.list('models')).sort((a, b) => a.product_code.localeCompare(b.product_code)).map(m => ({ id: m.model_id, code: m.product_code, name: m.display_name }));")
        owner.goto(base + '#/settings'); owner.wait_for_selector('.helpercard')
        check(owner.is_visible('text=Make the file for a helper'), 'owner Settings has a Helper card')
        owner.locator('.helpercard').screenshot(path=f'{d}/shot-owner-card.png')
        with owner.expect_download() as dl: owner.get_by_role('button', name='Make the file for a helper').click()
        lookup = f'{d}/{dl.value.suggested_filename}'; dl.value.save_as(lookup)
        with zipfile.ZipFile(lookup) as z:
            names = z.namelist(); man = json.loads(z.read('manifest.json')); tables = z.read('lookup.json').decode()
        check(man['kind'] == 'smg-helper-lookup' and man['cars'] == N, f'lookup file: {man["cars"]} cars')
        check(sum(1 for n in names if n.startswith('photos/')) == N, f'one small photo per car ({sum(1 for n in names if n.startswith("photos/"))})')
        check('1499' not in tables and 'Secret Shop' not in tables and 'birthday gift' not in tables and 'purchase_price' not in tables, 'no prices, shop or copy notes in the helper file')
        print(f'    lookup size for {N} cars: {os.path.getsize(lookup) / 1024:.0f} KB ({os.path.getsize(lookup) / N / 1024:.1f} KB per car, test thumbnails)')
        owner.goto(base + '#/helper'); owner.wait_for_selector('h2:has-text("Helper mode")')
        check(owner.is_visible('text=This phone has its own garage'), "the owner's phone refuses Helper mode")

        # ---------- helper: load, catalogue a box, ＋1, send ----------
        hctx, helper, herr = phone()
        helper.goto(base + '#/helper'); helper.wait_for_selector("text=Load the owner's file"); helper.screenshot(path=f'{d}/shot-helper-start.png')
        with helper.expect_file_chooser() as fc: helper.get_by_role('button', name="Load the owner's file").click()
        fc.value.set_files(lookup)
        helper.wait_for_selector('.helperbanner'); helper.wait_for_selector('.tile'); helper.wait_for_timeout(500); helper.screenshot(path=f'{d}/shot-helper-garage.png')
        check(helper.is_visible('text=20 models'), "helper sees the owner's 20 cars")
        check(not helper.is_visible('#navname') and helper.inner_text('nav.bottom a[href="#/settings"]').strip() == 'Send', 'helper: Name tab hidden, Settings becomes Send')
        check(not helper.is_visible('text=Welcome!') and not helper.is_visible('text=Sign in'), 'helper: no sign-in prompts')
        leak = js(helper, "return (await st.list('inventory')).filter(i => i.purchase_price || i.purchase_source || i.notes).length;")
        check(leak == 0, 'helper phone holds no prices or notes')
        helper.locator('.shelfhome .boxtile.newbox').click(); helper.wait_for_selector('.boxcard')
        newbox = helper.inner_text('.boxcard').split('\n')[0]
        boxn = ''.join(ch for ch in helper.locator('.boxcard').inner_text() if ch.isdigit())[:2]
        helper.locator('.boxcard button', has_text='📥 Import photos into Box').click(); helper.wait_for_selector('text=📥 Import from gallery')
        helper.select_option('select[aria-label="Brand for imported cars"]', label='Mini GT'); helper.wait_for_timeout(300)
        helper.locator('.chip', has_text='1:64').first.click(); helper.wait_for_timeout(200)
        with helper.expect_file_chooser() as fc: helper.get_by_role('button', name='Pick photos from the gallery').click()
        fc.value.set_files(pics); helper.wait_for_selector('.importgrid')
        helper.get_by_role('button', name='Import 2 cars').click(); helper.wait_for_url('**/#/name', timeout=60000); helper.wait_for_timeout(600)
        hm = js(helper, "const all = await idb.records.byEntity('models'); return all.filter(r => !r.lookup).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at)).map(r => r.id);")
        box = js(helper, f"return (await st.list('inventory')).find(i => i.model_id === '{hm[0]}').storage_location;")
        check(len(hm) == 2 and box.startswith('Box '), f'helper catalogued 2 cars into {box}')
        target = next(x for x in bmodels if x['code'] == 'MGT00001-L')  # brand Mini GT in the seed
        js(helper, f"await st.update('models', '{hm[0]}', {{ product_code: 'mgt00001-l', product_code_cmp: 'MGT00001-L', display_name: 'Same as owner' }}); await st.update('models', '{hm[1]}', {{ display_name: 'Helper Bronco', product_code: 'XYZ-777' }});")
        other = next(x for x in bmodels if x['code'] == 'MGT00002-L')
        helper.goto(base + f'#/item/{other["id"]}'); helper.wait_for_selector('text=Found another one of these?')
        check(helper.is_visible('text=The owner has 1 copy') and not helper.is_visible('text=Edit details'), "owner's car is read-only on the helper's phone")
        helper.fill('input[aria-label="Box number for the extra copy"]', box.split(' ')[1])
        helper.get_by_role('button', name='＋1 copy').click(); helper.wait_for_selector('text=You added 1 more copy'); helper.screenshot(path=f'{d}/shot-helper-lookupcar.png', full_page=True)
        helper.goto(base + '#/settings'); helper.wait_for_selector('.sendbox')
        helper.screenshot(path=f'{d}/shot-helper-send.png', full_page=True)
        check(helper.is_visible(f'text=Send {box}') and helper.is_visible('text=Not sent yet'), f'Send tab lists {box}, not sent yet')
        check('to send' in helper.inner_text('#status'), f'status pill: {helper.inner_text("#status")}')
        with helper.expect_download() as dl: helper.get_by_role('button', name=f'Send {box}').click()
        inbox = f'{d}/{dl.value.suggested_filename}'; dl.value.save_as(inbox)
        helper.wait_for_selector('text=Sent ✓')
        check(helper.is_visible('text=Send again') and helper.inner_text('#status').strip() == 'Helper mode', 'box marked sent; nothing left to send')
        with zipfile.ZipFile(inbox) as z:
            man = json.loads(z.read('manifest.json')); recs = json.loads(z.read('records.json')); photos = [n for n in z.namelist() if n.startswith('photos/')]
            orig = {n.split('/')[1].rsplit('-', 1)[0]: hashlib.md5(z.read(n)).hexdigest() for n in photos if n.endswith('-original.jpg')}
        check(man['kind'] == 'smg-helper-inbox' and man['box'] == box, f'inbox file for {box}')
        check(len([r for r in recs if r['entity'] == 'models']) == 2 and len([r for r in recs if r['entity'] == 'inventory']) == 3, 'inbox: 2 new cars + 3 copies (incl. the ＋1)')
        check(len(photos) == 12, f'inbox: 4 photos × original, display, thumb ({len(photos)})')
        check(all(r['data'].get('model_id') != other['id'] for r in recs if r['entity'] == 'models'), "the owner's car itself is not sent back")
        photo_rows = {r['data']['photo_id']: r['data'] for r in recs if r['entity'] == 'photos'}
        check(all(photo_rows[k]['original_md5'] == v for k, v in orig.items()), 'original photos in the file match their recorded checksums')
        js(helper, f"await st.update('models', '{hm[1]}', {{ display_name: 'Helper Bronco 2' }});")
        helper.reload(); helper.wait_for_selector('.sendbox')
        check(helper.is_visible('text=Changed since you sent it'), 'an edit after sending shows "Changed since you sent it"')
        check(helper.locator('button', has_text='Leave Helper mode').is_disabled(), "can't leave Helper mode with a box not sent")

        # ---------- owner: review and import ----------
        owner.goto(base + '#/inbox'); owner.wait_for_selector('text=Pick helper box files')
        with owner.expect_file_chooser() as fc: owner.get_by_role('button', name='Pick helper box files').click()
        fc.value.set_files(inbox); owner.wait_for_selector('.inboxrow')
        owner.wait_for_timeout(400); owner.screenshot(path=f'{d}/shot-owner-review.png', full_page=True)
        check(owner.locator('.inboxrow').count() == 3, f'review list: 3 rows ({owner.locator(".inboxrow").count()})')
        check(owner.is_visible('text=You already have this') and owner.is_visible('text=New car') and owner.is_visible('text=Another copy of your car'), 'statuses: already have / new / another copy')
        dup = owner.locator('.inboxrow', has_text='You already have this')
        check('on' in dup.locator('.chip', has_text='Copy of your').get_attribute('class'), 'duplicate defaults to "copy of your car" (owner can change it)')
        owner.get_by_role('button', name='Import 3 cars').click(); owner.wait_for_url('**/#/', timeout=30000); owner.wait_for_timeout(500)
        after = js(owner, f"""const ms = await st.list('models'), inv = await st.list('inventory'), ph = await idb.records.byEntity('photos');
          const imp = ph.filter(r => r.data.device_id !== 'perf');
          const files = await Promise.all(imp.map(r => idb.blobs.get(r.id + ':original')));
          return {{ models: ms.length, inv: inv.length, onTarget: inv.filter(i => i.model_id === '{target['id']}').length, onOther: inv.filter(i => i.model_id === '{other['id']}').length,
            photos: imp.length, files: files.filter(Boolean).length, dirty: imp.every(r => r.dirty === 1), primaryKept: (await st.get('models', '{target['id']}')).primary_photo_id !== '' }};""")
        check(after['models'] == N + 1 and after['inv'] == N + 3, f"owner now has {after['models']} cars, {after['inv']} copies (1 new car, 3 copies)")
        check(after['onTarget'] == 2 and after['onOther'] == 2, 'duplicate and ＋1 became copies of the owner\'s cars')
        check(after['photos'] == 4 and after['files'] == 4 and after['dirty'], 'imported photos stored with their files, waiting to sync')
        owner.goto(base + '#/inbox')
        with owner.expect_file_chooser() as fc: owner.get_by_role('button', name='Pick helper box files').click()
        fc.value.set_files(inbox); owner.wait_for_selector('.inboxrow')
        check(owner.locator('.inboxrow', has_text='Already imported').count() == 3 and owner.locator('button', has_text='Nothing chosen to import').is_disabled(), 'the same file again: everything "Already imported"')

        # ---------- a signed-in owner: imported photos reach Drive ----------
        fake = m.FakeGoogle()
        sctx, signed, serr = phone()
        sctx.route('https://www.googleapis.com/**', fake.handle); sctx.route('https://sheets.googleapis.com/**', fake.handle)
        signed.goto(base + '#/settings'); signed.wait_for_selector('text=Google account')
        signed.fill('input[placeholder^="OAuth Client ID"]', 'test-client.apps.googleusercontent.com')
        signed.get_by_role('button', name='Sign in & set up').click(); signed.wait_for_selector('text=Synced:', timeout=30000)
        signed.goto(base + '#/inbox')
        with signed.expect_file_chooser() as fc: signed.get_by_role('button', name='Pick helper box files').click()
        fc.value.set_files(inbox); signed.wait_for_selector('.inboxrow')
        check(signed.locator('.inboxrow', has_text="isn't in your garage").count() == 1, "a copy of a car this garage doesn't have is not imported")
        signed.get_by_role('button', name='Import 2 cars').click(); signed.wait_for_url('**/#/', timeout=30000)
        signed.goto(base + '#/settings'); signed.wait_for_selector('.syncbtn')
        check('waiting' in signed.inner_text('#status'), f'imported cars wait to sync ({signed.inner_text("#status")})')
        signed.get_by_role('button', name='Sync now').first.click(); signed.wait_for_selector('#status:has-text("All synced")', timeout=90000)
        sid = next(k for k, f in fake.files.items() if f.get('mimeType') == 'application/vnd.google-apps.spreadsheet' and not f['appProperties'].get('smgBackup'))
        book = fake.sheets[sid]
        up = {f['md5'] for f in fake.files.values() if f.get('md5')}
        check(len(book['MODELS']) == 3 and len(book['INVENTORY']) == 3, f"sheet: 2 cars, 2 copies (MODELS {len(book['MODELS']) - 1}, INVENTORY {len(book['INVENTORY']) - 1})")
        check(set(orig.values()) <= up, f'all {len(orig)} original photos reached Drive unchanged (checksums match)')
        check(len([f for f in fake.files.values() if f.get('md5')]) == 12, f"12 photo files in Drive (4 × 3) ({len([f for f in fake.files.values() if f.get('md5')])})")
        check(not oerr and not herr and not serr, f'no page errors {(oerr + herr + serr)[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
