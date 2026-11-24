"""Developer test for s1-0.16.0: Settings → Export downloads real files from what is stored on the phone.
Collection list (CSV) and Everything (ZIP of every tab as CSV). Fake Google; NOT a phone test.

Run:  python3 tests/e2e_export.py
"""
import csv, io, os, subprocess, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

N = 25


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    out = '/tmp/smg-export'; os.makedirs(out, exist_ok=True)
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, accept_downloads=True)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + f'({N})')
        # Awkward names: a comma and quotes, a formula-looking name, non-English text
        page.evaluate("""(async () => { const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = await idb.records.byEntity('models'); ms.sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          ms[0].data.display_name = 'Skyline GT-R, "Godzilla"'; ms[1].data.display_name = '=HYPERLINK("x")'; ms[2].data.display_name = 'ポルシェ 911';
          await idb.records.putMany(ms.slice(0, 3)); })()""")
        page.goto(base + '#/settings'); page.wait_for_selector('text=Export')

        with page.expect_download() as d: page.get_by_role('button', name='Collection list (CSV, one row per car)').click()
        f = os.path.join(out, d.value.suggested_filename); d.value.save_as(f)
        raw = open(f, 'rb').read()
        check(d.value.suggested_filename.endswith('.csv'), f'CSV file name ({d.value.suggested_filename})')
        check(raw.startswith(b'\xef\xbb\xbf'), 'CSV starts with the UTF-8 mark (Excel shows ポルシェ correctly)')
        rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
        check(len(rows) == N + 1 and rows[0][0] == 'Name', f'one header + one row per car ({len(rows)} rows)')
        names = [r[0] for r in rows[1:]]
        check('Skyline GT-R, "Godzilla"' in names, 'comma and quotes survive')
        check("'=HYPERLINK(\"x\")" in names, 'formula-looking name is made safe (starts with an apostrophe)')
        check('ポルシェ 911' in names, 'non-English text survives')
        hdr = rows[0]; boxcol = hdr.index('Storage box')
        check(all(r[boxcol].startswith('Box ') for r in rows[1:]), 'every row has its storage box')

        with page.expect_download() as d: page.get_by_role('button', name='Everything (ZIP, every tab as CSV)').click()
        z = os.path.join(out, d.value.suggested_filename); d.value.save_as(z)
        check(d.value.suggested_filename.endswith('.zip'), f'ZIP file name ({d.value.suggested_filename})')
        with zipfile.ZipFile(z) as zf:
            check(zf.testzip() is None, 'ZIP is valid (Python check)')
            inside = zf.namelist()
            check(any(n.upper().startswith('MODELS') for n in inside) and any(n.upper().startswith('INVENTORY') for n in inside), f'ZIP has the tabs ({len(inside)} files)')
            mod = [n for n in inside if n.upper().startswith('MODELS')][0]
            mrows = list(csv.reader(io.StringIO(zf.read(mod).decode('utf-8-sig'))))
            check(len(mrows) == N + 1, f'MODELS tab has every model ({len(mrows) - 1})')
        r = subprocess.run(['unzip', '-t', z], capture_output=True, text=True)
        check(r.returncode == 0, 'system unzip opens it too')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
