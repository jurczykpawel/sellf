/** Release-authored section intent domains. @see layout.ts */
export type SectionVisibility = 'visible' | 'hidden';
export type SectionPlacement = { pin: 'first' | 'last' } | { after: string } | { before: string };
export interface SectionDescriptor {
  hideable: boolean;
  defaultVisibility: SectionVisibility;
  variants: readonly string[];
  placement: SectionPlacement;
}
export const SECTION_DESCRIPTORS = {
  default: {
    catalogue: { hideable: false, defaultVisibility: 'visible', variants: ['detail-cards', 'default-groups'], placement: { pin: 'first' } },
  },
  d: {
    hero: { hideable: false, defaultVisibility: 'visible', variants: ['split-process', 'simple'], placement: { pin: 'first' } },
    tasks: { hideable: true, defaultVisibility: 'visible', variants: [], placement: { after: 'hero' } },
    start: { hideable: true, defaultVisibility: 'visible', variants: ['detail-cards', 'compact'], placement: { after: 'tasks' } },
    catalogue: { hideable: false, defaultVisibility: 'visible', variants: ['detail-cards', 'default-groups'], placement: { after: 'start' } },
    faq: { hideable: true, defaultVisibility: 'visible', variants: [], placement: { before: 'closing' } },
    closing: { hideable: false, defaultVisibility: 'visible', variants: [], placement: { pin: 'last' } },
  },
} as const satisfies Record<string, Record<string, SectionDescriptor>>;
export interface SectionIntent { visibility?: SectionVisibility; variant?: string }
export interface LayoutOverrides { order?: readonly string[]; sections?: Readonly<Record<string, SectionIntent | undefined>> }
