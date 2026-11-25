"""Developer test for s1-0.20.0: car notes. Notes & colours batch for named cars (paste side), car page note
with Keep / Edit / Hide, "from Gemini, not checked", Name tab save keeps the note. Fake data; NOT a phone test.

Run:  python3 tests/e2e_notes.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from perf_1500 import SEED
from playwright.sync_api import sync_playwright

ANSWER = """| Box | Car name | Year | Product code | Brand | Colour | Note |
|---|---|---|---|---|---|---|
| Box 1 | Aston Martin DB10 (007 Spectre) | 2015 | - | Mini GT | Silver | Pop culture: Built only for the James Bond film Spectre; never sold to the public. |
| Box 2 | McLaren F1 GTR 1995 Presentation | 1995 | MGT00988 | Mini GT | Orange | History: The F1 GTR won Le Mans at its first attempt in 1995. |
| Box 3 | Toyota Supra VeilSide Combat V-II | 1990s | MGT00999 | Mini GT | Red | - |"""


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
        page.evaluate(SEED + '(3)')
        ids = page.evaluate("""(async () => {
          const st = await import('./js/store.js'); const idb = await import('./js/idb.js');
          const ms = (await idb.records.byEntity('models')).sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
          const ph = await st.list('photos');
          const order = ms.flatMap(r => ['box_front', 'box_rear'].map(role => ph.find(p => p.model_id === r.id && p.shot_role === role).photo_id));
          await st.create('ai_log', { ai_log_id: 'ai_x1', input_photo_ids: order.join(','), prompt_version: 'names-v7', processed_at: new Date().toISOString() });
          await idb.meta.set('aiBatch', { logId: 'ai_x1', ids: ms.map(r => r.id), mode: 'extras' });
          return ms.map(r => r.id);
        })()""")
        page.goto(base + '#/name'); page.wait_for_selector('textarea[aria-label="AI answer"]')
        check(page.is_visible('text=Notes & colours from Gemini'), 'all cars named: the waiting Notes & colours batch still shows its paste box')
        page.fill('textarea[aria-label="AI answer"]', ANSWER); page.get_by_role('button', name='Use this answer').click(); page.wait_for_timeout(1000)
        names = page.evaluate("(async () => (await (await import('./js/store.js')).list('models')).map(m => m.display_name))()")
        check(all(names), 'named cars keep their names (extras batch never renames)')
        # Car 1: note shown, labelled, Keep
        page.goto(base + f'#/item/{ids[0]}'); page.wait_for_selector('.carnote')
        check('Pop culture' in page.inner_text('.carnote .cn-tag') and 'James Bond' in page.inner_text('.carnote .cn-body'), 'car page shows the note under the name, tagged Pop culture')
        check(page.is_visible('text=from Gemini, not checked'), 'labelled "from Gemini, not checked"')
        stored = lambda i: page.evaluate(f"(async () => {{ const m = await (await import('./js/store.js')).get('models', '{i}'); return [m.car_note || '', m.car_note_source || '']; }})()")
        check(stored(ids[0]) == ['', ''], 'nothing saved until B acts')
        page.screenshot(path='/tmp/smg-note.png')
        page.locator('.carnote').get_by_role('button', name='Keep').click(); page.wait_for_timeout(700)
        check(stored(ids[0])[1] == 'gemini' and page.locator('.carnote').get_by_role('button', name='Keep').count() == 0, "Keep saves it (still labelled as Gemini's)")
        # Car 2: Edit makes it B's own
        answers.append('History: Won Le Mans 1995 overall, first time out.')
        page.goto(base + f'#/item/{ids[1]}'); page.wait_for_selector('.carnote')
        page.locator('.carnote').get_by_role('button', name='Edit').click(); page.wait_for_timeout(700)
        check(stored(ids[1]) == ['History: Won Le Mans 1995 overall, first time out.', 'you'] and not page.is_visible('text=from Gemini, not checked'), "Edit: B's own note, no Gemini label")
        page.locator('.carnote').get_by_role('button', name='Hide').click(); page.wait_for_timeout(700)
        check(stored(ids[1])[1] == 'hidden' and page.locator('.carnote').count() == 0 and page.is_visible('text=＋ Add a note'), 'Hide: note gone, ＋ Add a note offered')
        # Car 3: Gemini gave no note → Add a note
        page.goto(base + f'#/item/{ids[2]}'); page.wait_for_selector('.addnote')
        answers.append("Casting: Mini GT's VeilSide Supra has a separate rear wing piece.")
        page.locator('.addnote').click(); page.wait_for_timeout(700)
        check(stored(ids[2])[1] == 'you' and 'Casting' in page.inner_text('.carnote .cn-tag'), "＋ Add a note: B's own note, tagged Casting")
        # Colours from the same reply
        page.goto(base + '#/'); page.locator('.chip', has_text='By colour').click(); page.wait_for_timeout(700)
        check(page.is_visible('text=Gemini named the colour of 3 cars with no colour yet.'), 'colours from the same reply offered in By colour')
        log = page.evaluate("(async () => (await (await import('./js/store.js')).list('change_log')).filter(r => r.field === 'car_note').length)()")
        check(log == 4, 'every note change logged (keep, edit, hide, add)')
        check(not errors, f'no page errors {errors[:2]}')
        b.close()
    httpd.shutdown()
    print('\nALL PASS' if not fails else f'\n{len(fails)} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
