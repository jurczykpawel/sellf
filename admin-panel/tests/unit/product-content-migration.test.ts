import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateUpdateProduct } from '@/lib/validations/product';
import { getTestDatabaseContainer } from '../helpers/database-container';

it('normalizes stored content links while preserving content metadata and policies', () => {
  const acceptedUrls = ["  https://drive.google.com/file/with space  ", "https:drive.google.com/file/relative", "ht\ttps://drive.google.com/file/tab"];
  for (const url of acceptedUrls) expect(validateUpdateProduct({ content_config: { content_items: [{ type: 'download_link', config: { download_url: url } }] } }).isValid).toBe(true);
  const fixture = readFileSync('tests/fixtures/product-content-cleanup.sql', 'utf8')
    .replace('CREATE TABLE public.products', 'CREATE TEMP TABLE products').replaceAll('public.products', 'pg_temp.products');
  const migration = readFileSync('../supabase/migrations/20261108170000_product_content_url_cleanup.sql', 'utf8').replaceAll('public.products', 'pg_temp.products');
  const query = `BEGIN; ${fixture} ${migration}
    DO $$ BEGIN
      IF (SELECT content_config #>> '{content_items,0,config,download_url}' FROM pg_temp.products WHERE id=1) IS DISTINCT FROM '' THEN RAISE EXCEPTION 'Expected empty link'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,download_url}' FROM pg_temp.products WHERE id=2) IS DISTINCT FROM 'https://drive.google.com/file/1' THEN RAISE EXCEPTION 'Expected moved link'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,download_url}' FROM pg_temp.products WHERE id=3) IS DISTINCT FROM 'https://drive.google.com/file/2' THEN RAISE EXCEPTION 'Expected canonical link'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,file_name}' FROM pg_temp.products WHERE id=1) IS DISTINCT FROM 'guide.pdf' THEN RAISE EXCEPTION 'Expected file metadata'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,autoplay}' FROM pg_temp.products WHERE id=4) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Expected player flags'; END IF;
      IF (SELECT content_config #>> '{content_items,1,content}' FROM pg_temp.products WHERE id=4) IS DISTINCT FROM 'keep' THEN RAISE EXCEPTION 'Expected text content'; END IF;
      IF EXISTS(SELECT 1 FROM pg_temp.products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.content_config->'content_items','[]')) item WHERE (item->>'type'='download_link' AND item->'config' ? 'embed_url') OR (item->>'type'='video_embed' AND item->'config' ? 'download_url')) THEN RAISE EXCEPTION 'Unexpected config key'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,download_url}' FROM pg_temp.products WHERE id=8) IS DISTINCT FROM 'HTTPS://drive.google.com/file/upper' THEN RAISE EXCEPTION 'Expected mixed-case protocol preserved'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,download_url}' FROM pg_temp.products WHERE id=9) IS DISTINCT FROM '  https://drive.google.com/file/with space  ' THEN RAISE EXCEPTION 'Expected accepted stored URL preserved'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,embed_url}' FROM pg_temp.products WHERE id=7) IS DISTINCT FROM '' THEN RAISE EXCEPTION 'Expected supported content scheme'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,download_url}' FROM pg_temp.products WHERE id=10) IS DISTINCT FROM 'https:drive.google.com/file/relative' THEN RAISE EXCEPTION 'Expected accepted URL notation preserved'; END IF;
      IF (SELECT content_config #>> '{content_items,0,config,download_url}' FROM pg_temp.products WHERE id=11) IS DISTINCT FROM ('ht'||chr(9)||'tps://drive.google.com/file/tab') THEN RAISE EXCEPTION 'Expected accepted URL whitespace preserved'; END IF;
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='pg_temp.products'::regclass) THEN RAISE EXCEPTION 'Expected policies preserved'; END IF;
    END $$;
    CREATE TEMP TABLE expected AS SELECT * FROM pg_temp.products;
    ${migration}
    DO $$ BEGIN IF EXISTS(SELECT * FROM pg_temp.products EXCEPT SELECT * FROM expected) THEN RAISE EXCEPTION 'Expected stable second application'; END IF; END $$;
    ROLLBACK;`;
  const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  expect(result).toContain('ROLLBACK');
});
