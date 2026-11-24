"""Shared browser plans for inventory and execution."""

from collections import Counter
from dataclasses import dataclass

import json
from pathlib import PurePosixPath

from support import ADMIN, OUT, RUNTIME, record, require, run

MAIN_PROJECTS = ('chromium', 'chromium-heavy', 'maintenance', 'accessibility', 'rate-limiting', 'rate-limiting-v1')
ALLOWED_SKIPS = {
    ('offer-public.spec.ts', 'two production replicas bound lost invalidation and scheduled availability/sale'),
    ('payment-method-config-checkout.spec.ts', 'E2E-CHECKOUT-003: Stripe preset - Custom PMC'),
    ('variants-admin-ui.spec.ts', 'should toggle featured status'),
}
# These candidate specs exercise the sandbox directly or through the Sellf checkout.
STRIPE_SPECS = '''
accessibility admin-refund buyer-regression cart-regressions checkout-buyer-details checkout-invoice-section
checkout-profile checkout-recovery checkout-session-recovery checkout-session-update coupon-multi-bump
coupon-race-condition coupon-two-tabs critical-paths custom-checkout-fields embed-coupons embed-minimal
embedded-coupon-bumps events-storefront full-discount-coupon list-filter-order maintenance-mode
multi-order-bump-security order-bump-security oto-system owner-demo-ux payment-access-flow
payment-flow-complete payment-method-config-checkout payment-return-account payment-session-email
product-bundles-e2e product-preview purchase-attribution purchase-intent pwyw-checkout-ui pwyw-free-option
pwyw-security pwyw-subscription refund-system sale-price-checkout-charge set-price shop-gus
stripe-checkout-console-warnings stripe-deleted-product-reconciliation stripe-webhook-registration
stripe-webhook subscription-checkout-ui tip-jar-template tracking-events v1-refund webhook-amount-validation webhook-dispatch
'''.split()
STRIPE_FILTER = r'(?:^|/)(?:' + '|'.join(STRIPE_SPECS) + r')\.spec\.ts$'
FAKE_STRIPE = {
    'STRIPE_SECRET_KEY': 'sk_' + 'test_listing_only',
    'STRIPE_PUBLISHABLE_KEY': 'pk_' + 'test_listing_only',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY': 'pk_' + 'test_listing_only',
}
LIST_ENV = {
    **FAKE_STRIPE,
    'SUPABASE_URL': 'http://127.0.0.1:55321',
    'NEXT_PUBLIC_SUPABASE_URL': 'http://127.0.0.1:55321',
    'SUPABASE_SERVICE_ROLE_KEY': 'listing-only',
    'SUPABASE_ANON_KEY': 'listing-only',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'listing-only',
}


@dataclass(frozen=True)
class Suite:
    name: str
    config: str
    options: tuple = ()
    variables: tuple = ()
    driver: str = 'playwright'

    def args(self):
        config = str(RUNTIME / self.config) if self.config.startswith('gate-') else self.config
        return ['bun', 'x', 'playwright', 'test', '--config=' + config, *self.options]


def main_suite(name, *projects, options=(), **variables):
    return Suite(
        name, 'gate-main.config.ts', tuple('--project=' + p for p in projects) + options, tuple(variables.items())
    )


