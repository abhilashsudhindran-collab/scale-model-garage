"""Developer test for s1-0.49.0: share into the app (D16). Simulates the Android share sheet by POSTing photos and
text to ./share-target (as Chrome does for an installed app's share_target) and checks the service worker keeps them,
#/share shows them, "Do I own this?" finds a car by the barcode in the photo and by the code in the text, says
honestly when nothing matches, "Add to garage" hands the photos to Import, and Clear empties it.
Fake data; NOT a phone test (whether WhatsApp lists Garage in its share sheet is only known on B's phone).

Run:  python3 tests/e2e_share.py
"""
import os, sys, json, base64, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from e2e_p1 import box_rear_with_barcode, EAN
from playwright.sync_api import sync_playwright

POST = """async ([files, title, text]) => {
  const fd = new FormData(); fd.append('title', title); fd.append('text', text);
  for (const [name, b64] of files) { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); fd.append('photos', new File([bin], name, { type: 'image/jpeg' })); }
  const r = await fetch('./share-target', { method: 'POST', body: fd, redirect: 'manual' }); return r.type + ':' + r.status; }"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    tmp = tempfile.mkdtemp(); box_rear_with_barcode(f'{tmp}/rear.jpg')
    rear = base64.b64encode(open(f'{tmp}/rear.jpg', 'rb').read()).decode()
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    man = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'manifest.webmanifest')))
    st = man.get('share_target', {})
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        check(st.get('method') == 'POST' and st.get('enctype') == 'multipart/form-data' and st['params']['files'][0]['accept'] == ['image/*'], 'manifest declares a POST share target for photos')
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller", timeout=15000) if page.evaluate("!!navigator.serviceWorker.controller") else (page.reload(), page.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000))
        page.evaluate(SEED + '(6)')
        info = page.evaluate(f"""(async () => {{ const st = await import('./js/store.js'); const ms = (await st.list('models')).sort((a, b) => a.display_name.localeCompare(b.display_name));
          const ids = await st.list('product_identifiers'); const bc = ids.find(i => i.model_id === ms[0].model_id && i.identifier_type === 'barcode');
          await st.update('product_identifiers', bc.identifier_id, {{ value_raw: '{EAN}', value_cmp: '{EAN}' }});
          return {{ bcCar: ms[0].display_name, codeCar: ms[1].display_name, code: ms[1].product_code }}; }})()""")
        # 1. share a box photo with a barcode + a caption without codes
        r = page.evaluate(POST, [[['IMG-WA0001.jpg', rear]], 'Look', 'nice one, available'])
        check(r.startswith('opaqueredirect') or '303' in r, f'service worker answers the share with a redirect ({r})')
        page.goto(base + '#/share'); page.wait_for_selector('.sharegrid img')
        check(page.locator('.sharegrid img').count() == 1 and 'kept on this phone only' in page.inner_text('body'), 'shared photo shown, kept on the phone')
        page.get_by_role('button', name='🔍 Do I own this?').click(); page.wait_for_selector('.own-yes', timeout=15000)
        t = page.inner_text('.own-yes')
        check(info['bcCar'] in t and 'same barcode' in t and 'copy owned' in t, f'barcode in the photo finds the car you own ({t[:120]!r})')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/share.png', full_page=True)
        # 2. text-only share with a code (e.g. a listing title)
        page.evaluate(POST, [[], 'Listing', f"Selling {info['code'].lower()} boxed ₹1,200 1:64"])
        page.goto(base + '#/'); page.goto(base + '#/share'); page.wait_for_selector('text=Do I own this?')
        page.get_by_role('button', name='🔍 Do I own this?').click(); page.wait_for_selector('.own-yes, .own-no', timeout=15000)
        t = page.inner_text('#app') if page.locator('#app').count() else page.inner_text('body')
        check(info['codeCar'] in t and 'same code' in t, 'product code in the shared text finds the car')
        # 3. nothing matches → honest answer
        page.evaluate(POST, [[], 'x', 'random die-cast ZZZ99999'])
        page.goto(base + '#/'); page.goto(base + '#/share'); page.wait_for_selector('text=Do I own this?')
        page.get_by_role('button', name='🔍 Do I own this?').click(); page.wait_for_selector('.own-no', timeout=15000)
        t = page.inner_text('.own-no')
        check('Not found by barcode or code' in t and "can't be ruled out" in t, 'no match says it can\'t rule the car out')
        # 4. Add to garage → Import with the shared photos
        page.evaluate(POST, [[['IMG-1.jpg', rear], ['IMG-2.jpg', rear]], '', ''])
        page.goto(base + '#/'); page.goto(base + '#/share'); page.wait_for_selector('.sharegrid img')
        page.get_by_role('button', name='＋ Add to garage').click(); page.wait_for_selector('text=Import from gallery')
        check('2 photos → 1 car' in page.inner_text('body'), 'Add to garage opens Import with the shared photos paired')
        page.goto(base + '#/share'); page.wait_for_selector('text=Nothing shared right now')
        check(True, 'shared items cleared after handing them to Import')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
