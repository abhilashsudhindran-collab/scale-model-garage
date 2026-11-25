"""Developer test for s1-0.22.0: merge two entries into one car (copies + photos move; missing fields filled;
the emptied entry archived, not deleted; only by B's tap). Fake data; NOT a phone test.

Run:  python3 tests/e2e_merge.py
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
    httpd = m.serve(); base = f'http://localhost:{m.PORT}/'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda dl: dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(4)')
        a, bb = page.evaluate("""(async () => {
          const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((x, y) => x.data.created_at.localeCompare(y.data.created_at));
          const [A, B] = [ms[0], ms[1]];
          A.data.display_name = "'65 Ford Galaxie (Red/Gold, #65)"; A.data.product_code = ''; A.data.product_code_cmp = ''; A.data.colour_family = '';
          B.data.display_name = "'65 Ford Galaxie (Red/Gold, #65)"; B.data.product_code = 'JKY29'; B.data.product_code_cmp = 'JKY29'; B.data.colour_family = 'red'; B.data.colour_name = 'Red/Gold';
          B.data.brand_id = A.data.brand_id;
          await idb.records.putMany([A, B]);
          const inv = await st.list('inventory'); const ib = inv.find(i => i.model_id === B.id); await st.update('inventory', ib.inventory_id, { storage_location: 'Box 2' });
          const ia = inv.find(i => i.model_id === A.id); await st.update('inventory', ia.inventory_id, { storage_location: 'Box 1' });
          // drop barcodes so only the name matches (the hard case: no barcode, no code on one of them)
          for (const i of await st.list('product_identifiers')) if (i.model_id === A.id || i.model_id === B.id) await st.archive('product_identifiers', i.identifier_id);
          return [A.id, B.id]; })()""")
        page.goto(base + f'#/item/{bb}'); page.wait_for_selector('.pdp-head')
        check(page.locator('.samecar').count() == 1 and 'same name' in page.inner_text('.samecar'), 'car page: "Looks like the same car as …" banner (same name)')
        page.get_by_role('button', name='Compare & merge').click(); page.wait_for_selector('#mergePanel')
        rows = page.locator('.mergerow').all_inner_texts()
        check(len(rows) >= 1 and rows[0].startswith("'65 Ford Galaxie"), f'merge panel lists the likely match first ({rows[:1]})')
        page.locator('.mergerow').first.click(); page.wait_for_timeout(1500)
        check(page.url.endswith(f'#/item/{a}'), 'after merging: opens the kept entry')
        st = page.evaluate(f"""(async () => {{ const st = await import('./js/store.js');
          const inv = (await st.list('inventory')).filter(i => i.model_id === '{a}').map(i => i.storage_location).sort();
          const ph = (await st.list('photos')).filter(p => p.model_id === '{a}').length;
          const A = await st.get('models', '{a}'); const B = (await st.list('models', {{ includeDeleted: true }})).find(x => x.model_id === '{bb}');
          const log = (await st.list('change_log')).filter(r => /merged/.test(r.reason)).length;
          return {{ inv, ph, code: A.product_code, colour: A.colour_family, bDeleted: !!B.deleted_at, bNotes: B.notes, log }}; }})()""")
        check(st['inv'] == ['Box 1', 'Box 2'], f'both copies now on the kept entry, each still in its own box ({st["inv"]})')
        check(st['ph'] == 4, f'photos moved too (4; got {st["ph"]})')
        check(st['code'] == 'JKY29' and st['colour'] == 'red', 'missing code and colour filled in from the merged entry')
        check(st['bDeleted'] and 'Merged into' in st['bNotes'], 'emptied entry archived (not deleted), with a note')
        check(st['log'] == 4, f'every move logged: 1 copy + 2 photos + the merge ({st["log"]})')
        check(page.inner_text('.copyhead h3') == '2 copies', 'kept entry shows "2 copies"')
        check(page.locator('.samecar').count() == 0, 'no more "same car" banner after merging')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
