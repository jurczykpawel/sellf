-- Normalize stored content URLs and preserve item metadata.
WITH repaired AS (
  SELECT p.id, jsonb_agg(
    CASE WHEN item->>'type' IN ('video_embed', 'download_link')
                   AND jsonb_typeof(item->'config') = 'object'
      THEN jsonb_set(item, '{config}',
        ((item->'config') - 'embed_url' - 'download_url') || jsonb_build_object(
          keys.canonical,
          CASE
            WHEN translate(item->'config'->>keys.canonical, chr(9)||chr(10)||chr(13), '') ~* '^[[:cntrl:][:space:]]*https:'
              THEN item->'config'->>keys.canonical
            WHEN coalesce(item->'config'->>keys.canonical, '') ~ '^[[:cntrl:][:space:]]*$'
                 AND translate(item->'config'->>keys.previous, chr(9)||chr(10)||chr(13), '') ~* '^[[:cntrl:][:space:]]*https:'
              THEN item->'config'->>keys.previous
            ELSE ''
          END))
      ELSE item END ORDER BY position
    ) AS items
  FROM public.products p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.content_config->'content_items') = 'array'
      THEN p.content_config->'content_items' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS entries(item, position)
  CROSS JOIN LATERAL (SELECT
    CASE WHEN item->>'type' = 'download_link' THEN 'download_url' ELSE 'embed_url' END AS canonical,
    CASE WHEN item->>'type' = 'download_link' THEN 'embed_url' ELSE 'download_url' END AS previous
  ) keys
  GROUP BY p.id
)
UPDATE public.products p
SET content_config = jsonb_set(p.content_config, '{content_items}', repaired.items)
FROM repaired
WHERE p.id = repaired.id
  AND p.content_config->'content_items' IS DISTINCT FROM repaired.items;
