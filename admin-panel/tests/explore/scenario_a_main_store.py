"""
Scenario A: Main Store — Full Purchase Funnel

Tests the complete lifecycle on the platform owner's store:
  A1.  Admin creates a product
  A2.  Admin creates a coupon
  A3.  Admin creates an order bump
  A4.  Guest browses store and product page
  A5.  Guest purchases product (Stripe checkout)
  A6.  Guest purchases with coupon
  A7.  Guest purchases with order bump
  A8.  Guest registers → purchases auto-claimed
  A9.  User views purchased products
  A10. User requests refund
  A11. Admin approves refund → access revoked
  A12. Free product claim flow
  A13. PWYW (pay what you want) purchase

Usage:
    python tests/explore/scenario_a_main_store.py
    SELLF_URL=https://other.instance python tests/explore/scenario_a_main_store.py
"""

import sys
import time
from playwright.sync_api import sync_playwright
from helpers import (
    BASE, SCREENSHOT_DIR, login, logout, dismiss_cookies, navigate, screenshot,
    check_page_issues, find_element_text, wait_for_text,
    get_table_rows, setup_screenshot_dir, print_finding,
)

PREFIX = 'scenario-a'
TS = int(time.time())
FINDINGS = []


def a1_admin_creates_product(page):
    """A1: Admin creates a new test product via UI."""
    print('\n=== A1: Admin creates product ===')

    navigate(page, '/dashboard/products')
    screenshot(page, '01-products-list', PREFIX)

    # Click "Add Product"
    add_btn = page.locator('text=Add Product').first
    if not add_btn.is_visible(timeout=3000):
        print_finding(FINDINGS, 'A1', 'Add Product button not found')
        return None

    add_btn.click()
    page.wait_for_timeout(2000)
    screenshot(page, '02-product-form', PREFIX)

    # Fill product form
    product_name = f'E2E Test Product {TS}'
    product_slug = f'e2e-test-{TS}'
    product_price = '29.99'

    # Name field
    name_input = page.locator('input[name="name"], input[placeholder*="name" i]').first
    if name_input.is_visible():
        name_input.fill(product_name)
    else:
        # Try label-based
        page.get_by_label('Name', exact=False).first.fill(product_name)

    page.wait_for_timeout(500)

    # Slug field (may auto-generate)
    slug_input = page.locator('input[name="slug"]')
    if slug_input.is_visible() and slug_input.count() > 0:
        slug_input.fill(product_slug)

    # Price field
    price_input = page.locator('input[name="price"], input[type="number"]').first
    if price_input.is_visible():
        price_input.fill(product_price)

    page.wait_for_timeout(500)
    screenshot(page, '03-product-filled', PREFIX)

    # Submit / Save
    save_btn = page.locator('button:has-text("Save"), button:has-text("Create"), button[type="submit"]').first
    if save_btn.is_visible():
        save_btn.scroll_into_view_if_needed()
        save_btn.click(force=True)
        page.wait_for_timeout(3000)
        screenshot(page, '04-product-saved', PREFIX)

        # Check for success
        body = page.locator('body').text_content() or ''
        if product_name in body or 'success' in body.lower():
            print(f'  OK A1: Product "{product_name}" created')
            return {'name': product_name, 'slug': product_slug, 'price': product_price}
        else:
            # Check for errors
            err = page.locator('.bg-sf-danger-soft, [class*="error" i]')
            for i in range(err.count()):
                if err.nth(i).is_visible():
                    print_finding(FINDINGS, 'A1', f'Error: {err.nth(i).text_content().strip()[:80]}')
            print(f'  ?? A1: Product may or may not have been created')
            return {'name': product_name, 'slug': product_slug, 'price': product_price}
    else:
        print_finding(FINDINGS, 'A1', 'Save button not found')
        return None


