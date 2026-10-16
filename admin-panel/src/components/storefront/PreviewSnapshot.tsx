/** Reviewed section SSR converted to a portable inert document. @see preview.ts */
import { createElement, Fragment } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { fromHtml } from 'hast-util-from-html';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import PublicThemeShell from '@/components/storefront/PublicThemeShell';
import { publicThemeCSS } from '@/lib/storefront-templates/public-theme';
import type { Element, Root, RootContent } from 'hast';
import type { PresentationModel } from '@/lib/storefront-templates/resolver';
import type { PublicThemeTokens } from '@/lib/storefront-templates/schemas';
import type { PreviewResult } from '@/lib/storefront-templates/preview';

export async function renderPreviewMarkup({ model, tokens }: { model: PresentationModel; tokens: PublicThemeTokens }): Promise<Pick<PreviewResult, 'html' | 'css' | 'assets'>> {
  const assets: PreviewResult['assets'] = [{ id: tokens.typography.font, url: `/api/storefront/preview-font/${tokens.typography.font}`, kind: 'font' }];
  for (const section of model.sections) {
    const props = section.props;
    const products = 'product' in props ? [props.product] : 'products' in props ? props.products : 'groups' in props ? Object.values(props.groups).flatMap(page => page?.products ?? []) : [];
    for (const product of products) if (product?.image && !assets.some(a => a.url === product.image!.src)) assets.push({ id: product.id, url: product.image.src, kind: 'image' });
  }
  const imageUrls = new Set(assets.filter(a => a.kind === 'image').map(a => a.url));
  const raw = renderToStaticMarkup(<PublicThemeShell tokens={tokens}><StorefrontComposition model={model} shopName={model.locale === 'pl' ? 'Podgląd sklepu' : 'Store preview'} renderKey="preview" /></PublicThemeShell>);
  const tree = fromHtml(raw, { fragment: true });
  function inert(node: Root | Element): void {
    node.children = node.children.flatMap((child): RootContent[] => {
      if (child.type !== 'element') return child.type === 'text' ? [child] : [];
      if (['script', 'style', 'link', 'iframe', 'object', 'embed', 'meta'].includes(child.tagName)) return [];
      const props = child.properties;
      if (child.tagName === 'select') {
        const selected = child.children.find(option => option.type === 'element' && option.tagName === 'option' && option.properties.selected);
        if (selected?.type === 'element') props.defaultValue = selected.properties.value;
      }
      if (child.tagName === 'option') delete props.selected;
      inert(child);
      for (const key of Object.keys(props)) if (/^on/i.test(key) || ['href', 'action', 'formAction', 'target', 'srcSet', 'style', 'ping', 'autoFocus'].includes(key)) delete props[key];
      if (child.tagName === 'img' && !imageUrls.has(String(props.src))) throw new Error('Missing preview image');
      if (child.tagName !== 'img') delete props.src;
      if (child.tagName === 'form') { child.tagName = 'div'; delete props.method; }
      if (child.tagName === 'a') { props.role = 'link'; props.ariaDisabled = 'true'; }
      if (['button', 'input', 'select', 'textarea', 'fieldset'].includes(child.tagName)) props.disabled = true;
      return [child];
    }) as Element['children'];
  }
  inert(tree);
  const body = renderToStaticMarkup(toJsxRuntime(tree, { Fragment, jsx, jsxs }));
  const html = '<!doctype html>' + renderToStaticMarkup(createElement('html', { lang: model.locale },
    createElement('head', null, createElement('meta', { charSet: 'utf-8' }), createElement('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }), createElement('meta', { name: 'robots', content: 'noindex,nofollow' }), createElement('title', null, model.locale === 'pl' ? 'Podgląd sklepu' : 'Store preview')),
    createElement('body', null, createElement('main', { dangerouslySetInnerHTML: { __html: body } }))));
  return { html, css: publicThemeCSS(tokens), assets };
}