CANONICAL = {
    'main': main_suite('main', *MAIN_PROJECTS, options=('--no-deps',), RATE_LIMIT_TEST_MODE='true'),
    'sections': Suite('sections', 'gate-sections.config.ts'),
    'transfer': Suite('transfer', 'playwright.transfer.config.ts'),
    'invoicing': Suite('invoicing', 'gate-invoicing.config.ts'),
    'runtime': Suite('runtime', 'playwright.runtime-urls.config.ts', driver='runtime'),
    'stripe': Suite(
        'stripe', 'playwright.config.ts', ('--project=stripe-live',), (('STRIPE_LIVE_E2E', '1'),), driver='stripe'
    ),
    'template-author': main_suite('template-author', 'template-author', PW_TEMPLATE_AUTHOR='1'),
    'live-template-acceptance': Suite('live-template-acceptance', 'gate-acceptance.config.ts'),
}
LANES = {
    'sections': (
        CANONICAL['sections'],
        CANONICAL['invoicing'],
        CANONICAL['template-author'],
        CANONICAL['live-template-acceptance'],
    ),
    'rate-limiting': (main_suite('rate-limiting', 'rate-limiting', 'rate-limiting-v1', RATE_LIMIT_TEST_MODE='true'),),
    'stripe-live': (CANONICAL['stripe'],),
    'stripe-runtime': (CANONICAL['runtime'], CANONICAL['transfer']),
    'stripe-maintenance': (
        main_suite('maintenance', 'maintenance', options=('--no-deps',)),
        main_suite('accessibility', 'accessibility'),
    ),
}
for project, total in [('chromium-heavy', 4), ('chromium', 6)]:
    for index in range(1, total + 1):
        name = f'{project}-{index}of{total}'
        LANES[name] = (
            main_suite(
                'e2e-' + name, project, options=(f'--shard={index}/{total}',), RC_GATE_STRIPE_EXCLUDE=STRIPE_FILTER
            ),
        )
for index in range(1, 5):
    name = f'stripe-browser-{index}of4'
    LANES[name] = (main_suite(name, 'chromium', 'chromium-heavy', options=(f'--shard={index}/4', STRIPE_FILTER)),)


def tests_in(report):
    def suite_tests(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec['tests']:
                    yield test['projectName'], spec['file'], spec['title'], spec['line'], test
            yield from suite_tests(suite.get('suites', []))

    return list(suite_tests(report['suites']))


def test_ids(report):
    return Counter(test[:-1] for test in tests_in(report))


def list_suite(suite):
    path = OUT / ('list-' + suite.name + '.json')
    with path.open('w') as report:
        require(
            'list-' + suite.name,
            suite.args() + ['--list', '--reporter=json'],
            ADMIN,
            LIST_ENV | {'RC_GATE_EVIDENCE': str(OUT)} | dict(suite.variables),
            stdout=report,
        )
    data = json.loads(path.read_text())
    assert not data.get('errors'), f'{suite.name}: collection errors'
    return data


def verify_result(suite, expected, report):
    tests = tests_in(report)
    stats = report['stats']
    passed = stats['expected']
    skipped = stats['skipped']
    bad = stats['unexpected'] + stats['flaky']
    completed = sum(bool(test.get('results')) for *_, test in tests)
    allowed = (
        0
        if suite == 'stripe'
        else sum(
            test['status'] == 'skipped' and (PurePosixPath(file).name, title) in ALLOWED_SKIPS
            for _, file, title, _, test in tests
        )
    )
    ok = (
        not report.get('errors')
        and expected > 0
        and len(tests) == completed == expected
        and passed + skipped == expected
        and not bad
        and allowed == skipped
    )
    return record(
        suite + '-count',
        int(not ok),
        expected=expected,
        passed=passed,
        skipped=skipped,
        unexpectedSkips=skipped - allowed,
        failedOrFlaky=bad,
        completed=completed,
    )


def run_browser(suite, inventory):
    from support import clean

    clean()
    path = OUT / (suite.name + '-report.json')
    extra = {
        'PW_TEST_REPORTER': 'json',
        'PLAYWRIGHT_JSON_OUTPUT_FILE': str(path),
        'RC_GATE_EVIDENCE': str(OUT),
        **dict(suite.variables),
    }
    options = ['--workers=1', '--retries=0', '--trace=off', '--reporter=list']
    if suite.driver == 'stripe':
        command = ['bash', 'scripts/run-stripe-live-e2e.sh', *options, '--max-failures=0']
        # The driver enables Stripe transport and starts its own servers.
        extra.pop('STRIPE_LIVE_E2E')
    elif suite.driver == 'runtime':
        command = ['node', str(RUNTIME / 'runtime-urls.mjs')]
    else:
        command = [*suite.args(), *options]
    run(suite.name, command, ADMIN, extra)
    if not path.is_file():
        record(suite.name + '-count', 1, expected=inventory[suite.name], reportMissing=True)
    else:
        verify_result(suite.name, inventory[suite.name], json.loads(path.read_text()))
