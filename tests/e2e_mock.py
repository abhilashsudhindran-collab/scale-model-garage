"""Developer test (NOT a phone acceptance test): runs the app in headless Chrome against a FAKE,
in-memory Google Drive/Sheets so the capture → save → sync → duplicate logic can be exercised.
Real acceptance happens only on B's phone with his real Google account.

Run:  python3 tests/e2e_mock.py   (serves the repo on http://localhost:8765)
"""
import hashlib, io, json, re, sys, threading, time, urllib.parse, functools, http.server, socketserver, os
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765

# ---------------- fake Google ----------------
class FakeGoogle:
    def __init__(self):
        self.files = {}      # id -> {name, mimeType, parents, appProperties, md5, size, trashed}
        self.blobs = {}      # id -> bytes (uploaded photo files, for downloads)
        self.sheets = {}     # id -> {tab: [[...]]}
        self.n = 0
        self.calls = []
        self.fail_next_upload_after_store = False
        self.fail_first_header_write = False

    def nid(self, p='f'):
        self.n += 1
        return f'{p}{self.n:05d}'

    @staticmethod
    def a1(rng):
        tab, _, cells = rng.partition('!')
        tab = tab.strip("'")
        m = re.match(r'([A-Z]+)(\d+)?', cells or 'A1')
        row = int(m.group(2)) if m and m.group(2) else 1
        return tab, row

    def handle(self, route, request):
        url = urllib.parse.urlparse(request.url)
        qs = urllib.parse.parse_qs(url.query)
        method = request.method
        path = url.path
        self.calls.append(f'{method} {path}')
        body = request.post_data_buffer
        def ok(obj, status=200):
            route.fulfill(status=status, content_type='application/json', body=json.dumps(obj))

        # ---- Sheets ----
        if url.netloc == 'sheets.googleapis.com':
            m = re.match(r'/v4/spreadsheets/?([^/:]*)(.*)', path)
            sid, rest = m.group(1), m.group(2)
            if method == 'POST' and not sid:
                req = json.loads(body)
                sid = self.nid('s')
                self.sheets[sid] = {s['properties']['title']: [] for s in req['sheets']}
                self.files[sid] = dict(name=req['properties']['title'], mimeType='application/vnd.google-apps.spreadsheet', parents=['root'], appProperties={}, trashed=False)
                return ok({'spreadsheetId': sid, 'sheets': [{'properties': {'title': t}} for t in self.sheets[sid]]})
            book = self.sheets[sid]
            if method == 'GET' and rest == '':
                return ok({'sheets': [{'properties': {'title': t, 'sheetId': i}} for i, t in enumerate(book)]})
            if method == 'POST' and rest == ':batchUpdate':
                for r in json.loads(body)['requests']:
                    book[r['addSheet']['properties']['title']] = []
                return ok({})
            if method == 'GET' and rest == '/values:batchGet':
                out = []
                for rng in qs.get('ranges', []):
                    tab, _ = self.a1(rng)
                    out.append({'range': rng, 'values': [list(r) for r in book.get(tab, [])]})
                return ok({'valueRanges': out})
            if method == 'POST' and rest == '/values:batchUpdate':
                if self.fail_first_header_write:
                    self.fail_first_header_write = False
                    return route.abort('connectionreset')  # simulate setup cut off before headers were written
                for d in json.loads(body)['data']:
                    tab, row = self.a1(d['range'])
                    letters = re.match(r"[^!]*!([A-Z]+)", d['range'])
                    col = 0
                    for ch in (letters.group(1) if letters else 'A'): col = col * 26 + (ord(ch) - 64)
                    col -= 1  # 0-based start column (writes to B5:C5 keep column A intact, like real Sheets)
                    rows = book.setdefault(tab, [])
                    for i, vals in enumerate(d['values']):
                        idx = row - 1 + i
                        while len(rows) <= idx: rows.append([])
                        if col == 0: rows[idx] = list(vals)
                        else:
                            r = list(rows[idx]); r += [''] * max(0, col + len(vals) - len(r)); r[col:col + len(vals)] = list(vals); rows[idx] = r
                return ok({})
            m2 = re.match(r'/values/(.+):append', rest)
            if method == 'POST' and m2:
                tab, _ = self.a1(urllib.parse.unquote(m2.group(1)))
                book.setdefault(tab, []).extend([list(v) for v in json.loads(body)['values']])
                return ok({})
            return ok({'error': 'unhandled sheets ' + rest}, 500)

        # ---- Drive ----
        if url.netloc == 'www.googleapis.com':
            if path == '/upload/drive/v3/files' and method == 'POST':
                ctype = request.headers.get('content-type', '')
                boundary = ctype.split('boundary=')[1].encode()
                parts = body.split(b'--' + boundary)
                meta = json.loads(parts[1].split(b'\r\n\r\n', 1)[1].rsplit(b'\r\n', 1)[0])
                data = parts[2].split(b'\r\n\r\n', 1)[1]
                data = data[:-2] if data.endswith(b'\r\n') else data
                fid = self.nid('d')
                md5 = hashlib.md5(data).hexdigest()
                self.blobs[fid] = data
                self.files[fid] = dict(name=meta['name'], mimeType='image/jpeg', parents=meta.get('parents', []), appProperties=meta.get('appProperties', {}), md5=md5, size=len(data), trashed=False)
                if self.fail_next_upload_after_store:
                    self.fail_next_upload_after_store = False
                    return route.abort('connectionreset')  # simulate a lost reply after the upload happened (R0 F1)
                return ok({'id': fid, 'md5Checksum': md5, 'size': str(len(data))})
            if path == '/drive/v3/files' and method == 'GET':
                q = qs.get('q', [''])[0]
                conds = re.findall(r"key='([^']+)' and value='([^']+)'", q)
                res = []
                for fid, f in self.files.items():
                    if f['trashed']: continue
                    if all(f['appProperties'].get(k) == v for k, v in conds):
                        res.append({'id': fid, 'name': f['name'], 'md5Checksum': f.get('md5'), 'appProperties': f['appProperties'], 'trashed': False})
                return ok({'files': res})
            if path == '/drive/v3/files' and method == 'POST':
                meta = json.loads(body)
                fid = self.nid('F')
                self.files[fid] = dict(name=meta['name'], mimeType=meta.get('mimeType'), parents=meta.get('parents', []), appProperties=meta.get('appProperties', {}), trashed=False)
                return ok({'id': fid, 'name': meta['name']})
            mc = re.match(r'/drive/v3/files/([^/]+)/copy$', path)
            if mc and method == 'POST':
                src = mc.group(1); meta = json.loads(body or b'{}')
                if src not in self.files: return ok({'error': 'not found'}, 404)
                nid = self.nid('c')
                props = dict(self.files[src].get('appProperties', {}))  # worst case: Drive keeps the source's tags
                for k, v in (meta.get('appProperties') or {}).items():
                    if v is None: props.pop(k, None)
                    else: props[k] = v
                self.files[nid] = dict(self.files[src], name=meta.get('name', 'copy'), parents=meta.get('parents', []), appProperties=props, trashed=False)
                if src in self.sheets: self.sheets[nid] = {t: [list(r) for r in rows] for t, rows in self.sheets[src].items()}
                return ok({'id': nid, 'name': self.files[nid]['name']})
            m = re.match(r'/drive/v3/files/([^/]+)$', path)
            if m:
                fid = m.group(1); f = self.files.get(fid)
                if not f: return ok({'error': 'not found'}, 404)
                if method == 'GET' and qs.get('alt', [''])[0] == 'media':
                    return route.fulfill(status=200, content_type='image/jpeg', body=self.blobs.get(fid, b''))
                if method == 'GET':
                    return ok({'id': fid, 'name': f['name'], 'trashed': f['trashed'], 'parents': f['parents'], 'md5Checksum': f.get('md5')})
                if method == 'PATCH':
                    meta = json.loads(body or b'{}')
                    for k, v in (meta.get('appProperties') or {}).items():
                        if v is None: f['appProperties'].pop(k, None)
                        else: f['appProperties'][k] = v
                    if 'trashed' in meta: f['trashed'] = bool(meta['trashed'])
                    if 'name' in meta: f['name'] = meta['name']
                    if 'addParents' in qs: f['parents'] = [qs['addParents'][0]]
                    return ok({'id': fid})
            return ok({'error': 'unhandled drive ' + path}, 500)
        route.continue_()

