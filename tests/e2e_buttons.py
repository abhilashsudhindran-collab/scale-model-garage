"""Developer test for s1-0.17.5 (B, 24 Nov 23:10): button look rule.
Greyed = can't work now; quiet = works but not needed; bold = something to do. One Sync button in Settings.
Fake Google; NOT a phone test.

Run:  python3 tests/e2e_buttons.py
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
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        check(page.get_by_role('button', name='Sign in & set up').count() == 1, 'signed out: account card offers Sign in & set up')
        page.fill('input[aria-label="Google Client ID"]', 'test-client.apps.googleusercontent.com')
        page.get_by_role('button', name='Sign in & set up').click(); page.wait_for_selector('text=Synced:', timeout=60000); page.wait_for_timeout(800)
        sync_btns = page.locator('button', has_text='Sync now')
        check(sync_btns.count() == 1, f'signed in: only ONE Sync button on the page ({sync_btns.count()})')
        check(page.is_visible('text=Signed in ✓') and not page.locator('input[aria-label="Google Client ID"]').is_visible(), 'signed in: status line; Client ID folded away')
        btn = page.locator('.syncbtn')
        check('quiet' in btn.get_attribute('class') and not btn.is_disabled() and btn.inner_text() == 'Sync now', 'all synced: Sync is quiet but still tappable')
        page.evaluate(SEED + '(2)')
        page.evaluate("(async () => { const st = await import('./js/store.js'); const ms = await st.list('models'); await st.update('models', ms[0].model_id, { notes: 'x' }); })()")
        page.reload(); page.wait_for_selector('text=Google account'); page.wait_for_timeout(600)
        check(page.locator('.syncbtn').count() == 0 and page.is_visible('text=Sign in above to sync.') and page.get_by_role('button', name='Sign in & set up').count() == 1, 'signed out: one bold button (Sign in), no second Sync')
        check('0 photos' not in page.inner_text('main') if page.locator('main').count() else True, 'no "0 photos not uploaded" line')
        page.fill('input[aria-label="Google Client ID"]', 'test-client.apps.googleusercontent.com')
        page.evaluate("(async () => { (await import('./js/google.js')).signIn && await (await import('./js/google.js')).signIn(); })()"); page.goto(base + '#/dash'); page.goto(base + '#/settings'); page.wait_for_selector('.syncbtn'); page.wait_for_timeout(600)
        check('quiet' not in btn.get_attribute('class') and btn.inner_text().startswith('Sync now · 1 box'), f'something waiting: Sync is bold and says what ({btn.inner_text()!r})')
        page.screenshot(path='/tmp/smg-buttons-waiting.png')
        ctx.set_offline(True); page.wait_for_timeout(500)
        check(btn.is_disabled() and 'Offline' in btn.inner_text(), 'offline: Sync greyed out')
        ctx.set_offline(False); page.wait_for_timeout(500)
        # Car page Save: quiet until a change
        mid = page.evaluate("(async () => (await (await import('./js/store.js')).list('models'))[1].model_id)()")
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('#pdpSave')
        check('quiet' in page.get_attribute('#pdpSave', 'class'), 'car page: Save quiet when nothing changed')
        page.locator('#pdpDetails input').first.fill('Renamed'); page.wait_for_timeout(200)
        check('quiet' not in page.get_attribute('#pdpSave', 'class'), 'car page: Save turns bold after a change')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
