/** Convert the reviewed Next-rendered subtree into portable inert evidence. @see preview-render.tsx */
import { Fragment } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { fromHtml } from 'hast-util-from-html';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

type HtmlNode = ReturnType<typeof fromHtml>['children'][number];
export async function extractPreviewDocument(raw: string, imageUrls: ReadonlySet<string>): Promise<{ body: string; stylesheets: string[] }> {
  const tree = fromHtml(raw);
  let shell: HtmlNode | undefined;
  let fonts: string[] = [];
  const sheets = new Set<string>();
  function visit(node: HtmlNode): void {
    if (node.type !== 'element') return;
    if (node.properties['dataPreviewFailure']) throw new Error('Preview document is unavailable');
    if (node.tagName === 'body' && Array.isArray(node.properties.className)) fonts = node.properties.className.map(String);
    if (Array.isArray(node.properties.className) && node.properties.className.includes('sf-public-theme')) shell = node;
    if (node.tagName === 'link' && (node.properties.rel as string[] | undefined)?.includes('stylesheet')) sheets.add(String(node.properties.href));
    for (const child of node.children) visit(child);
  }
  tree.children.forEach(visit);
  if (!shell || shell.type !== 'element' || sheets.size === 0 || sheets.size > 16) throw new Error('Missing preview document');
  function inert(node: HtmlNode): void {
    if (node.type !== 'element') return;
    node.children = node.children.filter(child => child.type === 'text' || child.type === 'element' && !['script', 'style', 'link', 'iframe', 'object', 'embed', 'meta'].includes(child.tagName)) as typeof node.children;
    const props = node.properties;
    if (node.tagName === 'select') {
      const selected = node.children.find(option => option.type === 'element' && option.tagName === 'option' && option.properties.selected);
      if (selected?.type === 'element') props.defaultValue = selected.properties.value;
    }
    if (node.tagName === 'option') delete props.selected;
    node.children.forEach(inert);
    for (const key of Object.keys(props)) if (/^on/i.test(key) || ['href', 'action', 'formAction', 'target', 'srcSet', 'style', 'ping', 'autoFocus'].includes(key)) delete props[key];
    if (node.tagName === 'img' && !imageUrls.has(String(props.src))) throw new Error('Missing preview image');
    if (node.tagName !== 'img') delete props.src;
    if (node.tagName === 'form') { node.tagName = 'div'; delete props.method; }
    if (node.tagName === 'a') { props.role = 'link'; props.ariaDisabled = 'true'; }
    if (['button', 'input', 'select', 'textarea', 'fieldset'].includes(node.tagName)) props.disabled = true;
  }
  inert(shell);
  // Only native elements reach this serializer; client sections have already rendered in Next.
  const { renderToStaticMarkup } = await import('react-dom/server');
  const body = renderToStaticMarkup(toJsxRuntime({ type: 'root', children: [{ type: 'element', tagName: 'div', properties: { className: ['sf-preview-frame'] }, children: [{ type: 'element', tagName: 'div', properties: { className: fonts }, children: [shell] }] }] }, { Fragment, jsx, jsxs }));
  return { body, stylesheets: [...sheets] };
}
