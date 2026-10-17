"""D-057: real hosted RPC regression and reference-extension parity.

For Phase 2 add --phase2 to each command (isolated sellf-p2d057, 55440-55449).
Run from the repository root:
  python3 supabase/tests/jsonschema-regression.py --prepare
  python3 supabase/tests/jsonschema-regression.py --rpc
  python3 supabase/tests/jsonschema-regression.py --parity

--prepare copies only pre-RC migrations into /private/tmp/sellf-rcjson and starts
the isolated project (55320-55329). --rpc requires that pristine pre-RC state;
it never resets a database. --parity installs pg_jsonschema only in this TEST
harness, using supabase_admin; neither the RPC nor its owner gets superuser.
All commands are guarded against the shared project. Credentials are not logged.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PHASE2 = False
WORK = Path('/private/tmp/sellf-rcjson')
CONTAINER = 'supabase_db_sellf-rcjson'
VERSION = '20261016000000_release_2026_10_6'
MIGRATION = ROOT / 'supabase/migrations' / (VERSION + '.sql')


def load_gate():
    while os.getloadavg()[0] > 28:
        print(f'Waiting: 1-minute load {os.getloadavg()[0]:.2f} > 28', flush=True)
        time.sleep(20)


def sql(source, admin=False, progress=None):
    load_gate()
    command = ['docker', 'exec', '-i', CONTAINER]
    if admin:
        command += ['sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -U supabase_admin -d postgres -At -v ON_ERROR_STOP=1']
    else:
        command += ['psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']
    if progress:
        with progress.open('w') as log:
            with source.open() as corpus:
                result = subprocess.run(command, stdin=corpus, text=True, stdout=log, stderr=subprocess.PIPE, timeout=3600)
        output = progress.read_text()
    else:
        result = subprocess.run(command, input=source, text=True, capture_output=True, timeout=300)
        output = result.stdout
    if result.returncode:
        raise RuntimeError(result.stderr)
    return output.strip()


def check_stack():
    config = (WORK / 'supabase/config.toml').read_text()
    assert f'project_id = "{PROJECT}"' in config and f'port = {API_PORT}' in config
    containers = subprocess.check_output(['docker', 'ps', '--filter', f'publish={API_PORT}', '--format', '{{.Names}}'], text=True).splitlines()
    assert containers == [f'supabase_kong_{PROJECT}'], containers
    assert sql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user;") == 'f'
    assert sql("SELECT r.rolsuper FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='public.apply_migration(text,text,text)'::regprocedure;") == 'f'
    assert sql("SELECT count(*) FROM pg_roles WHERE rolsuper AND pg_has_role('postgres',oid,'MEMBER');") == '0'
    assert sql("SELECT rolsuper FROM pg_roles WHERE rolname='service_role';") == 'f'
    assert sql("SELECT count(*) FROM pg_roles WHERE rolsuper AND pg_has_role('service_role',oid,'MEMBER');") == '0'


def prepare():
    load_gate()
    assert not (WORK / 'supabase/config.toml').exists(), 'Use a fresh workdir; refusing to overwrite a stack'
    (WORK / 'supabase/migrations').mkdir(parents=True, exist_ok=True)
    config = (ROOT / 'supabase/config.toml').read_text().replace('project_id = "sellf"', f'project_id = "{PROJECT}"')
    for i in range(10):
        config = config.replace(str(54320 + i), str(API_PORT - 1 + i))
    config = config.replace('enabled = true\nclient_id = "env(GITHUB_CLIENT_ID)"', 'enabled = false\nclient_id = "env(GITHUB_CLIENT_ID)"')
    (WORK / 'supabase/config.toml').write_text(config)
    shutil.copytree(ROOT / 'supabase/templates', WORK / 'supabase/templates')
    for migration in (ROOT / 'supabase/migrations').glob('*.sql'):
        if migration.name < VERSION:
            shutil.copy(migration, WORK / 'supabase/migrations' / migration.name)
    with (WORK / 'start.log').open('w') as log:
        result = subprocess.run(['supabase', 'start', '--workdir', str(WORK)], stdout=log, stderr=subprocess.STDOUT)
    assert result.returncode == 0, 'See isolated start.log'
    print('PASS isolated pre-RC stack started')


def rpc():
    check_stack()
    assert sql("SELECT count(*) FROM pg_extension WHERE extname='pg_jsonschema';") == '0'
    assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000000';") == '0'
    assert sql("SELECT to_regclass('public.storefront_config') IS NULL;") == 't'
    status = json.loads(subprocess.check_output(['supabase', 'status', '--workdir', str(WORK), '-o', 'json'], stderr=subprocess.DEVNULL))
    assert status['API_URL'] == f'http://127.0.0.1:{API_PORT}'

    def apply(version, source):
        body = json.dumps(dict(migration_version=version, migration_sql=source, content_checksum=hashlib.sha256(source.encode()).hexdigest())).encode()
        request = urllib.request.Request(status['API_URL'] + '/rest/v1/rpc/apply_migration', body, headers={
            'apikey': status['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + status['SERVICE_ROLE_KEY'], 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    code, payload = apply('20261015999999_forbidden_extension_probe', 'CREATE EXTENSION pg_jsonschema WITH SCHEMA extensions;')
    assert code == 403 and payload['code'] == '42501' and 'pg_jsonschema' in payload['message'], payload
    assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261015999999';") == '0'
    assert sql("SELECT to_regclass('public.storefront_config') IS NULL;") == 't'
    print('PASS negative control: service_role RPC cannot CREATE EXTENSION pg_jsonschema (403/42501)')
    migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql')) if PHASE2 else [MIGRATION]
    migrations = [migration for migration in migrations if migration.name >= MIGRATION.name]
    assert len(migrations) == (9 if PHASE2 else 1), [m.name for m in migrations]
    for migration in migrations:
        source = migration.read_bytes().decode('utf-8')
        assert 'jsonb_matches_schema' not in source
        assert not re.search(r'CREATE\s+EXTENSION[^;]*pg_jsonschema', source, re.I)
        version = migration.stem
        assert sql(f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{version[:14]}';") == '0'
        code, payload = apply(version, source)
        assert code == 200 and payload['success'] is True and payload['skipped'] is False, (version, payload)
        code, repeated = apply(version, source)
        assert code == 200 and repeated['success'] is True and repeated['skipped'] is True, (version, repeated)
        assert sql(f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{version[:14]}';") == '1'
        assert sql("SELECT count(*) FROM pg_extension WHERE extname='pg_jsonschema';") == '0'
        assert sql("SELECT public.storefront_config_valid(published) FROM public.storefront_config;") == 't'
        print('PASS exact migration + idempotency via actual non-superuser service_role RPC:', version, payload, flush=True)
    assert sql("SELECT count(*) FROM pg_statistic_ext WHERE stxnamespace='public'::regnamespace AND stxname='storefront_products_name';") == '1'
    if PHASE2:
        for template in ('storefront-a', 'storefront-b', 'storefront-c'):
            assert sql("SELECT public.storefront_config_valid(jsonb_build_object('format',1,'templateId','" + template + "','settingsByTemplate','{}'::jsonb,'overridesByTemplate','{}'::jsonb,'content','{}'::jsonb,'tokens',null));") == 't'
        assert sql("SELECT public.product_offer_config_valid('{\"format\":1,\"enabled\":true,\"templateId\":\"offer-default\",\"settings\":{\"density\":\"comfortable\"},\"content\":{},\"tokens\":null}');") == 't'
        print('PASS A/B/C and offer wrappers after the complete hosted-path chain; pg_jsonschema absent', flush=True)


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace("'", "''") + "'"


def example(schema, full=False):
    if 'const' in schema:
        return schema['const']
    if 'enum' in schema:
        return schema['enum'][0]
    if 'anyOf' in schema:
        return example(schema['anyOf'][0], full)
    kind = schema.get('type')
    if kind == 'object':
        return {key: example(child, full) for key, child in schema.get('properties', {}).items() if full or key in schema.get('required', [])}
    if kind == 'array':
        count = max(schema.get('minItems', 0), 1 if full and schema.get('maxItems', 1) else 0)
        values = [example(schema['items'], full) for _ in range(count)]
        if schema.get('uniqueItems') and schema['items'].get('format') == 'uuid':
            values = [value[:-12] + f'{index:012x}' for index, value in enumerate(values)]
        return values
    if kind == 'string':
        pattern = schema.get('pattern', '')
        if pattern.startswith('^https:'):
            return 'https://example.com/project'
        if pattern.startswith('^#'):
            return '#12aBcF'
        if schema.get('format') == 'uuid':
            return '12345678-1234-4123-8123-123456789abc'
        return 'safe-text'
    return {'number': 1, 'integer': 1, 'boolean': True, 'null': None}.get(kind)


def parity():
    check_stack()
    # This is the sole extension installation in the TEST harness, after RPC proof.
    sql('CREATE EXTENSION IF NOT EXISTS pg_jsonschema WITH SCHEMA extensions;', admin=True)
    assert sql("SELECT extversion FROM pg_extension WHERE extname='pg_jsonschema';") == '0.3.3', 'Review translations before changing the reference version'
    sources = [MIGRATION]
    if PHASE2:
        sources += [ROOT / 'supabase/migrations' / name for name in (
            '20261016223736_storefront_a_contract.sql', '20261017014729_storefront_b_contract.sql',
            '20261017030527_storefront_c_contract.sql', '20261016232157_product_offer_snapshots.sql')]
    source = '\n'.join(path.read_text() for path in sources)
    schemas = [json.loads(value.replace("''", "'")) for value in re.findall(r"AS \$schema\$ SELECT (?:public\.jsonschema_subset_matches\()?'((?:''|[^'])*)'::json", source)]
    assert len(schemas) == (6 if PHASE2 else 2)
    # Stream the expanded complete-schema corpus; retaining every deep copy in
    # memory makes A/B/C ancestor mutations unnecessarily expensive.
    corpus = WORK / 'parity-corpus.sql'
    cases = 0
    identifiers = {}
    script = corpus.open('w')
    script.write("BEGIN; SET LOCAL statement_timeout='240s'; CREATE TEMP TABLE schemas(id int PRIMARY KEY,schema json); CREATE TEMP TABLE parity(id serial,label text,schema_id int,instance jsonb,expected boolean);\n")

    def add(label, schema, instance, expected=None):
        nonlocal cases
        key = json.dumps(schema, sort_keys=True)
        if key not in identifiers:
            identifiers[key] = len(identifiers)
            script.write(f'INSERT INTO schemas VALUES ({identifiers[key]},{literal(schema)}::json);\n')
        script.write(f"INSERT INTO parity(label,schema_id,instance,expected) VALUES ('{label.replace(chr(39), chr(39)*2)}',{identifiers[key]},{literal(instance)}::jsonb,{'NULL' if expected is None else str(expected)});\n")
        cases += 1

    nodes = {}

    def collect(schema):
        nodes[json.dumps(schema, sort_keys=True)] = schema
        for child in schema.get('properties', {}).values():
            collect(child)
        for child in schema.get('anyOf', []):
            collect(child)
        for key in ('items', 'additionalProperties'):
            if isinstance(schema.get(key), dict):
                collect(schema[key])

    for schema in schemas:
        collect(schema)
    for index, schema in enumerate(nodes.values()):
        for full in (False, True):
            value = example(schema, full)
            add(f'node {index} valid full={full}', schema, value, True)
            if isinstance(value, dict):
                add(f'node {index} extra property', schema, dict(value, extra=True))
                for required in schema.get('required', []):
                    broken = dict(value)
                    broken.pop(required, None)
                    add(f'node {index} missing {required}', schema, broken, False)
        for invalid in (None, True, 0, 1.5, '', {}, [], ['duplicate', 'duplicate']):
            add(f'node {index} type/const/enum', schema, invalid)
        if 'maxLength' in schema:
            for size in (schema['maxLength'] - 1, schema['maxLength'], schema['maxLength'] + 1):
                for char in ('x', 'ą', '😀', '\n'):
                    add(f'node {index} length {size}', schema, char * size)
        if 'minItems' in schema:
            for count in (schema['minItems'] - 1, schema['minItems'], schema['minItems'] + 1):
                add(f'node {index} minItems {count}', schema, [example(schema['items'])] * count)
        if 'maxItems' in schema:
            for count in (schema['maxItems'], schema['maxItems'] + 1):
                add(f'node {index} items {count}', schema, [example(schema['items'])] * count)

    patterns = {node['pattern'] for node in nodes.values() if 'pattern' in node}
    assert len(patterns) == (7 if PHASE2 else 5), patterns
    strings = ['', 'plain prose', 'a', 'a-b', '#12aBcF', '#abcdef', '#ABCDEF', '12345678-1234-4123-8123-123456789abc',
               '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
               'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', '12345678-1234-0123-8123-123456789abc',
               '<b>text</b>', '<\n>', '<unfinished', '>', 'https://site.test', 'http:foo', 'HTTPS:foo', 'ftp:', 'javascript:',
               'data:', 'mailto:', '://', 'www.', 'WwW.', '10 PLN', '$12', '€1', '£2', '1zł', '1EUR', '1usd',
               'https://example.com/project', 'https://example.com:443/a-b_2', 'http://example.com',
               'https://user@example.com', 'https://example.com:444', 'https://example.com/?x=1',
               'https://example.com/#x', 'https://example.com/path.ext', 'https://a.b.c/a',
               'https://-bad.com', 'https://bad-.com', 'https://localhost', 'https://127.0.0.1',
               'https://UPPER.com', 'https://éxample.com', 'https://example.com/a%20b',
               'Zażółć gęślą', 'é', 'e\u0301', '😀', '\\n', '\\uFEFF', "'\\\"$&$1", 'a' * 64, 'a' * 65, 'İ', 'ſ', 'K', '１２', '١']
    whitespace = [chr(cp) for cp in list(range(1, 34)) + [133, 160, 5760, 6158, *range(8192, 8204), 8232, 8233, 8239, 8287, 12288, 65279, 65533]]
    for char in whitespace + ['😀', 'é', '\\', '١', '१', '１']:
        strings += [char, 'a' + char, char + 'a', '$' + char + '1', '1' + char + 'PLN', '<' + char + '>', 'x' + char + 'https:']
    strings += [prefix + value + suffix for value in strings[:40] for prefix, suffix in [('', '\n'), ('\n', ''), ('', '\r\n'), ('', '\u2028'), ('', '\\n')]]
    for pattern in patterns:
        for value in strings:
            add('pattern adversary ' + repr(value), {'type': 'string', 'pattern': pattern}, value)

    # Mutate every nested value in complete config and marketing examples, so
    # leaf checks are also exercised through their production ancestor schemas.
    def paths(value, path=()):
        yield path, value
        if isinstance(value, dict):
            for key, child in value.items():
                yield from paths(child, path + (key,))
        elif isinstance(value, list):
            for key, child in enumerate(value):
                yield from paths(child, path + (key,))

    for index, schema in enumerate(schemas):
        base = example(schema, True)
        for path, original in paths(base):
            replacements = [None, False, 2, [], {}, 'unexpected']
            if isinstance(original, str):
                replacements += strings
            for replacement in replacements:
                value = copy.deepcopy(base)
                parent = value
                for key in path[:-1]:
                    parent = parent[key]
                if path:
                    parent[path[-1]] = replacement
                else:
                    value = replacement
                add(f'full schema {index} path {path}', schema, value)

    # Keyword behavior independent of the emitted schemas, including annotations.
    for schema, values in [({'type': 'integer'}, [1, 1.0, 1.5, '1']), ({'format': 'uuid'}, ['bad', None, 1]),
                           ({'default': {'unknown': True}}, [None, {}, []]),
                           ({'uniqueItems': True}, [[1, 1.0], [{'a': 1, 'b': 2}, {'b': 2, 'a': 1}], [True, 1], [None, None]]),
                           ({'additionalProperties': {'type': 'string'}}, [{}, {'a': 'yes'}, {'a': False}]),
                           ({'required': ['missing']}, [{}, None, 1])]:
        for value in values:
            add('keyword semantics', schema, value)
    compare = ["CREATE TEMP TABLE compared(label text,schema_id int,instance jsonb,expected boolean,actual boolean,reference boolean); CREATE TEMP TABLE totals(cases int, valid int, invalid int);"]
    # Keep every corpus member and every assertion. Batches retain a strict
    # statement timeout, fail on the first mismatch and bound temporary storage.
    for first in range(1, cases + 1, 1000):
        last = min(first + 999, cases)
        compare.append(f"""