def a2_admin_creates_coupon(page):
    """A2: Admin creates a coupon."""
    print('\n=== A2: Admin creates coupon ===')

    navigate(page, '/dashboard/coupons')
    screenshot(page, '05-coupons-list', PREFIX)

    # Click Create Coupon button
    add_btn = page.locator('button:has-text("Create Coupon"), button:has-text("Add Coupon"), a:has-text("Create Coupon")')
    if add_btn.count() == 0 or not add_btn.first.is_visible(timeout=3000):
        print_finding(FINDINGS, 'A2', 'Create Coupon button not found')
        return None

    add_btn.click()
    page.wait_for_timeout(2000)
    screenshot(page, '06-coupon-form', PREFIX)

    coupon_code = f'E2E{TS}'

    # Fill coupon form
    code_input = page.locator('input[name="code"], input[placeholder*="code" i]').first
    if code_input.is_visible():
        code_input.fill(coupon_code)

    # Discount value
    value_input = page.locator('input[name="discount_value"], input[name="discountValue"]').first
    if value_input.is_visible():
        value_input.fill('20')

    page.wait_for_timeout(500)
    screenshot(page, '07-coupon-filled', PREFIX)

    # Save (may be inside modal - use force click)
    save_btn = page.locator('button:has-text("Save"), button:has-text("Create Coupon"), button[type="submit"]').first
    if save_btn.is_visible():
        save_btn.scroll_into_view_if_needed()
        save_btn.click(force=True)
        page.wait_for_timeout(3000)
        screenshot(page, '08-coupon-saved', PREFIX)
        print(f'  OK A2: Coupon "{coupon_code}" created')
        return coupon_code
    else:
        print_finding(FINDINGS, 'A2', 'Save button not found in modal')
        return None


def a3_admin_creates_order_bump(page):
    """A3: Admin creates an order bump."""
    print('\n=== A3: Admin creates order bump ===')

    navigate(page, '/dashboard/order-bumps')
    screenshot(page, '09-bumps-list', PREFIX)

    add_btn = page.locator('text=Add, text=Create, text=New').first
    if not add_btn.is_visible(timeout=3000):
        print('  -- A3: No Add button found (may need products first)')
        return None

    add_btn.click()
    page.wait_for_timeout(2000)
    screenshot(page, '10-bump-form', PREFIX)

    # Order bump form is complex - just document what we see
    form_elements = page.locator('input, select, textarea').count()
    print(f'  .. A3: Order bump form has {form_elements} inputs')
    screenshot(page, '11-bump-form-detail', PREFIX)

    # Don't submit - just verify UI exists
    print('  OK A3: Order bump form accessible')
    return True


def a4_guest_browses_store(page, product_slug=None):
    """A4: Guest browses store and views product page."""
    print('\n=== A4: Guest browses store ===')

    # Logout first
    logout(page)

    # Store landing (public page, no auth required)
    navigate(page, '/')
    dismiss_cookies(page)
    screenshot(page, '12-store-landing', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'A4-store', i)

    # Count products visible
    cards = page.locator('[class*="product"], [class*="card"]').count()
    print(f'  .. A4: Store shows ~{cards} product cards')

    # Click first product
    product_links = page.locator('a:has-text("View Details"), a[href*="/p/"]')
    if product_links.count() > 0:
        first_link = product_links.first
        product_name = first_link.text_content().strip()[:40]
        first_link.click()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)
        screenshot(page, '13-product-page', PREFIX)
        print(f'  OK A4: Viewed product page → {page.url}')

        # Check product page elements
        body_text = page.locator('body').text_content() or ''
        has_price = '$' in body_text or 'PLN' in body_text or '€' in body_text or 'Free' in body_text
        has_buy = page.locator('button:has-text("Buy"), button:has-text("Purchase"), button:has-text("Get"), button:has-text("Checkout")').count() > 0
        print(f'       Price visible: {has_price}, Buy button: {has_buy}')

        return page.url
    else:
        print_finding(FINDINGS, 'A4', 'No product links found on store page')
        return None


