"""Developer test for s1-0.14.0: restore from a backup (D25). NOT a phone test. Fake Google from e2e_mock.py.

Story: cars A and B synced -> "Back up now" -> car C added and synced -> car D added but NOT synced (restore must
refuse) -> sync -> restore the "Back up now" copy -> the app shows A and B; the old sheet is kept, renamed
"(replaced …)", still holding A-D; a fresh backup was made first; a second device opens the restored sheet.

Run:  python3 tests/e2e_restore.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'
ADD = """(async (names) => { const st = await import('./js/store.js'); const br = await st.list('brands'); const sc = await st.list('scales');
  for (const n of names) { const md = await st.create('models', { brand_id: br.find(b => b.name === 'Mini GT').brand_id, scale_id: sc.find(s => s.label === '1:64').scale_id, display_name: n, namespace_status: 'confirmed' });
    await st.create('inventory', { model_id: md.model_id, ownership_status: 'Owned', storage_location: 'Box 1' }); } })"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)

    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def device():
            ctx = b.new_context(viewport={'width': 400, 'height': 860})
            ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
            ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
            pg = ctx.new_page(); pg.goto(base + '#/'); pg.wait_for_selector('text=My Garage')
            pg.evaluate(f"localStorage.setItem('smg.clientId', '{CID}')")
            return ctx, pg
        ctx, page = device()
        errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        dialogs = []
        def on_dialog(d): dialogs.append(d.message); d.accept()
        page.on('dialog', on_dialog)

        def sync():
            page.goto(base + '#/'); page.wait_for_selector('#status'); page.click('#status')
            for _ in range(150):
                if page.inner_text('#status') == 'All synced': return True
                page.wait_for_timeout(200)
            return False
        def names_on_screen():
            page.goto(base + '#/'); page.wait_for_selector('#status'); page.fill('input[type=search]', ''); page.wait_for_timeout(500)
            return sorted(t.inner_text().split('\n')[0] for t in page.query_selector_all('.tile .nm'))
        def main_sheet():
            ids = [k for k, f in fake.files.items() if f['appProperties'].get('smgRole') == 'workbook' and not f.get('trashed')]
            return ids
        def models_in(sid):
            rows = fake.sheets[sid].get('MODELS', [])
            if not rows: return []
            i = rows[0].index('display_name'); d = rows[0].index('deleted_at')
            return sorted(r[i] for r in rows[1:] if len(r) > i and r[i] and not (len(r) > d and r[d]))

        check(sync(), 'setup sync')
        page.evaluate(ADD, ['Car A', 'Car B']); check(sync(), 'A and B synced')
        page.goto(base + '#/settings'); page.get_by_role('button', name='Back up now').click(); page.wait_for_selector('text=Backup made')
        page.wait_for_timeout(500)
        page.evaluate(ADD, ['Car C']); check(sync(), 'C synced')
        old = main_sheet()[0]

        # Unsynced change: restore refuses
        page.evaluate(ADD, ['Car D'])
        page.goto(base + '#/settings'); page.get_by_role('button', name='Restore from a backup…').click(); page.wait_for_selector('.restore')
        rows = page.locator('.restore .row')
        check(rows.count() >= 2, f'backups listed ({rows.count()})')
        page.locator('.restore .row', has_text='Back up now').first.get_by_role('button', name='Restore').click(); page.wait_for_timeout(600)
        check(page.is_visible('text=Sync first') and not dialogs and main_sheet() == [old], 'with unsynced changes, restore refuses (nothing changed)')

        check(sync(), 'D synced'); check(models_in(old) == ['Car A', 'Car B', 'Car C', 'Car D'], f'sheet before restore holds A-D ({models_in(old)})')
        manual_before = len([f for f in fake.files.values() if f['appProperties'].get('smgBackup') == 'manual'])
        page.goto(base + '#/settings'); page.wait_for_selector('text=Backups')
        if not page.is_visible('.restore'): page.get_by_role('button', name='Restore from a backup…').click()
        page.wait_for_selector('.restore')
        page.screenshot(path='/tmp/smg-restore-list.png')
        page.locator('.restore .row', has_text='Back up now').last.get_by_role('button', name='Restore').click()
        page.wait_for_selector('text=Restored the backup', timeout=20000); page.wait_for_timeout(800)
        check(len(dialogs) == 1 and 'kept in Drive' in dialogs[0], 'asks for confirmation, says the current sheet is kept')

        new = main_sheet()
        check(len(new) == 1 and new[0] != old, 'one main sheet, a new copy')
        check('(replaced' in fake.files[old]['name'] and fake.files[old]['appProperties'].get('smgRole') == 'replaced' and not fake.files[old].get('trashed'), f"old sheet kept, renamed ({fake.files[old]['name']})")
        check(models_in(old) == ['Car A', 'Car B', 'Car C', 'Car D'], 'old sheet still holds A-D')
        manual_after = len([f for f in fake.files.values() if f['appProperties'].get('smgBackup') == 'manual'])
        check(manual_after == manual_before + 1, 'a fresh backup was made before restoring')
        check(models_in(new[0]) == ['Car A', 'Car B'], f'restored sheet holds A and B ({models_in(new[0])})')
        check(names_on_screen() == ['Car A', 'Car B'], f'the app shows A and B ({names_on_screen()})')
        check('STORAGE_BOXES' in fake.sheets[new[0]], 'restored sheet has every current tab')

        # Keeps working: a new car syncs to the restored sheet
        page.evaluate(ADD, ['Car E']); check(sync(), 'sync after restore'); check(models_in(new[0]) == ['Car A', 'Car B', 'Car E'], 'new cars go to the restored sheet')
        log = fake.sheets[new[0]].get('CHANGE_LOG', [])
        check(any('restored_from' in r for r in log), 'restore recorded in CHANGE_LOG')

        # A second device opens the restored sheet, not the replaced one or a backup
        ctx2, lap = device()
        lap.click('#status')
        for _ in range(150):
            if lap.inner_text('#status') == 'All synced': break
            lap.wait_for_timeout(200)
        lap.goto(base + '#/'); lap.wait_for_selector('.tile'); lap.wait_for_timeout(500)
        lnames = sorted(t.inner_text().split('\n')[0] for t in lap.query_selector_all('.tile .nm'))
        check(lnames == ['Car A', 'Car B', 'Car E'], f'second device sees the restored collection ({lnames})')
        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:2]})')
        b.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}"); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
