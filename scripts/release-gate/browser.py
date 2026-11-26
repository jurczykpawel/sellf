"""Shared browser plans for inventory and execution."""

from collections import Counter
from dataclasses import dataclass, replace

import json
from pathlib import Path, PurePosixPath
import re

from diagnostics import public_test_file, read_test_report, record_failures, test_identifier
from support import ADMIN, OUT, RUNTIME, env, record, require, run

MAIN_PROJECTS = ('chromium', 'chromium-heavy', 'maintenance', 'accessibility', 'rate-limiting', 'rate-limiting-v1')
ALLOWED_SKIPS = {
    ('offer-public.spec.ts', 'two production replicas bound lost invalidation and scheduled availability/sale'),
    ('payment-method-config-checkout.spec.ts', 'E2E-CHECKOUT-003: Stripe preset - Custom PMC'),
    ('variants-admin-ui.spec.ts', 'should toggle featured status'),
}
# These candidate specs exercise the sandbox directly or through the Sellf checkout. The second and third lines: paid
# checkout pages that only render their payment step with a working key (GHA 45596098511; variants-e2e in 45737339050
# and checkout-template-dispatch in 45752263064 showed "Payment Error" instead of the bump / OTO decline button).
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
checkout-theme-settings coupons funnel-mechanics funnel-test-preview funnel-test-redirect mobile-pwyw-cookies
variants-e2e checkout-template-dispatch
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
    # verify-payment answers 400 with the sandbox key but 500 with the fake one (GHA 45596098511: 0 successes).
    'stripe-rate-limiting': (
        main_suite('rate-limiting', 'rate-limiting', 'rate-limiting-v1', RATE_LIMIT_TEST_MODE='true'),
    ),
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
    # The JSON reporter writes to a file: config-time stdout (e.g. the dotenv 17 banner) must not
    # corrupt the listing, as it did on the first GHA run (JSONDecodeError in inventory).
    require(
        'list-' + suite.name,
        suite.args() + ['--list', '--reporter=json'],
        ADMIN,
        LIST_ENV | {'RC_GATE_EVIDENCE': str(OUT), 'PLAYWRIGHT_JSON_OUTPUT_FILE': str(path)} | dict(suite.variables),
    )
    data = json.loads(path.read_text())
    assert not data.get('errors'), f'{suite.name}: collection errors'
    return data


def failure_text(test):
    """Message and spec line of the first error in the last attempt; empty for skips."""
    for result in reversed(test.get('results') or []):
        errors = result.get('errors') or ([result['error']] if result.get('error') else [])
        if errors:
            line = (errors[0].get('location') or {}).get('line')
            return (f'line {line}: ' if line else '') + (errors[0].get('message') or '')
    return ''


PAGE_CUE = re.compile(r'^- (?:alert|status|dialog|heading|iframe|checkbox)\b|\[disabled\]|error|declin|fail|captcha|expire|invalid|limit|wygas|błąd|odrzuc', re.I)


def failure_context(test):
    """What the page showed when the last attempt failed: alert/status/heading/iframe lines of Playwright's
    error-context snapshot. GHA keeps no trace, so this is the only view of e.g. a checkout that never redirected."""
    for result in reversed(test.get('results') or []):
        for attachment in result.get('attachments') or []:
            if attachment.get('name') == 'error-context' and attachment.get('path'):
                try:
                    lines = Path(attachment['path']).read_text(errors='replace').splitlines()
                except OSError:
                    return ''
                # Only the page snapshot (```yaml block): error details and test source are already in testErrors.
                snapshot, inside = [], False
                for line in lines:
                    if line.startswith('```'):
                        inside = line.strip() == '```yaml'
                    elif inside:
                        snapshot.append(line.strip())
                cues = dict.fromkeys(line for line in snapshot if PAGE_CUE.search(line))
                return ' | '.join(cues)
        if result.get('errors') or result.get('error'):
            return ''
    return ''


def verify_result(suite, expected, report):
    tests = tests_in(report)
    stats = report['stats']
    passed = stats['expected']
    skipped = stats['skipped']
    bad = stats['unexpected'] + stats['flaky']
    completed = sum(bool(test.get('results')) for *_, test in tests)
    allowed = 0
    failures = []
    for project, file, title, line, test in tests:
        status = test['status']
        if status == 'skipped' and suite != 'stripe' and (PurePosixPath(file).name, title) in ALLOWED_SKIPS:
            allowed += 1
        elif status in ('unexpected', 'flaky', 'skipped'):
            failures.append((project, file, title, line, failure_text(test), failure_context(test)))
    ok = (
        not report.get('errors')
        and expected > 0
        and len(tests) == completed == expected
        and passed + skipped == expected
        and not bad
        and allowed == skipped
    )
    code = record(
        suite + '-count',
        int(not ok),
        expected=expected,
        passed=passed,
        skipped=skipped,
        unexpectedSkips=skipped - allowed,
        failedOrFlaky=bad,
        completed=completed,
    )
    root = Path(report.get('config', {}).get('rootDir', ADMIN))
    record_failures(
        suite,
        (
            (test_identifier(public_test_file(root / file), title, project, line), message, context)
            for project, file, title, line, message, context in failures
        ),
    )
    return code


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
    if suite.name == 'sections' and env.get('RC_GATE_SNAPSHOT_UPDATE'):
        options.append('--update-snapshots=' + env['RC_GATE_SNAPSHOT_UPDATE'])
    if suite.driver == 'stripe':
        # --global-timeout: end with a JSON report well inside the 90 min job limit (Mac: 15-23 min); a job
        # killed by its timeout leaves no receipt (run 45725081345).
        command = ['bash', 'scripts/run-stripe-live-e2e.sh', *options, '--max-failures=0', '--global-timeout=3000000']
        # The driver enables Stripe transport and starts its own servers.
        extra.pop('STRIPE_LIVE_E2E')
    elif suite.driver == 'runtime':
        command = ['node', str(RUNTIME / 'runtime-urls.mjs')]
    else:
        command = [*suite.args(), *options]
    expected = shard_expectation(suite, inventory, extra)
    run(suite.name, command, ADMIN, extra)
    report = read_test_report(path)
    if report is None:
        record(suite.name + '-count', 1, expected=expected, reportMissing=True)
        record_failures(suite.name, ())
    else:
        verify_result(suite.name, expected, report)


