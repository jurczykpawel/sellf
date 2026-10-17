"""Resolve direct SQL tests against the configured local API."""
import os
import re
import subprocess
from urllib.parse import urlparse


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
