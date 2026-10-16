/** Admin composition editor. @see lib/actions/storefront-templates.ts */
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import StorefrontEditor from '@/components/storefront-editor/StorefrontEditor';

export default async function TemplatesPage() {
  const result = await storefrontTemplateAction({ operation: 'read' });
  const initial = result.success && 'data' in result && 'revision' in result.data ? result.data : null;
  return <StorefrontEditor initial={initial} />;
}