def shard_expectation(suite, inventory, extra):
    """Shard boundaries can move between the inventory job and a lane (GHA 45601171032: chromium shards 2-4
    shifted by 8-19 tests while their sum stayed equal). The lane lists its family and its shard in its own
    environment; the family must match the inventory total, and the shard listing becomes the exact expectation."""
    if not any(option.startswith('--shard=') for option in suite.options):
        return inventory[suite.name]
    family = suite.name.rsplit('-', 1)[0]
    family_total = sum(count for name, count in inventory.items() if re.fullmatch(re.escape(family) + r'-\d+of\d+', name))
    listing = {key: value for key, value in extra.items() if key not in ('PW_TEST_REPORTER', 'PLAYWRIGHT_JSON_OUTPUT_FILE')}
    whole = replace(suite, name=family + '-family', options=tuple(o for o in suite.options if not o.startswith('--shard=')))
    counts = {}
    for item in (whole, suite):
        path = OUT / ('lane-list-' + item.name + '.json')
        require('lane-list-' + item.name, item.args() + ['--list', '--reporter=json'], ADMIN,
                listing | {'PLAYWRIGHT_JSON_OUTPUT_FILE': str(path)})
        counts[item.name] = sum(1 for _ in tests_in(json.loads(path.read_text())))
    listed = counts[suite.name]
    record(suite.name + '-listing', int(counts[whole.name] != family_total), listed=listed,
           familyTotal=counts[whole.name], expected=family_total)
    return listed


REPEAT_SPEC = re.compile(r'(?:tests/)?[\w./-]+\.spec\.ts(?::\d+)?')


def repeat_arguments(specs, repeat):
    """Validated `only_spec` / `repeat_each` workflow inputs: spec files (optionally file:line), comma separated."""
    files = [item.strip() for item in specs.split(',') if item.strip()]
    assert files and len(files) <= 5 and all(REPEAT_SPEC.fullmatch(f) and '..' not in f for f in files), (
        'only_spec: up to 5 comma separated tests/<file>.spec.ts[:line]'
    )
    assert re.fullmatch(r'[1-9]\d?', repeat) and int(repeat) <= 50, 'repeat_each: a number from 1 to 50'
    return files, repeat


def run_repeat(specs, repeat):
    """Isolated repeat of chosen specs (the owner's rule for a single red test: 10-20 runs alone). Never a gate
    result: it is a diagnostic lane, and a failing test fails the lane."""
    from support import clean

    files, repeat = repeat_arguments(specs, repeat)
    clean()
    path = OUT / 'repeat-report.json'
    extra = {
        'PW_TEST_REPORTER': 'json',
        'PLAYWRIGHT_JSON_OUTPUT_FILE': str(path),
        'RC_GATE_EVIDENCE': str(OUT),
        'RATE_LIMIT_TEST_MODE': 'true',
    }
    suite = main_suite('repeat', 'chromium', 'chromium-heavy', options=(*files,))
    command = [
        *suite.args(), '--workers=1', '--retries=0', '--trace=off', '--reporter=list', '--repeat-each=' + repeat,
    ]
    run('repeat', command, ADMIN, extra)
    report = read_test_report(path)
    if report is None:
        record('repeat-count', 1, reportMissing=True)
        return
    stats = report['stats']
    tests = tests_in(report)
    failures = [
        (project, file, title, line, failure_text(test), failure_context(test))
        for project, file, title, line, test in tests
        if test['status'] in ('unexpected', 'flaky')
    ]
    record(
        'repeat-count',
        int(not tests or bool(stats['unexpected'] or stats['flaky'] or stats['skipped'])),
        repeatEach=int(repeat),
        tests=len(tests),
        passed=stats['expected'],
        skipped=stats['skipped'],
        failedOrFlaky=stats['unexpected'] + stats['flaky'],
    )
    root = Path(report.get('config', {}).get('rootDir', ADMIN))
    record_failures(
        'repeat',
        (
            (test_identifier(public_test_file(root / file), title, project, line), message, context)
            for project, file, title, line, message, context in failures
        ),
    )
