import type { PresentationModel } from '@/lib/storefront-templates/resolver';
import type { PublicThemeTokens } from '@/lib/storefront-templates/schemas';
import type { PreviewResult } from '@/lib/storefront-templates/preview';
export function renderPreviewMarkup(input: { model: PresentationModel; tokens: PublicThemeTokens }): Promise<Pick<PreviewResult, 'html' | 'css' | 'assets'>>;
