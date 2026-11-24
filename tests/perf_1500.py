"""Speed check with a big collection (not a pass/fail test): 1,500 cars, 3,000 photos, 15 storage boxes seeded on the
phone, then timings for the main screens and a sync. Fake Google from e2e_mock.py. Prints a table.

Run:  python3 tests/perf_1500.py [N]
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
from playwright.sync_api import sync_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 1500
SEED = """(async (N) => {
  const st = await import('./js/store.js'); const idb = await import('./js/idb.js'); const ids = await import('./js/ids.js');
  const br = await st.list('brands'), sc = await st.list('scales');
  const B = ['Hot Wheels', 'Mini GT', 'Tarmac Works', 'Bburago', 'Inno64', 'Pop Race'].map(n => br.find(b => b.name === n).brand_id);
  const S = ['1:64', '1:64', '1:64', '1:43', '1:18'].map(l => sc.find(s => s.label === l).scale_id);
  const c = document.createElement('canvas'); c.width = 120; c.height = 150; const x = c.getContext('2d');
  const thumbs = [];
  for (let k = 0; k < 12; k++) { x.fillStyle = `hsl(${k * 30},50%,55%)`; x.fillRect(0, 0, 120, 150); x.fillStyle = '#fff'; x.fillRect(20, 60, 80, 30); thumbs.push(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.7))); }
  const now = Date.now(), recs = [], blobs = [];
  const mk = (entity, data) => { const idCol = { models: 'model_id', inventory: 'inventory_id', photos: 'photo_id', product_identifiers: 'identifier_id' }[entity];
    const d = { ...st.blank(entity), ...data, created_at: new Date(now - (N - recs.length) * 1000).toISOString(), updated_at: new Date(now).toISOString(), version: 1, deleted_at: '', device_id: 'perf' };
    recs.push({ key: `${entity}:${d[idCol]}`, entity, id: d[idCol], data: d, dirty: 0, sync: { base: { ...d } } }); return d; };
  const words = ['Nissan Skyline', 'Toyota Supra', 'Honda NSX', 'Porsche 911', 'Ferrari 499P', 'Mazda RX-7', 'BMW M3', 'Lamborghini Countach', 'Ford GT', 'Mercedes AMG GT'];
  for (let i = 0; i < N; i++) {
    const md = mk('models', { model_id: ids.newId('models'), brand_id: B[i % B.length], scale_id: S[i % S.length], display_name: i % 10 === 9 ? '' : `${words[i % 10]} #${i}`, product_code: `MGT${String(i).padStart(5, '0')}-L`, namespace_status: 'confirmed', completeness_status: 'quick' });
    mk('inventory', { inventory_id: ids.newId('inventory'), model_id: md.model_id, ownership_status: 'Owned', storage_location: `Box ${1 + (i % 15)}`, packaging_state: i % 3 ? 'opened' : 'sealed' });
    mk('product_identifiers', { identifier_id: ids.newId('product_identifiers'), model_id: md.model_id, identifier_type: 'barcode', value_raw: String(4006381000000 + i), value_cmp: String(4006381000000 + i) });
    for (const role of ['box_front', 'box_rear']) {
      const ph = mk('photos', { photo_id: ids.newId('photos'), model_id: md.model_id, shot_role: role, photo_type: 'packaging', original_file_id: 'f_o' + i + role, display_file_id: 'f_d' + i + role, thumb_file_id: 'f_t' + i + role, is_primary: role === 'box_front' ? 'yes' : 'no' });
      if (role === 'box_front') md.primary_photo_id = ph.photo_id;
      blobs.push([`${ph.photo_id}:thumb`, thumbs[i % 12]]);
    }
  }
  await idb.records.putMany(recs);
  for (const [k, b] of blobs) await idb.blobs.put(k, b);
  return recs.length;
})"""


def main():
    httpd = m.serve(); fake = m.FakeGoogle(); base = f'http://localhost:{m.PORT}/'
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860})
        ctx.route('https://accounts.google.com/gsi/client', lambda r, q: r.fulfill(content_type='text/javascript', body=m.FAKE_GIS))
        ctx.route('https://www.googleapis.com/**', fake.handle); ctx.route('https://sheets.googleapis.com/**', fake.handle)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)));
        page.goto(base + '#/settings'); page.wait_for_selector('text=Settings')
        t = time.time(); n = page.evaluate(SEED, N); rows.append(('seed records', f'{n}', time.time() - t))
        def timed(label, fn):
            t0 = time.time(); fn(); rows.append((label, '', time.time() - t0))
        timed('Garage (home) open', lambda: (page.goto(base + '#/'), page.wait_for_selector('.tile')))
        def type_search():
            page.fill('input[type=search]', '')
            t0 = time.time(); page.fill('input[type=search]', 'skyline'); page.wait_for_function("document.querySelectorAll('.tile').length > 0 && document.querySelectorAll('.tile').length < 300")
            rows.append(('search "skyline"', '', time.time() - t0))
        type_search()
        page.fill('input[type=search]', '')
        timed('By box grouping', lambda: (page.get_by_role('button', name='By box', exact=True).click(), page.wait_for_selector('h3.group')))
        timed('open Box 7 (shelf tap)', lambda: (page.locator('.shelfhome .boxtile', has_text='Box 7').first.click(), page.wait_for_selector('.boxcard')))
        page.locator('.boxcard').get_by_role('button', name='Close').click(); page.get_by_role('button', name='All', exact=True).click()
        timed('Dashboard open', lambda: (page.goto(base + '#/dash'), page.wait_for_selector('.card.hero')))
        mid = page.evaluate("(async () => (await (await import('./js/store.js')).list('models'))[Math.floor((await (await import('./js/store.js')).list('models')).length / 2)].model_id)()")
        timed('car page open', lambda: (page.goto(base + f'#/item/{mid}'), page.wait_for_selector('.pdp-head')))
        timed('Name tab open', lambda: (page.goto(base + '#/name'), page.wait_for_selector('text=Name them')))
        timed('Photo run open', lambda: (page.goto(base + '#/run'), page.wait_for_selector('text=Photo run')))
        # Sync: first one pushes all rows to the (empty) fake sheet; second has nothing to do; third after one edit
        page.evaluate("localStorage.setItem('smg.clientId', 'test-client.apps.googleusercontent.com')")
        page.evaluate("(async () => { const idb = await import('./js/idb.js'); const all = await idb.records.byEntity('models'); for (const e of ['models','inventory','photos','product_identifiers']) { const rs = await idb.records.byEntity(e); for (const r of rs) { r.dirty = 1; r.sync = { base: null }; } await idb.records.putMany(rs); } })()")
        def sync():
            page.goto(base + '#/'); page.wait_for_selector('#status'); t0 = time.time(); page.click('#status')
            for _ in range(1500):
                if page.inner_text('#status') == 'All synced': break
                page.wait_for_timeout(200)
            return time.time() - t0
        x = sync(); rows.append(('sync: first upload of all rows', '', x))
        x = sync(); rows.append(('sync: nothing to do', '', x))
        page.evaluate(f"(async () => {{ const st = await import('./js/store.js'); await st.update('models', '{mid}', {{ display_name: 'Edited' }}); }})()")
        rows.append(('sync: after one edit', '', sync()))
        heap = page.evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1")
        rows.append(('JS memory (MB)', f'{heap}', 0))
        b.close()
    httpd.shutdown()
    print(f'\n{N} cars · timings (fake Google, desktop CPU; a phone is roughly 3-5x slower)')
    for label, extra, t in rows: print(f'{label:34s} {extra:>8s} {t:7.2f} s' if t else f'{label:34s} {extra:>8s}')
    if errors: print('PAGE ERRORS', errors[:3])


if __name__ == '__main__':
    main()