INSERT INTO compared SELECT label,schema_id,instance,expected,
 public.jsonschema_subset_matches(schema,instance),
 extensions.jsonb_matches_schema(schema,instance)
FROM parity JOIN schemas ON schemas.id=parity.schema_id WHERE parity.id BETWEEN {first} AND {last};
DO $$ DECLARE mismatch record; BEGIN
 SELECT compared.*,schema INTO mismatch FROM compared JOIN schemas ON schemas.id=compared.schema_id
 WHERE actual IS DISTINCT FROM reference OR (expected IS NOT NULL AND actual IS DISTINCT FROM expected) LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'PARITY MISMATCH: %',row_to_json(mismatch); END IF;
END; $$;
INSERT INTO totals SELECT count(*),count(*) FILTER(WHERE actual),count(*) FILTER(WHERE NOT actual) FROM compared;
TRUNCATE compared;
\\echo Compared {last}/{cases} cases
""")
    compare.append("""
DO $$ BEGIN
 IF (SELECT sum(valid)=0 OR sum(invalid)=0 FROM totals) THEN RAISE EXCEPTION 'Missing positive/negative coverage'; END IF;
END; $$;
SELECT json_build_object('cases',sum(cases),'valid',sum(valid),'invalid',sum(invalid)) FROM totals;
ROLLBACK;
""")
    print(f'Comparing {cases} cases over {len(identifiers)} schemas', flush=True)
    script.write('\n'.join(compare))
    script.close()
    output = sql(corpus, progress=WORK / 'parity-progress.log')
    print('PASS parity:', output.splitlines()[-2], f'; all {len(patterns)} emitted patterns, {len(schemas)} complete wire schemas, Unicode/newline/escape adversaries')



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase2', action='store_true', help='Use sellf-p2d057 on 55440-55449 and prove the complete Phase 2 chain')
    group = parser.add_mutually_exclusive_group(required=True)
    for phase in ('prepare', 'rpc', 'parity'):
        group.add_argument('--' + phase, action='store_true')
    args = parser.parse_args()
    PHASE2 = args.phase2
    PROJECT = 'sellf-p2d057' if PHASE2 else 'sellf-rcjson'
    API_PORT = 55441 if PHASE2 else 55321
    WORK = Path('/private/tmp') / PROJECT
    CONTAINER = 'supabase_db_' + PROJECT
    if args.prepare:
        prepare()
    elif args.rpc:
        rpc()
    else:
        parity()
