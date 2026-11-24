import re
import shutil

from support import ROOT
import tomllib


def prepare_stack(target):
    assert not target.exists(), 'Use a fresh stack directory'
    shutil.copytree(
        ROOT / 'supabase', target / 'supabase', ignore=shutil.ignore_patterns('.temp', '.branches', '__pycache__')
    )
    p = target / 'supabase/config.toml'
    s = re.sub(r'^project_id = .*$', 'project_id = "sellf-rcgate"', p.read_text(), flags=re.M)
    s = re.sub(r'5432[0-9]', lambda m: str(int(m[0]) + 1000), s)
    s = s.replace(
        '[auth]\n',
        '[auth]\njwt_secret = "env(RC_GATE_SUPABASE_JWT_SECRET)"\n'
        'publishable_key = "env(RC_GATE_SUPABASE_PUBLISHABLE_KEY)"\n'
        'secret_key = "env(RC_GATE_SUPABASE_SECRET_KEY)"\n',
    )
    s = s.replace('[auth.external.github]\nenabled = true', '[auth.external.github]\nenabled = false')
    p.write_text(s)
    config = tomllib.loads(s)
    assert config['project_id'] == 'sellf-rcgate'
    assert config['api']['port'] == 55321 and config['db']['port'] == 55322
    assert sorted(x.name for x in (target / 'supabase/tests').glob('*.sql')) == sorted(
        x.name for x in (ROOT / 'supabase/tests').glob('*.sql')
    )
    assert not re.search(r'5432[0-9]', s)
