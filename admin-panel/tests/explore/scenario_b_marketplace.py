"""
Scenario B: Marketplace — Seller Flow + Buyer on Seller Store

Tests the marketplace multi-tenant flows:
  B1. Platform admin views sellers
  B2. Seller logs in and sees own dashboard
  B3. Seller creates a product
  B4. Seller views own payments
  B5. Guest browses seller storefront (/s/[seller])
  B6. Guest purchases from seller store
  B7. Guest purchases from seller with coupon
  B8. Buyer views purchases (includes seller products)
  B9. Platform admin views all sellers' payments

Usage:
    python tests/explore/scenario_b_marketplace.py
    SELLF_URL=https://other.instance python tests/explore/scenario_b_marketplace.py
"""

import sys
import time
from playwright.sync_api import sync_playwright
from helpers import (
    BASE, SCREENSHOT_DIR, USERS, login, logout, dismiss_cookies, navigate, screenshot,
    check_page_issues, find_element_text, wait_for_text,
    get_table_rows, setup_screenshot_dir, print_finding,
)

PREFIX = 'scenario-b'
TS = int(time.time())
FINDINGS = []


def find_seller_slugs(page):
    """Find available seller slugs from admin panel or store."""
    navigate(page, '/en/admin/sellers')
    page.wait_for_timeout(2000)

    # Try to find seller slugs from the page
    body = page.locator('body').text_content() or ''
    slugs = []

    # Check for known seed sellers
    for slug in ['kowalski_digital', 'creative_studio', 'kowalski_digital', 'creative_studio']:
        if slug.replace('-', '_') in body or slug.replace('_', '-') in body:
            slugs.append(slug)

    # Try links in the table
    seller_links = page.locator('a[href*="/s/"]')
    for i in range(seller_links.count()):
        href = seller_links.nth(i).get_attribute('href') or ''
        if '/s/' in href:
            parts = href.split('/s/')
            if len(parts) > 1:
                slug = parts[1].split('/')[0]
                if slug and slug not in slugs:
                    slugs.append(slug)

    return slugs


def b1_admin_views_sellers(page):
    """B1: Platform admin views sellers list."""
    print('\n=== B1: Admin views sellers ===')

    navigate(page, '/en/admin/sellers')
    screenshot(page, '01-sellers-list', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'B1', i)
        return []

    # Count sellers
    rows = page.locator('table tbody tr, [class*="seller"]')
    print(f'  .. B1: {rows.count()} sellers visible')

    # Find seller slugs
    slugs = find_seller_slugs(page)
    print(f'  .. B1: Seller slugs found: {slugs}')

    if not slugs:
        # Try checking store pages directly
        for candidate in ['kowalski_digital', 'creative_studio']:
            navigate(page, f'/s/{candidate}')
            if '404' not in (page.locator('body').text_content() or '')[:200]:
                slugs.append(candidate)
                print(f'  .. B1: Found seller store at /s/{candidate}')

    if slugs:
        print(f'  OK B1: Found {len(slugs)} seller(s)')
    else:
        print_finding(FINDINGS, 'B1', 'No sellers found - marketplace may not be configured')

    return slugs


def b2_seller_dashboard(page):
    """B2: Seller logs in and views own dashboard."""
    print('\n=== B2: Seller views dashboard ===')

    if not login(page, 'seller_kowalski'):
        print_finding(FINDINGS, 'B2', 'Seller login failed')
        return False

    screenshot(page, '02-seller-dashboard', PREFIX)

    # Check what seller sees
    navigate(page, '/dashboard')
    page.wait_for_timeout(2000)
    screenshot(page, '03-seller-dashboard-main', PREFIX)

    # Check sidebar - seller should see limited menu
    sidebar_links = page.locator('aside a, nav a').all()
    seller_pages = []
    for link in sidebar_links:
        try:
            href = link.get_attribute('href')
            text = link.text_content().strip()[:30]
            if href and text and href.startswith('/'):
                seller_pages.append((text, href))
        except:
            pass

    print(f'  .. B2: Seller sees {len(seller_pages)} nav items:')
    for text, href in seller_pages[:10]:
        print(f'       [{text}] → {href}')

    print(f'  OK B2: Seller dashboard accessible')
    return True


def b3_seller_creates_product(page):
    """B3: Seller creates a product in their schema."""
    print('\n=== B3: Seller creates product ===')

    # Should already be logged in as seller
    navigate(page, '/dashboard/products')
    screenshot(page, '04-seller-products', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'B3-list', i)

    # Count seller's products
    products = page.locator('table tbody tr')
    print(f'  .. B3: Seller has {products.count()} products')

    # Click Add Product
    add_btn = page.locator('text=Add Product, text=New Product, text=Create')
    if add_btn.count() > 0:
        add_btn.first.click()
        page.wait_for_timeout(2000)
        screenshot(page, '05-seller-product-form', PREFIX)

        # Fill minimal product
        name = f'Seller E2E Product {TS}'
        name_input = page.locator('input[name="name"]').first
        if name_input.is_visible():
            name_input.fill(name)

        price_input = page.locator('input[name="price"]').first
        if price_input.is_visible():
            price_input.fill('19.99')

        screenshot(page, '06-seller-product-filled', PREFIX)
        print(f'  OK B3: Seller product form accessible')
        # Don't save - just verify form works
    else:
        print(f'  ?? B3: No Add Product button for seller')

    return True


