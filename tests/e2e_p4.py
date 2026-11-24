"""Developer test for release s1-0.6.0 (names from Gemini or Claude, copy-paste). NOT a phone test.
The phone's share sheet and clipboard are SIMULATED here; whether B's Gemini/Claude app accepts the
shared photos can only be checked on his phone. Fake Google from e2e_mock.py.

Run:  python3 tests/e2e_p4.py
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from e2e_p1 import box_rear_with_barcode
from playwright.sync_api import sync_playwright

SHOTS = '/tmp/smg-p4'
MOCK_SHARE = """
window.__shared = null; window.__clip = '';
navigator.canShare = (d) => !!(d && d.files && d.files.length);
navigator.share = async (d) => { window.__shared = { n: (d.files || []).length, names: (d.files || []).map(f => f.name), types: (d.files || []).map(f => f.type), text: d.text }; };
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__clip = t; }, readText: async () => window.__clip }, configurable: true });
"""
ANSWER = """Sure, here are the boxes:
Box 1 | Nissan Skyline GT-R R34 | MGT00341-L | MINI GT
Box 2 | Toyota Supra A80 | =HYPERLINK("x") | Kaido House
Box 3 | - | XYZ-1 | -
Let me know if you need more."""


def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)

    httpd = m.serve()
    fake = m.FakeGoogle()
    tmp = '/tmp/smg-p4-img'; os.makedirs(tmp, exist_ok=True); os.makedirs(SHOTS, exist_ok=True)
    for k, c, s in [('a', (150, 90, 40), 3), ('b', (40, 90, 150), 5), ('c', (90, 150, 40), 7)]:
        open(f'{tmp}/{k}.jpg', 'wb').write(m.make_jpeg(c, s))
    base = f'http://localhost:{m.PORT}/'

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 400, 'height': 860}, is_mobile=True, has_touch=True)
        ctx.add_init_script(MOCK_SHARE)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle)
        ctx.route('https://sheets.googleapis.com/**', fake.handle)
        ev = lambda js: page.evaluate(js)
        listm = lambda: ev("(async () => (await (await import('./js/store.js')).list('models')))()")

        def shoot(label, path):
            with page.expect_file_chooser() as fc:
                page.get_by_role('button', name=f'📷 {label}').click()
            fc.value.set_files(path)

        # Three nameless boxes from a photo run (different photos, no barcodes)
        page.goto(base + '#/run'); page.wait_for_selector('text=Photo run')
        page.select_option('select[aria-label=Brand]', label='Mini GT'); page.wait_for_timeout(250)
        page.get_by_role('button', name='1:64', exact=True).click(); page.wait_for_timeout(250)
        page.get_by_role('button', name='Car visible', exact=True).click(); page.wait_for_timeout(200)
        page.get_by_role('button', name='Done: start shooting').click(); page.wait_for_timeout(200)
        for i, (f, r) in enumerate([('a', 'b'), ('b', 'c'), ('c', 'a')]):
            shoot('Box front', f'{tmp}/{f}.jpg'); page.wait_for_selector('button:has-text("📷 Box rear")')
            shoot('Box rear', f'{tmp}/{r}.jpg'); page.wait_for_selector(f'text=Box {i + 2} of this run')
        check(len(listm()) == 3, 'three nameless boxes to start')

        # Box 3 already has a code typed earlier (no name): it must survive naming
        ev("(async () => { const s = await import('./js/store.js'); const ms = (await s.list('models')).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))); await s.update('models', ms[2].model_id, { product_code: 'TEST-003' }); })()")

        # Prepare and share
        page.goto(base + '#/name'); page.wait_for_selector('text=Names from Gemini or Claude')
        page.wait_for_timeout(300); page.screenshot(path=f'{SHOTS}/00-name.png')
        page.get_by_role('button', name='Get names for the next 3 boxes').click(); page.wait_for_selector('text=6 photos ready')
        page.wait_for_timeout(200); page.locator('.aicard').screenshot(path=f'{SHOTS}/00b-ready.png')
        page.get_by_role('button', name='Share to Gemini or Claude').click(); page.wait_for_selector('text=Waiting for the answer for 3 boxes')
        shared = ev('window.__shared')
        check(shared['n'] == 6 and shared['names'][:2] == ['box1-front.jpg', 'box1-back.jpg'], f"6 photos shared in box order ({shared['names']})")
        check(all(t == 'image/jpeg' for t in shared['types']), 'shared photos are JPEG copies')
        check('Box 3: photo 5 = box front' in shared['text'] and 'Box 1 | car name' in shared['text'], 'instructions sent with the photos')
        check(ev('window.__clip') == shared['text'], 'instructions also copied to the clipboard')
        page.wait_for_timeout(300); page.locator('.aicard').screenshot(path=f'{SHOTS}/01-waiting.png')

        # Paste the answer back
        ev(f"window.__clip = {json.dumps(ANSWER)}")
        page.get_by_role('button', name='Paste from clipboard').click(); page.wait_for_timeout(200)
        page.get_by_role('button', name='Use this answer').click(); page.wait_for_selector('text=Suggested by AI')
        check(page.input_value('input[aria-label=Name]') == 'Nissan Skyline GT-R R34' and page.input_value('input[aria-label="Product code"]') == 'MGT00341-L', 'box 1: name and code pre-filled as a suggestion')
        check(len([x for x in listm() if x['display_name']]) == 0, 'nothing saved until B taps Save')
        page.wait_for_timeout(300); page.screenshot(path=f'{SHOTS}/02-suggestion.png')
        page.get_by_role('button', name='Save & next').click(); page.wait_for_timeout(600)

        # Box 2: junk code rejected, brand difference noted, B edits the name
        check(page.input_value('input[aria-label="Product code"]') == '' and page.is_visible('text=ignored (unexpected characters)'), 'box 2: formula-like code rejected and explained')
        check(page.is_visible('text=AI read the brand as "Kaido House"'), 'box 2: brand difference shown as a note only')
        page.fill('input[aria-label=Name]', 'Toyota Supra A80 Kaido House'); page.get_by_role('button', name='Save & next').click(); page.wait_for_timeout(600)

        # Box 3: AI couldn't read it, B types the name
        check(page.input_value('input[aria-label=Name]') == '', 'box 3: unreadable stays empty')
        check(page.input_value('input[aria-label="Product code"]') == 'TEST-003', 'box 3: code saved earlier is shown, not replaced by the AI reading')
        check(page.is_visible('text=Keeping the code already saved'), 'box 3: different AI code shown as a note only')
        page.fill('input[aria-label=Name]', 'Honda Civic EF'); page.get_by_role('button', name='Save & next').click(); page.wait_for_timeout(600)
        check(page.is_visible('text=Every box has a name'), 'all three named')

        ms = {x['display_name']: x for x in listm()}
        check(ms['Nissan Skyline GT-R R34']['product_code'] == 'MGT00341-L' and ms['Nissan Skyline GT-R R34']['identification_status'] == 'confirmed', 'confirmed AI name and code saved, marked confirmed')
        check(ms['Honda Civic EF']['product_code'] == 'TEST-003', 'box 3: earlier code kept after saving')
        log = ev("(async () => (await (await import('./js/store.js')).list('ai_log')))()")
        check(len(log) == 1 and log[0]['prompt_version'] == 'names-v2' and 'Skyline' in log[0]['ai_response_raw'], 'AI_LOG records the prompt version and raw answer')
        conf = json.loads(log[0]['confirmed_values'] or '{}')
        edited = sorted(v['edited'] for v in conf.values())
        check(len(conf) == 3 and edited == [False, True, True], f'AI_LOG records what B confirmed vs edited ({edited})')

        # AI_LOG reaches the sheet
        ev("localStorage.setItem('smg.clientId', 'test-client.apps.googleusercontent.com')")
        page.goto(base + '#/'); page.wait_for_selector('.tile'); page.click('#status')
        for _ in range(100):
            if page.inner_text('#status') == 'All synced': break
            page.wait_for_timeout(200)
        sid = next(iter(fake.sheets)); rows = fake.sheets[sid]['AI_LOG']
        check(len(rows) == 2 and 'names-v2' in rows[1], f'AI_LOG row synced to the sheet ({len(rows) - 1} row)')

        check(not [e for e in errors if 'ERR_CONNECTION' not in e], f'no page errors ({errors[:3]})')
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
