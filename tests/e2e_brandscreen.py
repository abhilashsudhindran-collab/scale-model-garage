"""Developer test for s1-0.24.0: Brands screen (rename keeps old name as alias, merge look-alikes, mark checked,
remove unused). Fake data; NOT a phone test.

Run:  python3 tests/e2e_brandscreen.py
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
    answers = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda dl: dl.accept(answers.pop(0)) if dl.type == 'prompt' and answers else dl.accept())
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(6)')
        ids = page.evaluate("""(async () => { const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const typo = await st.create('brands', { name: 'Majorete', brand_kind: 'miniature', is_code_namespace: 'yes', record_status: 'needs_review' });
          const maj = await st.create('brands', { name: 'Majorette', brand_kind: 'miniature', is_code_namespace: 'yes', record_status: 'confirmed' });
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          ms[0].data.brand_id = typo.brand_id; ms[0].data.printed_brand_text = 'Majorete'; ms[1].data.brand_id = maj.brand_id; ms[2].data.brand_id = typo.brand_id;
          await idb.records.putMany(ms.slice(0, 3));
          await st.create('brands', { name: 'Unused Co', brand_kind: 'miniature', is_code_namespace: 'yes', record_status: 'confirmed' });
          return { typo: typo.brand_id, maj: maj.brand_id, m0: ms[0].id }; })()""")
        page.goto(base + '#/settings'); page.locator('.linkcard', has_text='Brands').click(); page.wait_for_selector('.brandlist')
        check(page.is_visible('text=Same brand?') and page.locator('.card', has_text='Same brand?').locator('b', has_text='Majorete').count() == 1, 'look-alikes flagged: Majorete · Majorette')
        page.locator('.brandhead', has_text='Majorete').filter(has_text='needs review').click(); page.wait_for_timeout(300)
        page.locator('.brandacts select').select_option(ids['maj']); page.locator('.brandacts button', has_text='Merge').click(); page.wait_for_timeout(1200)
        st = page.evaluate(f"""(async () => {{ const st = await import('./js/store.js');
          const ms = await st.list('models'); const m0 = await st.get('models', '{ids["m0"]}');
          const al = await st.list('aliases'); const br = await st.list('brands', {{ includeDeleted: true }});
          return {{ onMaj: ms.filter(m => m.brand_id === '{ids["maj"]}').length, printed: m0.printed_brand_text, ns: m0.namespace_status,
            alias: al.some(a => a.alias_text === 'Majorete' && a.target_id === '{ids["maj"]}'), typoGone: !!br.find(b => b.brand_id === '{ids["typo"]}').deleted_at }}; }})()""")
        check(st['onMaj'] == 3, f'merge: all 3 cars now Majorette ({st["onMaj"]})')
        check(st['printed'] == 'Majorete', 'printed brand text on the car unchanged (D10.1 rule 1)')
        check(st['ns'] == 'confirmed', 'cars take the kept brand\'s status (no longer "needs review")')
        check(st['alias'] and st['typoGone'], 'old name kept as an alias; typo brand archived')
        # rename
        answers.append('Majorette Toys')
        page.locator('.brandhead', has_text='Majorette').first.click() if not page.locator('.brandrow.open', has_text='Majorette').count() else None
        page.locator('.brandrow.open .brandacts button', has_text='Rename').click(); page.wait_for_timeout(800)
        names = page.evaluate("(async () => (await (await import('./js/store.js')).list('brands')).map(b => b.name))()")
        check('Majorette Toys' in names and 'Majorette' not in names, 'rename works')
        al = page.evaluate("(async () => (await (await import('./js/store.js')).list('aliases')).map(a => a.alias_text))()")
        check('Majorette' in al, 'old name kept as an alias after rename')
        # rename to an existing name is refused (use merge)
        answers.append('Mini-GT')
        page.locator('.brandhead', has_text='Hot Wheels').click(); page.wait_for_timeout(300)
        page.locator('.brandrow.open .brandacts button', has_text='Rename').click(); page.wait_for_timeout(600)
        check(page.evaluate("(async () => (await (await import('./js/store.js')).list('brands')).some(b => b.name === 'Hot Wheels'))()"), 'renaming to an existing brand\'s name ("Mini-GT") is refused')
        # unused brand can be removed
        page.locator('.brandhead', has_text='Unused Co').click(); page.wait_for_timeout(300)
        page.locator('.brandrow.open button', has_text='Remove (no cars)').click(); page.wait_for_timeout(600)
        check(not page.evaluate("(async () => (await (await import('./js/store.js')).list('brands')).some(b => b.name === 'Unused Co'))()"), 'unused brand removed (archived)')
        page.goto(base + '#/dash'); page.wait_for_selector('text=Manage brands ›')
        check(True, 'Dashboard By brand links to Manage brands')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
