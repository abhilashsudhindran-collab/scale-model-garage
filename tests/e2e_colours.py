"""Developer test for s1-0.19.0: colours. Car page swatches + "Gemini said" suggestion, Garage By colour + Use all,
tile dots, Name tab save takes the colour, CSV Colour column. Uses B's real 1st Gemini reply (24 Nov 22:47).
Fake data; NOT a phone test.

Run:  python3 tests/e2e_colours.py
"""
import os, sys, csv, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

RAW = """| Box | Brand | Scale | Car Name | Year | Product Code | Color / Livery | Barcode / UPC |
|---|---|---|---|---|---|---|---|
| Box 1 | MINI GT (TSM Model) | 1:64 | Aston Martin DB10 (007 Spectre) | — | MGT00733 (or similar 007 release; sticker obscured) | Silver | 8 10152 14254 7 (partially blurred) |
| Box 2 | Pop Race | 1:64 | Mazda RX-7 RE-Amemiya | — | PR64-240 | Pink / Dark Blue (RE-Amemiya livery) | PR640240 (internal SKU) |
| Box 3 | Pop Race | 1:64 | Aston Martin Aramco AMR23 | 2023 (AMR23) | PR64-198 | British Racing Green (Aston Martin Aramco F1 Team) | 8 972027 000042 (partially blurred) |
| Box 4 | PARA64 | 1:64 | Cizeta-Moroder V16T (Lights down, LHD) | 1991 | PA-55483 | Rosso Diablo | 0 092999 554839 |
| Box 5 | PARA64 | 1:64 | De Tomaso Pantera (Lights down, LHD) | 1972 | PA-55644 | Red / Black | 0 092999 556446 |"""


def main():
    fails = []
    def check(c, msg):
        print(('PASS ' if c else 'FAIL ') + msg)
        if not c: fails.append(msg)
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, accept_downloads=True)
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(6)')
        ids = page.evaluate("""(raw) => (async () => {
          const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          const ph = await st.list('photos');
          const order = ms.slice(0, 5).flatMap(r => ['box_front', 'box_rear'].map(role => ph.find(p => p.model_id === r.id && p.shot_role === role).photo_id));
          ms[1].data.display_name = ''; await idb.records.putMany([ms[1]]); // car 2 still to name
          await st.create('ai_log', { ai_log_id: 'ai_c1', input_photo_ids: order.join(','), ai_response_raw: raw, prompt_version: 'names-v4', confirmed_values: '{}', processed_at: new Date().toISOString() });
          await idb.meta.set('aiSuggest', { [ms[1].id]: { name: 'Mazda RX-7 RE-Amemiya', code: 'PR64-240', brand: 'Pop Race', colour: 'Pink / Dark Blue (RE-Amemiya livery)', notes: [], logId: 'ai_c1', pv: 5 } });
          return ms.map(r => r.id);
        })()""", RAW)
        fam = lambda mid: page.evaluate(f"(async () => (await (await import('./js/store.js')).get('models', '{mid}')).colour_family || '')()")
        # Car page: Gemini's colour offered, Use it
        page.goto(base + f'#/item/{ids[0]}'); page.wait_for_selector('.colourblock')
        check(page.is_visible('text=Gemini said: Silver'), 'car page offers "Gemini said: Silver"')
        check(page.locator('.swatches .sw').count() == 14, '14 colour swatches')
        page.get_by_role('button', name='Use Silver').click(); page.wait_for_timeout(700)
        check(fam(ids[0]) == 'silver' and page.locator('.sw.on[aria-label="Silver"]').count() == 1, 'Use Silver: saved, swatch shows selected')
        page.locator('.sw[aria-label="Blue"]').click(); page.wait_for_timeout(700)
        check(fam(ids[0]) == 'blue', 'tapping a swatch changes it')
        page.locator('.sw[aria-label="Blue"]').click(); page.wait_for_timeout(700)
        check(fam(ids[0]) == '', 'tapping the selected swatch clears it')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => r.field === 'colour_family').length)()")
        check(log == 3, 'every colour change is logged')
        # Name tab: saving takes the suggested colour
        page.goto(base + '#/name'); page.wait_for_selector('#nameSave')
        page.locator('#nameSave').click(); page.wait_for_timeout(900)
        check(fam(ids[1]) == 'pink', 'Name tab save takes Gemini\'s colour (Pink / Dark Blue → pink)')
        # Garage By colour + Use all
        page.goto(base + '#/'); page.wait_for_selector('.grid .tile'); page.locator('.chip', has_text='By colour').click(); page.wait_for_timeout(700)
        check(page.is_visible('text=Gemini named the colour of 4 cars with no colour yet.'), 'By colour: Use all offered for the 4 others')
        page.locator('.colourall button', has_text='Use all').click(); page.wait_for_timeout(1500)
        fams = [fam(i) for i in ids[:5]]
        check(fams == ['silver', 'pink', 'green', 'red', 'red'], f'Use all: Silver, Pink, British Racing Green → green, Rosso Diablo / Red → red ({fams})')
        heads = page.locator('.grid h3.group').all_inner_texts()
        check(heads[:4] == ['Red · 2', 'Green · 1', 'Pink · 1', 'Silver · 1'] or (heads and heads[0].startswith('Red')), f'grouped by colour, in colour order ({heads[:5]})')
        check(page.locator('.tile .cdot').count() >= 5, 'tiles show a colour dot')
        page.screenshot(path='/tmp/smg-colours.png')
        # CSV
        page.goto(base + '#/settings'); page.wait_for_selector('text=Export')
        with page.expect_download() as dl: page.get_by_role('button', name='Collection list (CSV, one row per car)').click()
        rows = list(csv.reader(io.StringIO(open(dl.value.path(), 'rb').read().decode('utf-8-sig'))))
        ci = rows[0].index('Colour'); vals = sorted(r[ci] for r in rows[1:] if r[ci])
        check('Silver' in vals and any(v.startswith('Green · British Racing Green') for v in vals), f'CSV has a Colour column ({vals[:3]})')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