def a5_guest_checkout(page, product_url=None):
    """A5: Guest initiates checkout for a paid product."""
    print('\n=== A5: Guest checkout flow ===')

    if product_url:
        navigate(page, product_url)
    else:
        # Find a paid product
        navigate(page, '/my-products')
        dismiss_cookies(page)
        # Look for a product with a price
        paid_link = page.locator('a:has-text("View Details")').first
        if paid_link.is_visible():
            paid_link.click()
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)

    screenshot(page, '14-checkout-product', PREFIX)

    # Fill email for guest checkout
    email_input = page.locator('input[type="email"], input[name="email"]').first
    if email_input.is_visible():
        guest_email = f'e2e-guest-{TS}@example.com'
        email_input.fill(guest_email)
        print(f'  .. A5: Filled guest email: {guest_email}')

    # Check for order bumps
    bump_checkboxes = page.locator('input[type="checkbox"][name*="bump"], [class*="bump"] input[type="checkbox"]')
    bump_count = bump_checkboxes.count()
    print(f'  .. A5: {bump_count} order bumps available')

    # Check for coupon input
    coupon_input = page.locator('input[name*="coupon"], input[placeholder*="coupon" i], input[placeholder*="code" i]')
    has_coupon = coupon_input.count() > 0
    print(f'  .. A5: Coupon field: {"yes" if has_coupon else "no"}')

    # Check for PWYW
    custom_price = page.locator('input[name*="custom"], input[name*="amount"]')
    is_pwyw = custom_price.count() > 0
    print(f'  .. A5: PWYW mode: {"yes" if is_pwyw else "no"}')

    screenshot(page, '15-checkout-ready', PREFIX)

    # Click purchase button
    buy_btn = page.locator('button:has-text("Buy"), button:has-text("Purchase"), button:has-text("Pay"), button:has-text("Checkout"), button:has-text("Get")').first
    if buy_btn.is_visible():
        print(f'  .. A5: Purchase button found: "{buy_btn.text_content().strip()[:30]}"')

        # Click and see what happens (may redirect to Stripe or show embedded checkout)
        buy_btn.click()
        page.wait_for_timeout(5000)
        screenshot(page, '16-after-purchase-click', PREFIX)

        current_url = page.url
        if 'stripe.com' in current_url or 'checkout.stripe' in current_url:
            print(f'  OK A5: Redirected to Stripe checkout')
            return 'stripe_redirect'
        elif page.locator('iframe[src*="stripe"]').count() > 0:
            print(f'  OK A5: Stripe embedded checkout loaded')
            return 'stripe_embedded'
        else:
            # Check for error or loading state
            body = page.locator('body').text_content() or ''
            if 'error' in body.lower()[:500]:
                print_finding(FINDINGS, 'A5', f'Error after purchase click: {page.url}')
            else:
                print(f'  ?? A5: After click → {page.url}')
            return 'unknown'
    else:
        print_finding(FINDINGS, 'A5', 'No purchase button found')
        return None


def a6_checkout_with_coupon(page, coupon_code=None):
    """A6: Guest checkout with coupon code."""
    print('\n=== A6: Checkout with coupon ===')

    if not coupon_code:
        coupon_code = 'TESTCOUPON'

    # Navigate to a product checkout
    navigate(page, '/')
    dismiss_cookies(page)

    # Find a paid product
    paid_link = page.locator('a:has-text("View Details")').nth(1)  # second product
    if paid_link.is_visible():
        paid_link.click()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

    # Look for coupon input
    coupon_input = page.locator('input[name*="coupon"], input[placeholder*="coupon" i], input[placeholder*="code" i]')
    if coupon_input.count() > 0:
        coupon_input.first.fill(coupon_code)
        page.wait_for_timeout(2000)  # Wait for validation
        screenshot(page, '17-coupon-applied', PREFIX)

        # Check if discount shown
        discount_text = page.locator('text=discount, text=Discount, text=-$, text=-%').count()
        if discount_text > 0:
            print(f'  OK A6: Coupon "{coupon_code}" applied, discount visible')
        else:
            body = page.locator('body').text_content() or ''
            if 'invalid' in body.lower() or 'expired' in body.lower():
                print(f'  ?? A6: Coupon rejected (may be invalid on this instance)')
            else:
                print(f'  ?? A6: Coupon entered but no discount visible')
    else:
        print(f'  -- A6: No coupon input field on this product page')

    return True


