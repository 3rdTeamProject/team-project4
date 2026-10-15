"""Browser checks against an isolated static server; never touches account data."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1] / 'public'
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/garden/'
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        for width in (360, 390, 430):
            context = browser.new_context(viewport={'width': width, 'height': 800},
                                          permissions=['geolocation'], geolocation={'latitude': 37.5, 'longitude': 127.0})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(url, wait_until='domcontentloaded')
            page.evaluate("window.GARDEN_STORAGE_KEY='isolated-test';window.GARDEN_VIEW='farms'")
            page.add_script_tag(url=url + 'app.js')
            page.add_script_tag(url=url + 'features.js')
            page.evaluate("navigate('add')")
            page.locator('#farm-name').fill('우리 농장')
            page.locator('[data-feature="farm-location"]').click()
            page.wait_for_function('farmFormLocation !== null')
            page.locator('[form="farm-form"]').click()
            assert page.evaluate('current().weatherLocation.latitude') == 37.5
            page.evaluate("pendingPlot=0;navigate('select')")
            assert page.locator('.selection-art svg').count() == 7
            page.locator('[data-feature="prepare"]').click()
            page.locator('[data-feature="plant"]').click()
            assert page.evaluate('view') == 'garden'
            assert page.locator('.crop-instance svg').count() > 0
            page.evaluate("current().plots[0]={kind:'cucumber',stage:1,method:'seedling',plantedAt:day()};plotIndex=0;navigate('detail')")
            assert page.evaluate('current().plots[0].stage') == 3
            assert page.locator('[data-action="grow"]').count() == 0
            page.locator('[data-feature="check"]').first.click()
            assert page.locator('.check-box.checked').count() == 1
            for view in ('detail', 'add', 'select', 'prepare', 'tasks'):
                page.evaluate('(next)=>navigate(next)', view)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, view)
                if page.locator('.footer').count():
                    assert page.locator('.footer').evaluate('(el)=>getComputedStyle(el).backgroundColor') == page.locator('.phone-shell').evaluate('(el)=>getComputedStyle(el).backgroundColor')
            page.evaluate("navigate('detail')")
            if width == 390:
                page.evaluate("navigate('select')")
                page.wait_for_timeout(500)
                assert page.locator('.selection-art').first.evaluate('(el)=>el.querySelector("svg").getBoundingClientRect().height <= el.getBoundingClientRect().height')
                page.screenshot(path=str(Path(__file__).resolve().parents[2] / 'crop-original-review.png'), full_page=True)
            assert not errors, errors
            print(f'{width}px: location, layout, checklist and growth OK')
            context.close()
        browser.close()
finally:
    server.shutdown()
