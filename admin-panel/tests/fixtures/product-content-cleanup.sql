-- Used with a transactional temporary table by product-content-migration.test.ts.
CREATE TABLE public.products (id integer PRIMARY KEY, content_config jsonb);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY content_cleanup_test ON public.products FOR SELECT USING (false);
INSERT INTO public.products VALUES
(1, '{"content_items":[{"id":"bad","type":"download_link","config":{"embed_url":"javascript:alert(1)","file_name":"guide.pdf"}}]}'),
(2, '{"content_items":[{"id":"move","type":"download_link","config":{"embed_url":"https://drive.google.com/file/1"}}]}'),
(3, '{"content_items":[{"id":"keep","type":"download_link","config":{"embed_url":"javascript:alert(1)","download_url":"https://drive.google.com/file/2"}}]}'),
(4, '{"content_items":[{"id":"video","type":"video_embed","config":{"embed_url":"https://youtu.be/123","download_url":"javascript:x","autoplay":true}},{"type":"text","content":"keep"}]}'),
(5, '{"content_items":[]}'), (6, '{"redirect_url":"/p/keep"}'),
(7, '{"content_items":[{"type":"video_embed","config":{"embed_url":"data:text/html,x"}}]}'),
(8, '{"content_items":[{"type":"download_link","config":{"download_url":"HTTPS://drive.google.com/file/upper"}}]}'),
(9, '{"content_items":[{"type":"download_link","config":{"download_url":"  https://drive.google.com/file/with space  "}}]}'),
(10, '{"content_items": [{"type": "download_link", "config": {"download_url": "https:drive.google.com/file/relative"}}]}'),
(11, '{"content_items": [{"type": "download_link", "config": {"download_url": "ht\ttps://drive.google.com/file/tab"}}]}');