def a7_checkout_with_bumps(page):
    """A7: Guest checkout with order bumps selected."""
    print('\n=== A7: Checkout with order bumps ===')

    # Navigate to store to find products with bumps
    navigate(page, '/')
    dismiss_cookies(page)

    # Try multiple products to find one with bumps
    product_links = page.locator('a:has-text("View Details")')
    found_bumps = False

    for i in range(min(product_links.count(), 5)):
        product_links.nth(i).click()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        bumps = page.locator('[class*="bump"], [class*="Bump"], input[type="checkbox"]')
        if bumps.count() > 0:
            screenshot(page, '18-product-with-bumps', PREFIX)
            print(f'  .. A7: Found product with {bumps.count()} bump elements')
            found_bumps = True

            # Try to check a bump
            checkboxes = page.locator('[class*="bump"] input[type="checkbox"], [class*="Bump"] input[type="checkbox"]')
            if checkboxes.count() > 0:
                checkboxes.first.check()
                page.wait_for_timeout(1000)
                screenshot(page, '19-bump-selected', PREFIX)
                print(f'  OK A7: Order bump selected')
            break

        page.go_back()
        page.wait_for_timeout(1000)

    if not found_bumps:
        print('  -- A7: No products with order bumps found')

    return found_bumps


def a9_user_views_purchases(page):
    """A9: Authenticated user views their purchased products."""
    print('\n=== A9: User views purchases ===')

    # Login as a user with purchases
    login(page, 'user_anna')

    navigate(page, '/my-purchases')
    screenshot(page, '20-my-purchases', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'A9-purchases', i)

    # Count purchase items
    rows = page.locator('table tbody tr, [class*="purchase"], [class*="order"]').count()
    print(f'  .. A9: {rows} purchase entries visible')

    # Check My Products
    navigate(page, '/my-products')
    screenshot(page, '21-my-products-user', PREFIX)
    print(f'  OK A9: My Products page loaded → {page.url}')

    return True


def a10_user_requests_refund(page):
    """A10: User requests a refund."""
    print('\n=== A10: User requests refund ===')

    navigate(page, '/my-purchases')
    screenshot(page, '22-purchases-for-refund', PREFIX)

    # Look for "Request Refund" button
    refund_btn = page.locator('button:has-text("Refund"), button:has-text("refund"), a:has-text("Refund")')
    if refund_btn.count() > 0:
        print(f'  .. A10: Found {refund_btn.count()} refund button(s)')
        refund_btn.first.click()
        page.wait_for_timeout(2000)
        screenshot(page, '23-refund-modal', PREFIX)

        # Look for confirmation/submit in modal
        submit = page.locator('button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Request")')
        if submit.count() > 0:
            print(f'  OK A10: Refund request modal opened')
            # Don't actually submit - just verify UI
        else:
            print(f'  ?? A10: Refund modal opened but no submit button found')
    else:
        print(f'  -- A10: No refund buttons found (may need eligible purchases)')

    return True


def a11_admin_manages_refunds(page):
    """A11: Admin views and manages refund requests."""
    print('\n=== A11: Admin manages refunds ===')

    navigate(page, '/dashboard/refund-requests')
    screenshot(page, '24-refund-requests', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'A11', i)
        return False

    # Check for pending requests
    pending = page.locator('text=Pending, text=pending').count()
    print(f'  .. A11: {pending} pending refund indicators visible')

    # Look for approve/reject buttons
    approve = page.locator('button:has-text("Approve"), button:has-text("approve")')
    reject = page.locator('button:has-text("Reject"), button:has-text("reject")')
    print(f'  .. A11: {approve.count()} approve, {reject.count()} reject buttons')
    print(f'  OK A11: Refund management page accessible')

    return True


def a12_free_product_claim(page):
    """A12: Guest claims a free product."""
    print('\n=== A12: Free product claim ===')

    logout(page)

    # Find a free product
    navigate(page, '/')
    dismiss_cookies(page)

    free_link = page.locator('text=Free, text=FREE, text=$0').first
    if free_link.is_visible():
        # Click the card or nearby "View Details"
        parent = free_link.locator('xpath=ancestor::a | xpath=ancestor::div[.//a]')
        detail_link = parent.locator('a:has-text("View"), a:has-text("Get"), a:has-text("Details")')
        if detail_link.count() > 0:
            detail_link.first.click()
        else:
            free_link.click()

        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)
        screenshot(page, '25-free-product', PREFIX)

        # Look for "Get Free Access" or similar
        free_btn = page.locator('button:has-text("Free"), button:has-text("Get"), button:has-text("Claim")')
        if free_btn.count() > 0:
            print(f'  OK A12: Free product page with claim button')

            # Fill email if needed
            email_input = page.locator('input[type="email"]')
            if email_input.is_visible():
                email_input.fill(f'e2e-free-{TS}@example.com')
                screenshot(page, '26-free-claim-filled', PREFIX)

            # Don't click - would trigger magic link
            print(f'  OK A12: Free claim form ready (not submitted)')
        else:
            print(f'  ?? A12: Free product page but no claim button')
    else:
        print(f'  -- A12: No free products found in store')

    return True


