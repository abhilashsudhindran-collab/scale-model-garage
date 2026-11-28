"""Developer test for s1-0.18.0: ＋1 copies (car page ＋ Add a copy, Photo run "Got another…? ＋1", Remove this copy).
Fake Google; NOT a phone test.

Run:  python3 tests/e2e_copies.py
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
    d = '/tmp/smg-copies'; os.makedirs(d, exist_ok=True)
    open(f'{d}/f.jpg', 'wb').write(m.make_jpeg((150, 90, 40), 3)); open(f'{d}/r.jpg', 'wb').write(m.make_jpeg((40, 90, 150), 5))
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(3)')
        copies = lambda mid: page.evaluate(f"(async () => (await (await import('./js/store.js')).list('inventory')).filter(i => i.model_id === '{mid}').map(i => i.storage_location))()")
        mid = page.evaluate("(async () => (await (await import('./js/store.js')).list('models'))[0].model_id)()")
        box0 = copies(mid)[0]
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('.copyhead')
        check(page.inner_text('.copyhead h3') == '1 copy', 'car page shows "1 copy" with ＋ Add a copy')
        page.get_by_role('button', name='＋ Add a copy').click(); page.wait_for_timeout(700)
        check(page.inner_text('.copyhead h3') == '2 copies' and copies(mid) == [box0, box0], f'＋ Add a copy: 2 copies, new one in the same box ({copies(mid)})')
        page.get_by_role('button', name='＋ Add a copy').click(); page.wait_for_timeout(700)
        check(page.inner_text('.copyhead h3') == '3 copies', '＋ again: 3 copies (each a real record)')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => r.reason === '＋1 copy').length)()")
        check(log == 2, 'each ＋1 is logged in the change history')
        page.locator('details.copy').last.locator('summary').click(); page.wait_for_timeout(200)
        page.locator('details.copy').last.get_by_role('button', name='Remove this copy').click(); page.wait_for_timeout(700)
        check(page.inner_text('.copyhead h3') == '2 copies', 'Remove this copy: back to 2 (archived, not deleted)')
        allinv = page.evaluate(f"(async () => (await (await import('./js/store.js')).list('inventory', {{ includeDeleted: true }})).filter(i => i.model_id === '{mid}').length)()")
        check(allinv == 3, 'removed copy is still kept (archived)')
        # Photo run: ＋1 after a car saves
        page.goto(base + '#/'); page.locator('.shelfhome .boxtile.newbox').click(); page.wait_for_selector('.boxcard')
        page.locator('.boxcard .chip', has_text='Only Mini GT').first.click() if page.locator('.boxcard .chip', has_text='Only Mini GT').count() else None
        page.locator('.boxcard select[aria-label="Brand for this box"]').select_option(label='Mini GT') if page.locator('.boxcard select[aria-label="Brand for this box"]').count() else None
        page.wait_for_timeout(300); page.locator('.boxcard .chip', has_text='Only 1:64').click(); page.wait_for_timeout(300)
        label = page.inner_text('.boxcard h3').split('·')[0].strip() if page.locator('.boxcard h3').count() else ''
        page.locator('.boxcard button', has_text='Fill Box').click(); page.wait_for_selector('.banner.fill')
        if page.is_visible('text=Done: start shooting'):
            page.get_by_role('button', name='Car visible', exact=True).click(); page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(200)
        for role, f in (('Box front', 'f'), ('Barcode side', 'r')):
            with page.expect_file_chooser() as fc: page.get_by_role('button', name=role).click()
            fc.value.set_files(f'{d}/{f}.jpg'); page.wait_for_timeout(1000)
        page.wait_for_selector('.plusone', timeout=8000)
        check(page.inner_text('.plusone') == 'Got another of car 1? ＋1', f'Photo run offers ＋1 after a car saves ({page.inner_text(".plusone")!r})')
        page.locator('.plusone').click(); page.wait_for_timeout(700)
        check(page.inner_text('.plusone') == '＋1 more of car 1 (now 2)', 'after ＋1: "now 2", tap again for 3')
        runmid = page.evaluate("(async () => { const st = await import('./js/store.js'); const log = (await st.list('change_log')).filter(r => r.reason === '＋1 copy'); const last = log[log.length - 1]; return (await st.list('inventory')).find(i => i.inventory_id === last.record_id).model_id; })()")
        locs = copies(runmid)
        check(len(locs) == 2 and locs[0] == locs[1] and locs[0].startswith('Box '), f'＋1 in Photo run: 2 copies in the box being filled, no new photos ({locs})')
        nphotos = page.evaluate(f"(async () => (await (await import('./js/store.js')).list('photos')).filter(p => p.model_id === '{runmid}').length)()")
        check(nphotos == 2, 'no extra photos for the copy')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