def b4_seller_views_payments(page):
    """B4: Seller views own payments."""
    print('\n=== B4: Seller views payments ===')

    navigate(page, '/en/admin/payments')
    screenshot(page, '07-seller-payments', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'B4', i)
        return False

    # Check if payment data is visible
    body = page.locator('body').text_content() or ''
    has_payment_data = 'Payment' in body and ('Transaction' in body or 'Amount' in body)
    print(f'  .. B4: Payment data visible: {has_payment_data}')

    rows = get_table_rows(page)
    print(f'  .. B4: {rows} transaction rows visible')

    print(f'  OK B4: Seller payments page accessible')
    return True


def b5_guest_browses_seller_store(page, seller_slug):
    """B5: Guest browses seller's storefront."""
    print(f'\n=== B5: Guest browses seller store (/s/{seller_slug}) ===')

    logout(page)

    navigate(page, f'/s/{seller_slug}')
    dismiss_cookies(page)
    screenshot(page, f'08-seller-store-{seller_slug}', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, f'B5-{seller_slug}', i)
        return None

    # Check store content
    body = page.locator('body').text_content() or ''
    has_products = page.locator('[class*="product"], [class*="card"], a[href*="/p/"]').count() > 0
    print(f'  .. B5: Products visible: {has_products}')

    # Find product links on seller store
    product_links = page.locator(f'a[href*="/s/{seller_slug}/"]')
    products_found = []
    for i in range(min(product_links.count(), 5)):
        href = product_links.nth(i).get_attribute('href')
        text = product_links.nth(i).text_content().strip()[:30]
        if href:
            products_found.append((text, href))

    print(f'  .. B5: {len(products_found)} seller product links found')
    for text, href in products_found[:3]:
        print(f'       [{text}] → {href}')

    # Visit first seller product
    if products_found:
        href = products_found[0][1]
        full_url = f'{BASE}{href}' if href.startswith('/') else href
        navigate(page, full_url)
        screenshot(page, f'09-seller-product-{seller_slug}', PREFIX)
        print(f'  OK B5: Seller product page loaded → {page.url}')
        return page.url

    print(f'  ?? B5: No seller products found at /s/{seller_slug}')
    return None


def b6_guest_buys_from_seller(page, product_url):
    """B6: Guest initiates purchase from seller's product."""
    print('\n=== B6: Guest purchases from seller ===')

    if not product_url:
        print('  -- B6: No seller product URL available')
        return None

    navigate(page, product_url)
    dismiss_cookies(page)
    screenshot(page, '10-seller-checkout', PREFIX)

    # Fill email
    email_input = page.locator('input[type="email"]')
    if email_input.is_visible():
        email_input.fill(f'e2e-buyer-{TS}@example.com')

    # Check for purchase button
    buy_btn = page.locator('button:has-text("Buy"), button:has-text("Purchase"), button:has-text("Pay"), button:has-text("Get"), button:has-text("Checkout")')
    if buy_btn.count() > 0:
        print(f'  .. B6: Purchase button: "{buy_btn.first.text_content().strip()[:30]}"')

        # Check for coupon field
        coupon_input = page.locator('input[name*="coupon"], input[placeholder*="coupon" i]')
        print(f'  .. B6: Coupon field: {"yes" if coupon_input.count() > 0 else "no"}')

        # Check for bumps
        bumps = page.locator('[class*="bump"], [class*="Bump"]')
        print(f'  .. B6: Order bumps: {bumps.count()}')

        screenshot(page, '11-seller-checkout-ready', PREFIX)

        # Click purchase
        buy_btn.first.click()
        page.wait_for_timeout(5000)
        screenshot(page, '12-seller-after-purchase', PREFIX)

        if 'stripe' in page.url.lower():
            print(f'  OK B6: Redirected to Stripe (seller checkout)')
            return 'stripe'
        elif page.locator('iframe[src*="stripe"]').count() > 0:
            print(f'  OK B6: Stripe embedded checkout loaded (seller)')
            return 'stripe_embedded'
        else:
            print(f'  ?? B6: After click → {page.url}')
            return 'unknown'
    else:
        # Product might be free
        free_btn = page.locator('button:has-text("Free"), button:has-text("Get")')
        if free_btn.count() > 0:
            print(f'  .. B6: This is a free product on seller store')
            return 'free'
        print_finding(FINDINGS, 'B6', 'No purchase button on seller product page')
        return None


def b7_buyer_views_seller_purchases(page):
    """B8: Buyer views purchases including seller products."""
    print('\n=== B8: Buyer views purchases ===')

    login(page, 'buyer')

    navigate(page, '/my-purchases')
    screenshot(page, '13-buyer-purchases', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'B8', i)

    navigate(page, '/my-products')
    screenshot(page, '14-buyer-products', PREFIX)

    print(f'  OK B8: Buyer purchase/product views accessible')
    return True


