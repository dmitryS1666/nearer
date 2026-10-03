import subprocess, time, sys
from pathlib import Path

PWA = Path(__file__).resolve().parent
ROOT = PWA.parent

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('Playwright not installed — skipping browser e2e. Domain smoke still available via npm run test:smoke')
    sys.exit(0)

if not (PWA / 'www' / 'index.html').exists():
    subprocess.check_call(['npm', 'run', 'build'], cwd=ROOT, shell=True)

server = subprocess.Popen(
    [sys.executable, '-m', 'http.server', '4173', '--bind', '127.0.0.1', '--directory', str(PWA / 'www')],
    cwd=PWA,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
try:
    time.sleep(1)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(permissions=['notifications'])
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:4173', wait_until='networkidle')
        assert page.locator('text=Ближе каждый день.').is_visible()
        page.fill('input[name=name]', 'Дима')
        page.fill('input[name=partnerName]', 'Катя')
        page.click('button[type=submit]')
        page.wait_for_selector('text=Время для вас двоих')
        page.fill('#answer-text', 'Мне нравится, как мы поддерживаем друг друга.')
        page.click('#answer-form button[type=submit]')
        page.wait_for_selector('text=Ждём ответ партнёра')
        page.wait_for_selector('text=Ответы открыты', timeout=25000)
        page.click('#complete-day')
        page.wait_for_selector('text=Сад отношений')
        page.click('[data-nav="history"]')
        page.wait_for_selector('text=Наша история')
        assert page.locator('text=Мне нравится, как мы поддерживаем друг друга.').is_visible()
        page.click('[data-nav="settings"]')
        page.wait_for_selector('text=О тестовой версии')
        print('core_flow=PASS')
        print('page_errors=', errors)
        assert not errors, errors
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