FAKE_GIS = """
window.google = { accounts: { oauth2: {
  initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'fake-token', expires_in: 3600 }), 10) }),
  revoke: () => {} } } };
"""

def make_jpeg(color, text_seed):
    img = Image.new('RGB', (1200, 1600), color)
    for x in range(0, 1200, 37):
        for y in range(0, 1600, 53):
            img.putpixel((x, y), ((x * text_seed) % 255, (y * 7) % 255, (x + y) % 255))
    b = io.BytesIO(); img.save(b, 'JPEG', quality=90); return b.getvalue()

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)

    httpd = serve()
    fake = FakeGoogle()
    imgs = {k: make_jpeg(c, s) for k, c, s in [('a', (150, 90, 40), 3), ('b', (40, 90, 150), 5), ('c', (90, 150, 40), 7), ('d', (120, 120, 120), 11)]}
    tmp = '/tmp/smg-test'; os.makedirs(tmp, exist_ok=True)
    for k, data in imgs.items():
        open(f'{tmp}/{k}.jpg', 'wb').write(data)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 400, 'height': 860})
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle)
        ctx.route('https://sheets.googleapis.com/**', fake.handle)
        base = f'http://localhost:{PORT}/'
        page.goto(base + '#/')
        page.wait_for_selector('text=My Garage')
        check(page.is_visible('text=Welcome'), 'first run shows welcome banner')

        def pick(selector_text, path):
            with page.expect_file_chooser() as fc:
                page.get_by_text(selector_text, exact=False).first.click()
            fc.value.set_files(path)

        def capture(front, rear, brand, scale, name, code='', barcode='', sealed=False, art=None):
            page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
            pick('Box front', front); page.wait_for_selector('text=Box front ✓')
            pick('Box rear', rear); page.wait_for_selector('text=Box rear ✓')
            if sealed:
                page.get_by_role('button', name='Sealed box', exact=True).click()
                page.wait_for_selector('text=Box art (sealed box)')
                pick('Box art (sealed box)', art); page.wait_for_selector('text=Box art (sealed box) ✓')
            page.wait_for_timeout(250)
            page.select_option('select', label=brand); page.wait_for_timeout(250)
            page.get_by_role('button', name=scale, exact=True).click(); page.wait_for_timeout(250)
            if barcode: page.fill('input[inputmode=numeric]', barcode)
            page.fill('input[placeholder^="e.g. Range Rover"]', name)
            if code: page.locator('input[autocapitalize=characters]').fill(code)
            page.wait_for_timeout(400)

        # 1. Offline-style capture before sign-in (no config yet)
        capture(f'{tmp}/a.jpg', f'{tmp}/b.jpg', 'Mini GT', '1:64', 'Range Rover 1981 Camel Trophy', code='MGT01311-L', barcode='840456393215')
        check(page.is_visible('text=Not in your garage yet'), 'new code shows "not in your garage"')
        page.get_by_role('button', name='Save & next box').click()
        page.wait_for_selector('text=Saved ✓')

        # 2. Same product again → exact duplicate
        capture(f'{tmp}/c.jpg', f'{tmp}/d.jpg', 'Mini GT', '1:64', 'Range Rover again', code='mgt01311-l ')
        check(page.is_visible('text=You already own this'), 'same brand + same code (case/space) → "You already own this"')
        page.get_by_role('button', name='Add as another copy').click()
        page.wait_for_selector('text=Added as another copy')

        # 3. Different brand, same code → possible only; no code → not checkable
        capture(f'{tmp}/a.jpg', f'{tmp}/c.jpg', 'Hot Wheels', '1:64', 'El Segundo Rallye', code='', barcode='027084120134')
        check(not page.is_visible('text=You already own this'), 'no code → never "already own"')
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('text=Saved ✓')

        # 4. Typed barcode typo is caught
        page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
        page.fill('input[inputmode=numeric]', '8140456393215'); page.wait_for_timeout(200)
        check(page.is_visible("text=don't add up"), 'typed barcode with wrong check digit warns')

        # 5. Sealed box with box art
        capture(f'{tmp}/b.jpg', f'{tmp}/d.jpg', 'Pop Race', '1:64', 'Skyline GT-R', code='PR64-0161', barcode='6973027529752', sealed=True, art=f'{tmp}/a.jpg')
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('text=Saved ✓')

        page.goto(base + '#/'); page.wait_for_selector('text=My Garage'); page.wait_for_selector('.tile')
        print('   header:', page.inner_text('main .row'))
        check(page.is_visible('text=3 models · 4 copies'), 'garage counts 3 models, 4 copies')
        check(page.locator('.tile').count() == 3, 'three tiles shown')
        page.fill('input[type=search]', '0027084120134')
        page.wait_for_timeout(200)
        check(page.locator('.tile').count() == 1 and page.is_visible('text=El Segundo Rallye'), 'search by standardised barcode finds UPC-A item')
        page.fill('input[type=search]', '')

        # 6. Sign in + sync (fake Google)
        page.goto(base + '#/settings'); page.wait_for_selector('text=Google account')
        page.fill('input[placeholder^="OAuth Client ID"]', 'test-client.apps.googleusercontent.com')
        fake.fail_first_header_write = True
        page.get_by_role('button', name='Sign in & set up').click()
        page.wait_for_timeout(2500)
        sid0 = next(k for k in fake.sheets)
        check(sum(1 for c in fake.calls if c.endswith('values:batchUpdate')) >= 2, 'header write was cut off once and then resumed (simulated)')
        page.reload(); page.wait_for_selector('text=Google account')  # like the phone reloading the tab
        page.get_by_role('button', name='Sign in & set up').click()
        page.wait_for_selector('text=Synced:', timeout=30000)
        check(len([k for k in fake.sheets if not fake.files[k]['appProperties'].get('smgBackup')]) == 1, 'retry reuses the same sheet (no second workbook; backup copies not counted)')
        check(len(fake.sheets[sid0]['SETTINGS']) == 7, 'retry finishes SETTINGS rows')
        check(len([f for f in fake.files.values() if f.get('name') == 'SCALE GARAGE']) == 1, 'retry reuses the same SCALE GARAGE folder')
        msg = page.inner_text('#syncMsg')
        print('   sync message:', msg)
        sid = next(k for k in fake.sheets)
        book = fake.sheets[sid]
        check(len(book['MODELS']) == 1 + 3, f"MODELS has header + 3 rows (got {len(book['MODELS'])})")
        check(len(book['INVENTORY']) == 1 + 4, f"INVENTORY has header + 4 rows (got {len(book['INVENTORY'])})")
        check(len(book['PHOTOS']) == 1 + 9, f"PHOTOS has header + 9 rows (got {len(book['PHOTOS'])})")
        check(len(book['PRODUCT_IDENTIFIERS']) == 1 + 3, f"PRODUCT_IDENTIFIERS header + 3 (got {len(book['PRODUCT_IDENTIFIERS'])})")
        check(len(book['BRANDS']) == 1 + 13, 'BRANDS seeded with 13 brands')
        imgs_up = [f for f in fake.files.values() if f.get('md5')]
        check(len(imgs_up) == 27, f'27 photo files uploaded (9 photos × 3) (got {len(imgs_up)})')
        hdr = book['MODELS'][0]; row = book['MODELS'][1]
        rec = dict(zip(hdr, row))
        check(rec['product_code'] in ('MGT01311-L', '') and rec['version'] in ('1', 1), 'model row written RAW with version 1')
        codes = [dict(zip(hdr, r))['product_code'] for r in book['MODELS'][1:]]
        check('MGT01311-L' in codes, 'exact code preserved in sheet')
        ph_hdr = book['PHOTOS'][0]
        check(all(dict(zip(ph_hdr, r))['original_file_id'] for r in book['PHOTOS'][1:]), 'every photo row has a Drive file id')
        check(page.is_visible('text=All synced') or 'All synced' in page.inner_text('#status'), 'status shows All synced')

        # 7. Second sync: nothing duplicated (idempotent)
        page.get_by_role('button', name='Sync now').last.click()
        page.wait_for_timeout(1500)
        check(len(book['MODELS']) == 4 and len(book['PHOTOS']) == 10, 'second sync adds no duplicate rows')
        check(len([f for f in fake.files.values() if f.get('md5')]) == 27, 'second sync uploads no duplicate files')

        # 8. Lost upload reply (F1) → reuse existing file, no duplicate
        capture(f'{tmp}/c.jpg', f'{tmp}/b.jpg', 'Tomica', '1:64', 'Test F1', code='F1-TEST')
        page.get_by_role('button', name='Save & next box').click(); page.wait_for_selector('text=Saved ✓')
        fake.fail_next_upload_after_store = True
        page.goto(base + '#/settings'); page.get_by_role('button', name='Sync now').last.click()
        page.wait_for_timeout(2500)
        page.get_by_role('button', name='Sync now').last.click()
        page.wait_for_timeout(2500)
        names = [f['name'] for f in fake.files.values() if f.get('md5')]
        check(len(names) == len(set(names)), f'no duplicate Drive files after lost reply ({len(names)} files)')
        check(len(book['MODELS']) == 5, f"F1 item synced once (MODELS rows {len(book['MODELS'])})")

        # 9. Edit on "another device" (sheet) + local edit of a different field → merged; same field → clash
        hdr = book['MODELS'][0]
        r1 = book['MODELS'][1]
        mid = r1[hdr.index('model_id')]
        r1[hdr.index('notes')] = 'edited on laptop'; r1[hdr.index('version')] = '2'
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('text=Product')
        page.locator('input').nth(1).fill('Renamed on phone') if False else None
        name_input = page.locator('.card input').first
        name_input.fill('Renamed on phone')
        page.get_by_role('button', name='Save', exact=True).click(); page.wait_for_timeout(300)
        page.goto(base + '#/settings'); page.get_by_role('button', name='Sync now').last.click(); page.wait_for_timeout(2000)
        row = dict(zip(hdr, book['MODELS'][1]))
        check(row['display_name'] == 'Renamed on phone' and row['notes'] == 'edited on laptop', 'different fields changed on two devices → merged')
        # same-field clash (wait for any pending auto-sync to finish first, so the laptop edit isn't simply pulled)
        page.wait_for_timeout(3500)
        row = dict(zip(hdr, book['MODELS'][1]))
        book['MODELS'][1][hdr.index('display_name')] = 'Laptop name'; book['MODELS'][1][hdr.index('version')] = str(int(row['version']) + 1)
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('text=Product')
        page.locator('.card input').first.fill('Phone name')
        page.get_by_role('button', name='Save', exact=True).click(); page.wait_for_timeout(300)
        page.goto(base + '#/settings'); page.get_by_role('button', name='Sync now').last.click(); page.wait_for_timeout(2000)
        row = dict(zip(hdr, book['MODELS'][1]))
        check(row['display_name'] == 'Laptop name', 'same field clash → sheet not overwritten silently')
        page.goto(base + f'#/item/{mid}'); page.wait_for_selector('text=Changed on another device')
        check(True, 'clash shown to the user for a decision')
        page.get_by_role('button', name='This phone: Phone name').click(); page.wait_for_timeout(300)
        page.goto(base + '#/settings'); page.get_by_role('button', name='Sync now').last.click(); page.wait_for_timeout(2000)
        row = dict(zip(hdr, book['MODELS'][1]))
        check(row['display_name'] == 'Phone name', 'after B picks, the chosen value is written')

        # 10. Reload: data persists locally
        page.goto(base + '#/'); page.reload(); page.wait_for_selector('text=My Garage')
        check(page.locator('.tile').count() == 4, 'after reload, 4 models still on the phone')
        check(not [e for e in errors if 'favicon' not in e and 'ERR_CONNECTION_RESET' not in e], f'no page errors ({errors[:3]})')
        page.screenshot(path='/tmp/smg-test/garage.png', full_page=True)
        page.goto(base + '#/add'); page.wait_for_selector('text=Quick capture')
        page.screenshot(path='/tmp/smg-test/add.png', full_page=True)
        browser.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
