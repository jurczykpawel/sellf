"""Remove runner-owned app configuration and stop the runner-owned stack."""

from support import ADMIN, CLI, STACK, record, run


def cleanup(remove_app_env):
    code = 0
    if STACK.exists():
        code = run('final-stop', [CLI, 'stop', '--project-id', 'sellf-rcgate', '--no-backup', '--workdir', str(STACK)])
    if remove_app_env:
        (ADMIN / '.env.local').unlink(missing_ok=True)
    record('final-cleanup', code)
