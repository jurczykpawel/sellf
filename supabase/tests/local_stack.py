"""Resolve direct SQL tests against the configured local API."""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


def get_test_database_container():
    configured = os.environ.get('SUPABASE_DB_CONTAINER')
    if configured and not re.fullmatch(r'supabase_db_[a-zA-Z0-9_-]+', configured):
        raise ValueError('Invalid test database container')
    urls = [urlparse(value) for value in [os.environ.get('SUPABASE_URL'), os.environ.get('NEXT_PUBLIC_SUPABASE_URL')] if value]
    if not urls:
        urls = [urlparse('http://127.0.0.1:54321')]
    if any(url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1') for url in urls):
        raise ValueError('Direct SQL tests require a local API')
    if any(url.port != urls[0].port for url in urls):
        raise ValueError('Tests must use the same local API')
    names = subprocess.check_output(['docker', 'ps', '--filter', f'publish={urls[0].port or 80}', '--format', '{{.Names}}'], text=True, timeout=10).splitlines()
    names = [name for name in names if re.fullmatch(r'supabase_kong_[a-zA-Z0-9_-]+', name)]
    if len(names) != 1:
        raise ValueError('Expected one local API container for the configured port')
    expected = names[0].replace('supabase_kong_', 'supabase_db_', 1)
    if configured and configured != expected:
        raise ValueError('Test database container does not match the configured API')
    return expected


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


urlopen = build_opener(ProxyHandler({}), _NoRedirects()).open


def _configured_api(value):
    parsed = urlparse(value or '')
    if (not value or any(ord(char) <= 32 or ord(char) == 127 for char in value)
            or parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1')
            or parsed.username or parsed.password or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment):
        raise ValueError('Expected the configured local test API')
    return parsed


def wait_for_test_api(api_url, service_key, timeout=30, interval=0.25):
    """Wait for read-only Auth and REST responses before acceptance calls."""
    _configured_api(api_url)
    if api_url != os.environ.get('SUPABASE_URL') or not service_key or timeout <= 0 or interval <= 0:
        raise ValueError('Expected the configured local test API and service key')
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            for path in ('/auth/v1/health', '/rest/v1/admin_users?select=id&limit=0'):
                request = Request(api_url.rstrip('/') + path, headers={
                    'apikey': service_key, 'Authorization': 'Bearer ' + service_key,
                }, method='GET')
                with urlopen(request, timeout=min(2, max(0.1, deadline - time.monotonic()))) as response:
                    if response.status != 200:
                        raise ValueError('Unexpected local API readiness response')
                    response.read()
            return
        except HTTPError as error:
            error.close()
            if not 500 <= error.code < 600:
                raise
            last_error = error
        except OSError as error:
            last_error = error
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(interval, remaining))
    raise TimeoutError('Local Auth and REST did not become ready') from last_error


def _test_project(workdir):
    folder = Path(workdir).resolve()
    config = (folder/'supabase/config.toml').read_text()
    project = re.search(r'^project_id\s*=\s*"([a-zA-Z0-9_-]+)"', config, re.M)
    port = re.search(r'\[api\][\s\S]*?^port\s*=\s*(\d+)', config, re.M)
    api_url = os.environ.get('SUPABASE_URL')
    api = _configured_api(api_url)
    if not project or project[1] == 'sellf' or not port or api.port != int(port[1]):
        raise ValueError('Expected a matching disposable test project')
    if get_test_database_container() != 'supabase_db_' + project[1]:
        raise ValueError('Test project does not match the configured API')
    return folder, project[1], api_url


def wait_for_test_stack(workdir):
    """Check the matching project's live Auth and REST routes."""
    folder, _, api_url = _test_project(workdir)
    cli = os.environ.get('SUPABASE_CLI_BINARY_OVERRIDE', 'supabase')
    status = subprocess.run([cli, 'status', '--workdir', str(folder), '-o', 'json'], check=True, capture_output=True, text=True, timeout=30)
    settings = json.loads(status.stdout)
    if settings['API_URL'] != api_url:
        raise ValueError('Test API configuration changed during setup')
    wait_for_test_api(api_url, settings['SERVICE_ROLE_KEY'])


def reset_test_database(workdir):
    """Reset a matching disposable project with its partition writer stopped."""
    folder, project, _ = _test_project(workdir)
    writer = 'supabase_realtime_' + project
    state = subprocess.run(['docker', 'inspect', '--format', '{{.State.Running}}', writer], capture_output=True, text=True, timeout=10)
    if state.returncode:
        if not re.search(r'No such (?:object|container)', state.stderr, re.I):
            state.check_returncode()
        running = None
    else:
        if state.stdout.strip() not in ('true', 'false'):
            raise ValueError('Unexpected local writer state')
        running = state.stdout.strip() == 'true'
    cli = os.environ.get('SUPABASE_CLI_BINARY_OVERRIDE', 'supabase')
    try:
        if running:
            subprocess.run(['docker', 'stop', writer], check=True, timeout=30)
        subprocess.run([cli, 'db', 'reset', '--local', '--workdir', str(folder)], check=True, timeout=120)
    finally:
        if running is not None:
            subprocess.run(['docker', 'start' if running else 'stop', writer], check=True, timeout=30)
    # The gateway caches upstream addresses across the service restarts above.
    subprocess.run(['docker', 'exec', 'supabase_kong_' + project, 'kong', 'reload', '--nginx-conf', '/home/kong/custom_nginx.template'], check=True, timeout=30)
    wait_for_test_stack(str(folder))


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('reset', 'ready'):
        raise SystemExit('Usage: local_stack.py <reset|ready> <disposable-workdir>')
    (reset_test_database if sys.argv[1] == 'reset' else wait_for_test_stack)(sys.argv[2])
