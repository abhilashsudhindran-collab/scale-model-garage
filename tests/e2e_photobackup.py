"""Developer test for s1-0.60.0: photo backup reminder (D25, every 90 days). Synced cars whose first photo is recent:
Settings shows the next date, no Dashboard nudge. First photo over 90 days old: Settings says Due and shows the steps,
the Dashboard shows "Photo backup due". "I've downloaded them" (confirmed) records today on the phone and in the
sheet's SETTINGS tab (key added), logs it, and the nudge goes away. A date already in the sheet (another device) is
picked up. Fake Google; NOT a phone test.

Run:  python3 tests/e2e_photobackup.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

CID = 'test-client.apps.googleusercontent.com'


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        ev = page.evaluate
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        ev(SEED + '(4)')
        ev(f"localStorage.setItem('smg.clientId', '{CID}')")
        page.click('#status')
        for _ in range(150):
            if page.inner_text('#status') == 'All synced': break
            page.wait_for_timeout(200)
        check(page.inner_text('#status') == 'All synced', 'cars and photos synced')
        page.goto(base + '#/settings'); page.wait_for_selector('#photobackup')
        t = page.inner_text('#photobackup')
        check('Next by' in t and 'not done yet' in t and 'Due' not in t, f'recent photos: next date shown, not due ({t[:90]!r})')
        page.goto(base + '#/dash'); page.wait_for_selector('.card.hero'); page.wait_for_timeout(300)
        check(page.locator('.photodue').count() == 0, 'no Dashboard nudge while not due')
        # Make the first photo 100 days old
        ev("""(async () => { const idb = await import('./js/idb.js'); const recs = await idb.records.byEntity('photos');
          const old = new Date(Date.now() - 100 * 86400000).toISOString(); recs.forEach(r => { r.data.created_at = old; }); await idb.records.putMany(recs); })()""")
        page.goto(base + '#/settings'); page.goto(base + '#/dash'); page.wait_for_selector('.card.hero'); page.wait_for_timeout(300)
        check(page.locator('.photodue').count() == 1 and 'Photo backup due' in page.inner_text('.photodue'), 'Dashboard shows "Photo backup due"')
        page.locator('.photodue').click(); page.wait_for_selector('#photobackup')
        page.locator('#photobackup').scroll_into_view_if_needed(); page.screenshot(path='/tmp/photobackup_due.png')
        t = page.inner_text('#photobackup')
        check('Due' in t and 'drive.google.com' in t and 'SCALE GARAGE' in t and 'Takeout' in t, f'Settings: due, with the steps open ({t[:100]!r})')
        page.get_by_role('button', name="I've downloaded them").click(); page.wait_for_timeout(800)
        sid = next(iter(fake.sheets)); rows = fake.sheets[sid].get('SETTINGS', [])
        row = next((r for r in rows if r and r[0] == 'last_photo_backup_at'), None)
        check(row is not None and row[1].startswith('20'), f'date written to the sheet SETTINGS tab {row}')
        local = ev("(async () => (await import('./js/idb.js')).meta.get('photoBackupAt', ''))()")
        check(bool(local) and row and row[1] == local, 'same date kept on the phone')
        log = ev("(async () => (await (await import('./js/store.js')).list('change_log')).filter(c => c.field === 'last_photo_backup_at').length)()")
        check(log == 1, f'logged in CHANGE_LOG ({log})')
        t = page.inner_text('#photobackup')
        check('Next by' in t and 'last done' in t, f'Settings shows the next date and "last done" ({t[:90]!r})')
        page.goto(base + '#/dash'); page.wait_for_selector('.card.hero'); page.wait_for_timeout(300)
        check(page.locator('.photodue').count() == 0, 'the nudge is gone')
        # Another device marked it later: a newer date in the sheet is picked up on a fresh session
        newer = '2026-12-30T10:00:00.000Z'
        for r in fake.sheets[sid]['SETTINGS']:
            if r and r[0] == 'last_photo_backup_at': r[1] = newer
        page.reload(); page.wait_for_selector('#status')
        page.click('#status')  # sign in again (token is memory only)
        for _ in range(100):
            if page.inner_text('#status') == 'All synced': break
            page.wait_for_timeout(200)
        page.goto(base + '#/settings'); page.wait_for_selector('#photobackup'); page.wait_for_timeout(500)
        got = ev("(async () => (await import('./js/idb.js')).meta.get('photoBackupAt', ''))()")
        check(got == newer, f'a newer date from the sheet (another device) is picked up ({got})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED'); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
