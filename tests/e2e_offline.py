"""Developer test: the app opens with no network once loaded (service worker). Added after s1-0.9.0 shipped an
empty sw.js. NOT a phone test.   Run:  python3 tests/e2e_offline.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_mock as m
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
        page = ctx.new_page()
        page.goto(base + '#/'); page.wait_for_selector('text=My Garage')
        ready = False
        for _ in range(100):
            if page.evaluate("navigator.serviceWorker.controller !== null || (async () => !!(await navigator.serviceWorker.getRegistration())?.active)()"): ready = True; break
            page.wait_for_timeout(100)
        check(ready, 'service worker active')
        page.reload(); page.wait_for_selector('text=My Garage')
        check(page.evaluate('navigator.serviceWorker.controller !== null'), 'page controlled by the service worker')
        n = page.evaluate("(async () => { const ks = await caches.keys(); let t = 0; for (const k of ks.filter(k => k.startsWith('smg-'))) t += (await (await caches.open(k)).keys()).length; return t; })()")
        check(n >= 20, f'app files cached ({n})')
        ctx.set_offline(True)
        page.reload(); page.wait_for_selector('text=My Garage', timeout=8000)
        check(page.is_visible('nav.bottom'), 'offline: app opens after a reload')
        page.goto(base + '#/dash'); page.wait_for_timeout(500)
        check(page.is_visible('text=Dashboard'), 'offline: Dashboard opens')
        b.close()
    httpd.shutdown()
    print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}"); sys.exit(1 if fails else 0)

if __name__ == '__main__': main()