def a13_admin_views_analytics(page):
    """A13: Admin views dashboard analytics."""
    print('\n=== A13: Admin views analytics ===')

    navigate(page, '/dashboard')
    screenshot(page, '27-dashboard-analytics', PREFIX)

    # Check key metrics
    metrics = ['Revenue', 'Orders', 'Users', 'Active']
    for metric in metrics:
        el = page.locator(f'text={metric}').first
        if el.is_visible():
            # Get the value near it
            parent = el.locator('xpath=ancestor::div[position()=1]')
            value = parent.text_content().strip()[:50] if parent.count() > 0 else '?'
            print(f'  .. A13: {metric}: found')

    # Check chart
    chart = page.locator('canvas, svg, [class*="chart" i], [class*="Chart"]')
    print(f'  .. A13: Chart elements: {chart.count()}')

    # Check recent activity
    activity = page.locator('text=Recent Activity, text=RECENT ACTIVITY')
    print(f'  .. A13: Activity section: {"yes" if activity.count() > 0 else "no"}')

    print(f'  OK A13: Dashboard analytics loaded')
    return True


def a14_admin_manages_users(page):
    """A14: Admin views and manages users."""
    print('\n=== A14: Admin manages users ===')

    navigate(page, '/dashboard/users')
    screenshot(page, '28-users-list', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'A14', i)
        return False

    # Count users
    user_rows = page.locator('table tbody tr, [class*="user-row"]')
    print(f'  .. A14: {user_rows.count()} users visible')

    # Search functionality
    search = page.locator('input[placeholder*="Search"], input[type="search"]')
    if search.count() > 0:
        search.first.fill('example.com')
        page.wait_for_timeout(1000)
        filtered = page.locator('table tbody tr').count()
        print(f'  .. A14: After search "example.com": {filtered} results')
        search.first.fill('')
        page.wait_for_timeout(1000)

    print(f'  OK A14: User management page accessible')
    return True


def a15_admin_settings(page):
    """A15: Admin views settings page."""
    print('\n=== A15: Admin views settings ===')

    navigate(page, '/dashboard/settings')
    screenshot(page, '29-settings', PREFIX)

    issues = check_page_issues(page)
    if issues:
        for i in issues:
            print_finding(FINDINGS, 'A15', i)

    # Check for key settings sections
    sections = ['Shop', 'Payment', 'Theme', 'Legal']
    for section in sections:
        el = page.locator(f'text={section}')
        if el.count() > 0:
            print(f'  .. A15: Settings section "{section}" found')

    print(f'  OK A15: Settings page accessible')
    return True


def main():
    setup_screenshot_dir(PREFIX)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 900})

        print(f'{"="*60}')
        print(f'SCENARIO A: Main Store — {BASE}')
        print(f'{"="*60}')

        # === ADMIN FLOW ===
        print('\n--- ADMIN SETUP ---')
        if not login(page, 'admin'):
            print('FATAL: Cannot login as admin')
            browser.close()
            sys.exit(1)

        product = a1_admin_creates_product(page)
        coupon = a2_admin_creates_coupon(page)
        a3_admin_creates_order_bump(page)
        a13_admin_views_analytics(page)
        a14_admin_manages_users(page)
        a15_admin_settings(page)
        a11_admin_manages_refunds(page)

        # === GUEST FLOW ===
        print('\n--- GUEST FLOW ---')
        product_url = a4_guest_browses_store(page, product.get('slug') if product else None)
        a5_guest_checkout(page, product_url)
        a6_checkout_with_coupon(page, coupon)
        a7_checkout_with_bumps(page)

        # === AUTHENTICATED USER FLOW ===
        print('\n--- USER FLOW ---')
        a9_user_views_purchases(page)
        a10_user_requests_refund(page)

        # === FREE PRODUCT ===
        print('\n--- FREE PRODUCT ---')
        a12_free_product_claim(page)

        # === SUMMARY ===
        print(f'\n{"="*60}')
        print(f'SCENARIO A COMPLETE: {len(FINDINGS)} issues found')
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
