"""
Shared helpers for Sellf exploratory tests.
"""

import os
import json
import time

BASE = os.environ.get('SELLF_URL', 'https://sellf.tojest.dev')
SCREENSHOT_DIR = os.environ.get('SCREENSHOT_DIR', '/tmp/sellf-explore')

# Seed users (E2E_MODE=true)
USERS = {
    'admin': {'email': 'demo@sellf.app', 'password': 'demo123'},
    'user_john': {'email': 'john.doe@example.com', 'password': 'password123'},
    'user_maria': {'email': 'maria.schmidt@example.com', 'password': 'password123'},
    'user_anna': {'email': 'anna.kowalska@example.com', 'password': 'password123'},
    'seller_kowalski': {'email': 'kowalski@demo.sellf.app', 'password': 'demo1234'},
    'seller_creative': {'email': 'creative@demo.sellf.app', 'password': 'demo1234'},
    'buyer': {'email': 'buyer@demo.sellf.app', 'password': 'demo1234'},
}

# Console noise to filter
CONSOLE_NOISE = [
    'favicon', 'serviceWorker', 'chunk', 'websocket',
    'realtime', 'Connecting to', 'wss://', 'Download the',
    'third-party cookie', 'Klaro',
]


def setup_screenshot_dir(prefix=''):
    """Create screenshot directory."""
    d = os.path.join(SCREENSHOT_DIR, prefix) if prefix else SCREENSHOT_DIR
    os.makedirs(d, exist_ok=True)
    return d


def dismiss_cookies(page):
    """Dismiss Klaro cookie consent banner."""
    try:
        btn = page.locator("text=That's ok")
        if btn.is_visible(timeout=1500):
            btn.click()
            page.wait_for_timeout(300)
    except Exception:
        pass


def login(page, role='admin'):
    """Login as a specific user role. Returns True on success."""
    creds = USERS[role]
    page.goto(f'{BASE}/en/login')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)
    dismiss_cookies(page)

    email_input = page.locator('input[type="email"]')
    if not email_input.is_visible(timeout=5000):
        print(f'  LOGIN FAILED as {role}: email input not found (may already be logged in)')
        return 'login' not in page.url

    email_input.fill(creds['email'])
    page.fill('input[type="password"]', creds['password'])
    page.locator('button[type="submit"]').click()
    page.wait_for_timeout(5000)

    success = 'login' not in page.url
    if success:
        print(f'  LOGIN OK as {role} ({creds["email"]}) → {page.url}')
    else:
        # Check for error message
        errs = page.locator('.bg-sf-danger-soft').all()
        err_text = ''
        for e in errs:
            if e.is_visible():
                err_text = e.text_content().strip()[:80]
                break
        print(f'  LOGIN FAILED as {role}: {err_text}')
    return success


def logout(page):
    """Logout current user."""
    # Try clicking user avatar → logout
    try:
        avatar = page.locator('[class*="avatar"], [aria-label*="profile"], [aria-label*="user"]').first
        if avatar.is_visible(timeout=2000):
            avatar.click()
            page.wait_for_timeout(500)
            logout_btn = page.locator('text=Sign out, text=Log out, text=Logout').first
            if logout_btn.is_visible(timeout=1000):
                logout_btn.click()
                page.wait_for_timeout(2000)
                return True
    except Exception:
        pass

    # Fallback: clear cookies
    page.context.clear_cookies()
    page.goto(f'{BASE}/en/login')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    return True


def navigate(page, path, wait=2000):
    """Navigate to path and wait."""
    url = f'{BASE}{path}' if path.startswith('/') else path
    try:
        page.goto(url, timeout=15000)
        page.wait_for_load_state('networkidle', timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(wait)


def screenshot(page, name, prefix='', full_page=True):
    """Take screenshot with consistent naming."""
    d = os.path.join(SCREENSHOT_DIR, prefix) if prefix else SCREENSHOT_DIR
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f'{name}.png')
    page.screenshot(path=path, full_page=full_page)
    return path


def check_page_issues(page):
    """Check current page for common issues. Returns list of issue strings."""
    issues = []

    if 'login' in page.url and '/login' in page.url:
        issues.append('REDIRECT TO LOGIN')
        return issues

    body = page.locator('body').text_content() or ''
    if '404' in body[:200] and 'not be found' in body[:200]:
        issues.append('404 NOT FOUND')
        return issues

    # Check visible text nodes for NaN/undefined
    visible = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('h1,h2,h3,h4,p,span,td,th,li'))
            .filter(el => el.children.length === 0)
            .map(el => el.textContent.trim())
            .filter(t => t.length > 0 && t.length < 200)
            .join('\\n');
    }""")

    for bad in ['NaN', 'undefined']:
        if bad in visible:
            for line in visible.split('\n'):
                if bad in line:
                    issues.append(f'"{bad}" in: "{line[:60]}"')
                    break

    return issues


def find_element_text(page, selector):
    """Get text content of first matching element, or None."""
    el = page.locator(selector)
    if el.count() > 0 and el.first.is_visible():
        return el.first.text_content().strip()
    return None


def wait_for_text(page, text, timeout=10000):
    """Wait for text to appear on page."""
    try:
        page.locator(f'text={text}').first.wait_for(state='visible', timeout=timeout)
        return True
    except Exception:
        return False


def get_table_rows(page, table_selector='table tbody tr'):
    """Count visible rows in a table."""
    rows = page.locator(table_selector)
    return rows.count()


def print_step(step_num, description, status='...'):
    """Print formatted step."""
    icon = {'OK': 'OK', 'FAIL': 'XX', 'SKIP': '--', 'WARN': '!!', '...': '..'}[status]
    print(f'  {icon} A{step_num}: {description}')


def print_finding(findings, name, issue):
    """Record a finding."""
    findings.append((name, issue))
    print(f'     ISSUE: {issue}')
