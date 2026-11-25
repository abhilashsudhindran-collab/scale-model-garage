"""Developer test for s1-0.17.1: suggestions read by the old reader are read again from AI_LOG with the new one;
"Discard suggestion" frees the car for the next batch. Fake data; NOT a phone test.

Run:  python3 tests/e2e_reread.py
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
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        page.evaluate(SEED + '(2)')
        # Old state, as on B's phone: both cars nameless, old-reader suggestions with the brand as the name
        page.evaluate("""(async () => {
          const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          for (const r of ms) { r.data.display_name = ''; } await idb.records.putMany(ms);
          const ph = await st.list('photos');
          const order = ms.flatMap(r => ['box_front', 'box_rear'].map(role => ph.find(p => p.model_id === r.id && p.shot_role === role).photo_id));
          const raw = 'Box 1 | Kaido House × Mini GT | Nissan Skyline GT-R | Kaido Star Racing V1\\nBox 2 | Mini GT (TSM Model) | Chevrolet Corvette Z06 GT3.R #4 | 2025 IMSA Daytona 24 Hrs';
          const log = await st.create('ai_log', { ai_log_id: 'ai_test1', input_photo_ids: order.join(','), ai_response_raw: raw, prompt_version: 'names-v2' });
          await idb.meta.set('aiSuggest', {
            [ms[0].id]: { name: 'Kaido House × Mini GT', code: '', brand: 'Kaido Star Racing V1', notes: [], logId: 'ai_test1' },
            [ms[1].id]: { name: 'Mini GT (TSM Model)', code: 'Chevrolet Corvette Z06 GT3.R #4', brand: '2025 IMSA Daytona 24 Hrs', notes: [], logId: 'ai_test1' } });
        })()""")
        page.goto(base + '#/name'); page.wait_for_timeout(1500)
        names = page.locator('input[aria-label="Name"]').evaluate_all('els => els.map(e => e.value)')
        name = next((x for x in names if 'Skyline' in x), names[0] if names else '')
        print('   name field:', name)
        check(name == 'Nissan Skyline GT-R Kaido Star Racing V1', 'old wrong suggestion re-read: car name, not the brand')
        sugg = page.evaluate("(async () => (await (await import('./js/idb.js')).meta.get('aiSuggest')))()")
        vals = sorted([(v['name'], v['code'], v['brand'], v.get('pv')) for v in sugg.values()])
        check(all(v[3] == 5 for v in vals) and any(v[0].startswith('Chevrolet Corvette Z06') and v[1] == '' and v[2] == 'Mini GT (TSM Model)' for v in vals), f'second car re-read too ({vals[0][:3]})')
        page.reload(); page.wait_for_timeout(1200)
        check(not page.is_visible('text=read again with the improved reader'), 're-read happens once, not on every visit')
        page.get_by_role('button', name='Discard suggestion').first.click(); page.wait_for_timeout(800)
        left = page.evaluate("(async () => Object.keys((await (await import('./js/idb.js')).meta.get('aiSuggest'))).length)()")
        check(left == 1, 'Discard suggestion removes it for that car only')
        check(page.is_visible('text=Get names for the next 1 boxes'), 'the discarded car can go in the next batch')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