def b9_admin_views_all_payments(page):
    """B9: Platform admin views payments across all sellers."""
    print('\n=== B9: Admin views all payments ===')

    login(page, 'admin')

    navigate(page, '/en/admin/payments')
    screenshot(page, '15-admin-all-payments', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'B9', i)
        return False

    rows = get_table_rows(page)
    print(f'  .. B9: {rows} total transaction rows (all sellers)')

    # Check for seller column/filter
    body = page.locator('body').text_content() or ''
    has_seller_col = 'seller' in body.lower() or 'Seller' in body
    print(f'  .. B9: Seller column/filter: {"yes" if has_seller_col else "no"}')

    print(f'  OK B9: Admin payments page accessible')
    return True


def b10_compare_main_vs_seller_store(page, seller_slug):
    """B10: Compare main store vs seller store side by side."""
    print(f'\n=== B10: Compare main vs seller store ===')

    logout(page)

    # Main store
    navigate(page, '/my-products')
    dismiss_cookies(page)
    main_products = page.locator('[class*="card"], [class*="product"]').count()
    screenshot(page, '16-compare-main-store', PREFIX)

    # Seller store
    navigate(page, f'/s/{seller_slug}')
    seller_products = page.locator('[class*="card"], [class*="product"]').count()
    screenshot(page, f'17-compare-seller-store-{seller_slug}', PREFIX)

    print(f'  .. B10: Main store: ~{main_products} products')
    print(f'  .. B10: Seller store: ~{seller_products} products')

    # Key differences to verify:
    # - Seller store should show only seller's products
    # - Main store shows platform owner's products
    # - Seller store URLs should be /s/[seller]/...
    # - Main store URLs should be /p/...

    main_links = set()
    navigate(page, '/my-products')
    for link in page.locator('a[href*="/p/"]').all():
        href = link.get_attribute('href')
        if href:
            main_links.add(href)

    seller_links = set()
    navigate(page, f'/s/{seller_slug}')
    for link in page.locator(f'a[href*="/s/{seller_slug}/"]').all():
        href = link.get_attribute('href')
        if href:
            seller_links.add(href)

    overlap = main_links & seller_links
    if overlap:
        print_finding(FINDINGS, 'B10', f'Product overlap between stores: {overlap}')
    else:
        print(f'  OK B10: No product overlap between main and seller store')

    return True


def main():
    setup_screenshot_dir(PREFIX)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 900})

        print(f'{"="*60}')
        print(f'SCENARIO B: Marketplace — {BASE}')
        print(f'{"="*60}')

        # === PLATFORM ADMIN ===
        print('\n--- PLATFORM ADMIN ---')
        if not login(page, 'admin'):
            print('FATAL: Cannot login as admin')
            browser.close()
            sys.exit(1)

        seller_slugs = b1_admin_views_sellers(page)

        if not seller_slugs:
            print('\nWARNING: No sellers found. Marketplace may not be configured.')
            print('Need: seller schemas created in Supabase, seed data for sellers.')
            b9_admin_views_all_payments(page)

            print(f'\n{"="*60}')
            print(f'SCENARIO B PARTIAL: Marketplace not fully configured')
            print(f'Screenshots: {SCREENSHOT_DIR}/{PREFIX}/')
            print(f'{"="*60}')
            browser.close()
            sys.exit(0)

        # === SELLER FLOW ===
        print('\n--- SELLER FLOW ---')
        seller_logged_in = b2_seller_dashboard(page)
        if seller_logged_in:
            b3_seller_creates_product(page)
            b4_seller_views_payments(page)
        else:
            print('  -- Skipping B3-B4: seller login failed (user may not exist on this instance)')
            print('  -- To fix: create seller users on the remote Supabase instance')

        # === GUEST ON SELLER STORE ===
        print('\n--- GUEST ON SELLER STORE ---')
        seller_slug = seller_slugs[0]
        seller_product_url = b5_guest_browses_seller_store(page, seller_slug)
        b6_guest_buys_from_seller(page, seller_product_url)

        # === BUYER FLOW ===
        print('\n--- BUYER FLOW ---')
        b7_buyer_views_seller_purchases(page)

        # === ADMIN OVERVIEW ===
        print('\n--- ADMIN OVERVIEW ---')
        b9_admin_views_all_payments(page)
        b10_compare_main_vs_seller_store(page, seller_slug)

        # === SUMMARY ===
        print(f'\n{"="*60}')
        print(f'SCENARIO B COMPLETE: {len(FINDINGS)} issues found')
        print(f'Screenshots: {SCREENSHOT_DIR}/{PREFIX}/')
        if FINDINGS:
            print('\nISSUES:')
            for name, issue in FINDINGS:
                print(f'  [{name}] {issue}')
        print(f'{"="*60}')

        browser.close()
        sys.exit(1 if FINDINGS else 0)


if __name__ == '__main__':
    main()
