"""
AI-driven exploratory test: Admin perspective.

Logs in as admin, visits all dashboard sections, takes screenshots,
and reports issues (404s, NaN/undefined, error messages, empty states).

Usage:
    python tests/explore/admin_explore.py
    SELLF_URL=https://other.instance python tests/explore/admin_explore.py
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SELLF_URL', 'https://sellf.tojest.dev')
SCREENSHOT_DIR = os.environ.get('SCREENSHOT_DIR', '/tmp/sellf-explore')
ADMIN_EMAIL = 'demo@sellf.app'
ADMIN_PASSWORD = 'demo123'


def dismiss_cookies(page):
    try:
        btn = page.locator("text=That's ok")
        if btn.is_visible(timeout=1500):
            btn.click()
            page.wait_for_timeout(300)
    except Exception:
        pass


def check_page(page, name):
    """Analyze current page for common issues."""
    issues = []

    if 'login' in page.url:
        issues.append('REDIRECT TO LOGIN')
        return issues

    body_text = page.locator('body').text_content() or ''
    if '404' in body_text[:200] and 'not be found' in body_text[:200]:
        issues.append('404 NOT FOUND')
        return issues

    # Check for NaN/undefined in visible text nodes
    visible_text = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('h1,h2,h3,h4,p,span,td,th,li'))
            .filter(el => el.children.length === 0)
            .map(el => el.textContent.trim())
            .filter(t => t.length > 0 && t.length < 200)
            .join('\\n');
    }""")

    for bad in ['NaN', 'undefined']:
        if bad in visible_text:
            for line in visible_text.split('\n'):
                if bad in line:
                    issues.append(f'"{bad}" in: "{line[:60]}"')
                    break

    # Check for JS console errors
    # (captured separately via page.on('console'))

    return issues


def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 900})

        # Capture console errors
        console_errors = []
        page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)

        # --- Login ---
        page.goto(f'{BASE}/en/login')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)
        dismiss_cookies(page)

        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PASSWORD)
        page.locator('button[type="submit"]').click()
        page.wait_for_timeout(5000)

        if 'login' in page.url:
            print('LOGIN FAILED')
            page.screenshot(path=f'{SCREENSHOT_DIR}/login-failed.png')
            browser.close()
            sys.exit(1)

        print(f'LOGGED IN AS ADMIN → {page.url}\n')

        # --- Explore all sections ---
        sections = [
            ('/dashboard', 'dashboard'),
            ('/dashboard/products', 'products'),
            ('/dashboard/variants', 'variants'),
            ('/dashboard/categories', 'categories'),
            ('/dashboard/order-bumps', 'order-bumps'),
            ('/dashboard/coupons', 'coupons'),
            ('/dashboard/refund-requests', 'refund-requests'),
            ('/dashboard/webhooks', 'webhooks'),
            ('/dashboard/integrations', 'integrations'),
            ('/dashboard/api-keys', 'api-keys'),
            ('/dashboard/users', 'users'),
            ('/dashboard/settings', 'settings'),
            ('/en/admin/payments', 'payments'),
            ('/my-products', 'my-products'),
            ('/my-purchases', 'my-purchases'),
            ('/profile', 'profile'),
        ]

        findings = []
        ok_count = 0

        for path, name in sections:
            console_errors.clear()
            page.goto(f'{BASE}{path}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)
            page.screenshot(path=f'{SCREENSHOT_DIR}/admin-{name}.png', full_page=True)

            issues = check_page(page, name)

            # Add JS console errors (filter noise)
            for err in console_errors:
                if any(skip in err for skip in [
                    'favicon', 'serviceWorker', 'chunk', 'websocket',
                    'realtime', 'Connecting to', 'wss://',
                ]):
                    continue
                issues.append(f'CONSOLE: {err[:80]}')

            if issues:
                findings.append((name, path, issues))
                marker = 'XX'
            else:
                ok_count += 1
                marker = 'OK'

            print(f'{marker} {name:20s} {", ".join(issues) if issues else "OK"}')

        # --- Summary ---
        print(f'\n{"="*60}')
        print(f'ADMIN EXPLORE: {len(sections)} pages, {ok_count} OK, {len(findings)} with issues')
        print(f'Screenshots: {SCREENSHOT_DIR}/admin-*.png')

        if findings:
            print('\nISSUES:')
            for name, path, issues in findings:
                for issue in issues:
                    print(f'  [{name}] {issue}')

        browser.close()
        sys.exit(1 if findings else 0)


if __name__ == '__main__':
    main()
