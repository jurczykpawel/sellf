"""
AI-driven exploratory test: Guest (unauthenticated) perspective.

Browses the store, product pages, and checkout flow without logging in.
Verifies that protected pages redirect to login.

Usage:
    python tests/explore/guest_explore.py
    SELLF_URL=https://other.instance python tests/explore/guest_explore.py
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SELLF_URL', 'https://sellf.tojest.dev')
SCREENSHOT_DIR = os.environ.get('SCREENSHOT_DIR', '/tmp/sellf-explore')


def dismiss_cookies(page):
    try:
        btn = page.locator("text=That's ok")
        if btn.is_visible(timeout=1500):
            btn.click()
            page.wait_for_timeout(300)
    except Exception:
        pass


def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 900})

        # --- Public pages ---
        print('GUEST EXPLORATION (not logged in)\n')

        public_pages = [
            ('/', 'store'),
            ('/en/login', 'login'),
            ('/my-products', 'catalog'),
            ('/en/about', 'about'),
        ]

        for path, name in public_pages:
            page.goto(f'{BASE}{path}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)
            dismiss_cookies(page)
            page.screenshot(path=f'{SCREENSHOT_DIR}/guest-{name}.png', full_page=True)

            body = page.locator('body').text_content() or ''
            issues = []
            if '404' in body[:100] and 'not be found' in body[:200]:
                issues.append('404')
            for bad in ['NaN', 'undefined']:
                if bad in body:
                    issues.append(f'"{bad}" in page')

            print(f'{"XX" if issues else "OK"} {name:20s} {", ".join(issues) or "OK"}')

        # --- Product detail pages ---
        print()
        page.goto(f'{BASE}/my-products')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        product_cards = page.locator('a[href*="/p/"], a[href*="/product/"], a[href*="/checkout/"]')
        found_products = []
        for i in range(min(product_cards.count(), 3)):
            href = product_cards.nth(i).get_attribute('href')
            text = product_cards.nth(i).text_content().strip()[:30]
            if href:
                found_products.append((text, href))

        for text, href in found_products:
            full_url = f'{BASE}{href}' if href.startswith('/') else href
            page.goto(full_url)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)
            safe_name = href.replace('/', '-').strip('-')[:30]
            page.screenshot(path=f'{SCREENSHOT_DIR}/guest-product-{safe_name}.png', full_page=True)
            print(f'OK product             [{text}] → {href}')

        # --- Protected pages (should redirect to login) ---
        print()
        findings = []

        protected_pages = [
            ('/dashboard', 'dashboard'),
            ('/dashboard/products', 'admin-products'),
            ('/dashboard/users', 'admin-users'),
            ('/dashboard/settings', 'admin-settings'),
            ('/profile', 'profile'),
            ('/en/admin/payments', 'admin-payments'),
        ]

        for path, name in protected_pages:
            page.goto(f'{BASE}{path}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)
            page.screenshot(path=f'{SCREENSHOT_DIR}/guest-protected-{name}.png')

            if 'login' in page.url:
                print(f'OK {name:20s} REDIRECTED TO LOGIN (correct)')
            else:
                findings.append((name, f'NOT REDIRECTED - guest can access {path}'))
                print(f'XX {name:20s} NOT REDIRECTED - SECURITY ISSUE')

        # --- API endpoints without auth ---
        print()
        api_checks = [
            '/api/runtime-config',
            '/api/admin/products',
            '/api/admin/users',
        ]

        for endpoint in api_checks:
            resp = page.evaluate(f"""() => {{
                return fetch('{BASE}{endpoint}')
                    .then(r => ({{ status: r.status, ok: r.ok }}))
                    .catch(e => ({{ status: 0, error: e.message }}));
            }}""")
            status = resp.get('status', 0)
            is_public = endpoint == '/api/runtime-config'
            if is_public:
                expected = status == 200
            else:
                expected = status in [401, 403, 404]

            print(f'{"OK" if expected else "XX"} API {endpoint:35s} → {status} {"(expected)" if expected else "(UNEXPECTED)"}')
            if not expected:
                findings.append((endpoint, f'Unexpected status {status}'))

        # --- Summary ---
        print(f'\n{"="*60}')
        print(f'GUEST EXPLORE: {len(findings)} issues found')
        print(f'Screenshots: {SCREENSHOT_DIR}/guest-*.png')

        if findings:
            print('\nISSUES:')
            for name, issue in findings:
                print(f'  [{name}] {issue}')

        browser.close()
        sys.exit(1 if findings else 0)


if __name__ == '__main__':
    main()
