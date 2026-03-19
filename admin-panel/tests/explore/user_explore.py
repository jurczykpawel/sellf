"""
AI-driven exploratory test: Regular user perspective.

Logs in as a non-admin user, verifies they can see their own data
but NOT admin sections. Checks product catalog, purchases, profile.

Usage:
    python tests/explore/user_explore.py
    SELLF_URL=https://other.instance python tests/explore/user_explore.py
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SELLF_URL', 'https://sellf.tojest.dev')
SCREENSHOT_DIR = os.environ.get('SCREENSHOT_DIR', '/tmp/sellf-explore')
USER_EMAIL = 'john.doe@example.com'
USER_PASSWORD = 'password123'


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

        # --- Login as regular user ---
        page.goto(f'{BASE}/en/login')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)
        dismiss_cookies(page)

        page.fill('input[type="email"]', USER_EMAIL)
        page.fill('input[type="password"]', USER_PASSWORD)
        page.locator('button[type="submit"]').click()
        page.wait_for_timeout(5000)

        if 'login' in page.url:
            print('LOGIN FAILED')
            page.screenshot(path=f'{SCREENSHOT_DIR}/user-login-failed.png')
            browser.close()
            sys.exit(1)

        print(f'LOGGED IN AS USER → {page.url}\n')

        findings = []

        # --- User-accessible pages ---
        user_pages = [
            ('/my-products', 'my-products', True),
            ('/my-purchases', 'my-purchases', True),
            ('/profile', 'profile', True),
            ('/', 'store', True),
        ]

        for path, name, should_work in user_pages:
            page.goto(f'{BASE}{path}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)
            page.screenshot(path=f'{SCREENSHOT_DIR}/user-{name}.png', full_page=True)

            if 'login' in page.url:
                findings.append((name, 'REDIRECT TO LOGIN (should be accessible)'))
                print(f'XX {name:20s} REDIRECT TO LOGIN')
            else:
                print(f'OK {name:20s} OK')

        # --- Admin pages (should be blocked) ---
        # /dashboard is accessible to all logged-in users (shows user view, not admin).
        # Only truly admin-only routes should be blocked.
        # Only check routes that are separate pages (not SPA dashboard views)
        admin_pages = [
            ('/en/admin/payments', 'admin-payments'),
        ]

        print()
        for path, name in admin_pages:
            try:
                page.goto(f'{BASE}{path}', timeout=15000)
                page.wait_for_load_state('networkidle', timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(2000)
            page.screenshot(path=f'{SCREENSHOT_DIR}/user-{name}.png', full_page=True)

            body = page.locator('body').text_content() or ''
            is_blocked = (
                'login' in page.url
                or 'denied' in page.url
                or 'access-denied' in page.url
            )
            # Check if admin-specific data is actually visible (not just user dashboard)
            has_admin_data = any(marker in body for marker in [
                'Payment Management',
                'Seller Management',
                'Platform Admin',
            ])

            if is_blocked:
                print(f'OK {name:20s} REDIRECTED (correct)')
            elif not has_admin_data:
                print(f'OK {name:20s} NO ADMIN DATA (shows user view)')
            else:
                findings.append((name, f'ADMIN DATA VISIBLE to regular user at {path}'))
                print(f'XX {name:20s} ADMIN DATA VISIBLE - SECURITY ISSUE')

        # --- Check product page as regular user ---
        print()
        page.goto(f'{BASE}/my-products')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        product_links = page.locator('a[href*="/p/"], a[href*="/product/"]')
        if product_links.count() > 0:
            href = product_links.first.get_attribute('href')
            page.goto(f'{BASE}{href}' if href.startswith('/') else href)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)
            page.screenshot(path=f'{SCREENSHOT_DIR}/user-product-detail.png', full_page=True)
            print(f'OK product-detail      {page.url}')

        # --- Summary ---
        print(f'\n{"="*60}')
        print(f'USER EXPLORE: {len(findings)} issues found')
        print(f'Screenshots: {SCREENSHOT_DIR}/user-*.png')

        if findings:
            print('\nISSUES:')
            for name, issue in findings:
                print(f'  [{name}] {issue}')

        browser.close()
        sys.exit(1 if findings else 0)


if __name__ == '__main__':
    main()
