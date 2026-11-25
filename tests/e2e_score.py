"""Developer test for s1-0.18.0: "How Gemini did" on the Name tab, from AI_LOG read with today's reader.
Uses B's real 2nd Gemini reply (24 Nov 23:01). Fake data; NOT a phone test.

Run:  python3 tests/e2e_score.py
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

RAW = """| Item | Brand / Series | Car Name / Team | Scale / Set No. | Product Code |
|---|---|---|---|---|
| Box 1 | Hot Wheels Silver Series — Vintage Club 1968 | Custom '70 Honda N600 (Orange, Motul #2) | 1:64 (2/5) | HRT81 |
| Box 2 | Hot Wheels Silver Series — Vintage Club 1968 | '65 Ford Galaxie (Red/Gold, #65) | 1:64 (4/5) | HRT81 |
| Box 3 | Hot Wheels Premium — Formula 1 (2025) | Aston Martin Aramco Formula One Team (#18) | 1:64 | JKD87 (Asst. HRV11) |
| Box 4 | Hot Wheels Premium — Formula 1 (2025) | Oracle Red Bull Racing (#1) | 1:64 | JKD83 (Asst. HRV11) |
| Box 5 | WERK83 | Ferrari 250 Testa Rossa (#6) | 1:18 | W1800902 |"""
# What B saved (his report, 25 Nov 09:58): all right except the two Hot Wheels codes he typed himself
SAVED = [("Custom '70 Honda N600 (Orange, Motul #2)", 'JKY27'), ("'65 Ford Galaxie (Red/Gold, #65)", 'JKY29'),
         ('Aston Martin Aramco Formula One Team (#18)', 'JKD87'), ('Oracle Red Bull Racing (#1)', 'JKD83'), ('Ferrari 250 Testa Rossa (#6)', 'W1800902')]


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
        page.evaluate(SEED + '(6)')
        page.evaluate("""([raw, saved]) => (async () => {
          const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          const ph = await st.list('photos'); const conf = {};
          const order = ms.slice(0, 5).flatMap(r => ['box_front', 'box_rear'].map(role => ph.find(p => p.model_id === r.id && p.shot_role === role).photo_id));
          ms.slice(0, 5).forEach((r, i) => { r.data.display_name = saved[i][0]; r.data.product_code = saved[i][1]; conf[r.id] = { name: saved[i][0], code: saved[i][1] }; });
          ms[5].data.display_name = ''; // one car still to name, so the Name tab shows its form
          await idb.records.putMany(ms);
          await st.create('ai_log', { ai_log_id: 'ai_s1', input_photo_ids: order.join(','), ai_response_raw: raw, prompt_version: 'names-v5', confirmed_values: JSON.stringify(conf), processed_at: new Date().toISOString() });
        })()""", [RAW, SAVED])
        page.goto(base + '#/name'); page.wait_for_selector('.gscore', timeout=8000)
        summ = page.inner_text('.gscore summary'); print('   ', summ)
        check(summ == 'How Gemini did · 3 of 5 right as suggested', 'summary: 3 of 5 right (both Hot Wheels needed a code)')
        page.locator('.gscore summary').click(); page.wait_for_timeout(300)
        txt = page.inner_text('.gscore')
        check('✅ 3' in txt and '✏️ 2' in txt and '❌ 0' in txt, 'right 3 · small fixes 2 · rewritten 0')
        check('Codes right: 3 of 5' in txt, 'codes right 3 of 5')
        page.screenshot(path='/tmp/smg-score.png', full_page=False)
        page.locator('.gscore').scroll_into_view_if_needed(); page.screenshot(path='/tmp/smg-score.png')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
