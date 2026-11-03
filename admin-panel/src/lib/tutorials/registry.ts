/** Guided tutorials: ids, screens and steps. Texts live in messages `tutorials.<id>.*`; targets are `data-tour` attributes. */

export interface TutorialStepDef {
  key: string;
  /** `data-tour` value of the highlighted element; omitted for a centred introduction. */
  target?: string;
  /** `data-tour` value that must exist once this step has been acted on; while it is missing the step asks the user to click the highlighted control. */
  requires?: string;
}

export interface TutorialDef {
  /** Screen carrying the tutorial; opened with `?tutorial=<id>` from the help menu. */
  href: string;
  /** Tutorials rendered inside a form modal can only be started once the form is open. */
  needsOpenForm?: boolean;
  steps: readonly TutorialStepDef[];
}

const intro: TutorialStepDef = { key: 'intro' };

export const TUTORIALS = {
  'storefront-templates': {
    href: '/dashboard/templates',
    steps: [intro,
      { key: 'workspace', target: 'templates-workspace' },
      { key: 'template', target: 'template-picker' },
      { key: 'sections', target: 'template-sections' },
      { key: 'section', target: 'template-section-panel' },
      { key: 'appearance', target: 'template-appearance' },
      { key: 'save', target: 'template-savebar' },
      { key: 'preview', target: 'template-draft-actions' }],
  },
  'offer-page': {
    href: '/dashboard/templates?surface=offer',
    steps: [intro,
      { key: 'product', target: 'offer-product' },
      { key: 'save', target: 'offer-savebar' },
      { key: 'publication', target: 'offer-publication' },
      { key: 'sections', target: 'offer-sections' },
      { key: 'editor', target: 'offer-editor' }],
  },
  'b2b-checkout-profile': {
    href: '/dashboard/products',
    needsOpenForm: true,
    steps: [intro,
      { key: 'enable', target: 'profile-enable', requires: 'profile-buyer' },
      { key: 'buyer', target: 'profile-buyer' },
      { key: 'recipient', target: 'profile-recipient' },
      { key: 'quantity', target: 'profile-quantity' },
      { key: 'participants', target: 'profile-participants' }],
  },
  events: {
    href: '/dashboard/products',
    needsOpenForm: true,
    steps: [intro,
      { key: 'enable', target: 'event-enable', requires: 'event-add-session' },
      { key: 'addSession', target: 'event-add-session', requires: 'event-session' },
      { key: 'session', target: 'event-session' },
      { key: 'tier', target: 'event-tier' },
      { key: 'addTier', target: 'event-add-tier' },
      { key: 'preview', target: 'event-preview' }],
  },
  'bank-transfer-setup': {
    href: '/dashboard/settings?tab=payments',
    steps: [intro,
      { key: 'enable', target: 'transfer-enable' },
      { key: 'account', target: 'transfer-account' },
      { key: 'due', target: 'transfer-due' },
      { key: 'reservation', target: 'transfer-reservation' },
      { key: 'save', target: 'transfer-save' }],
  },
  'unpaid-orders': {
    href: '/dashboard/payments',
    needsOpenForm: true,
    steps: [intro,
      { key: 'instructions', target: 'unpaid-instructions' },
      { key: 'markPaid', target: 'unpaid-mark-paid' },
      { key: 'cancel', target: 'unpaid-cancel' },
      { key: 'lifecycle', target: 'unpaid-lifecycle' },
      { key: 'invoice', target: 'unpaid-invoice' }],
  },
  affiliates: {
    href: '/dashboard/affiliates',
    steps: [intro,
      { key: 'navigation', target: 'affiliates-nav' },
      { key: 'settings', target: 'affiliates-settings' },
      { key: 'applications', target: 'affiliates-applications' },
      { key: 'member', target: 'affiliates-member' }],
  },
  licenses: {
    href: '/dashboard/settings?tab=license',
    steps: [intro,
      { key: 'issue', target: 'licenses-issue' },
      { key: 'filters', target: 'licenses-filters' },
      { key: 'table', target: 'licenses-table' }],
  },
  attribution: {
    href: '/dashboard/settings?tab=legal',
    steps: [intro,
      { key: 'retention', target: 'attribution-retention' },
      { key: 'rules', target: 'attribution-rules' },
      { key: 'addRule', target: 'attribution-add-rule' },
      { key: 'save', target: 'attribution-save' }],
  },
  'payments-orders': {
    href: '/dashboard/payments',
    steps: [intro,
      { key: 'stats', target: 'payments-stats' },
      { key: 'filters', target: 'payments-filters' },
      { key: 'table', target: 'payments-table' },
      { key: 'details', target: 'payments-details' }],
  },
} as const satisfies Record<string, TutorialDef>;

export type TutorialId = keyof typeof TUTORIALS;
export const TUTORIAL_IDS = Object.keys(TUTORIALS) as TutorialId[];

export function isTutorialId(value: unknown): value is TutorialId {
  return typeof value === 'string' && Object.hasOwn(TUTORIALS, value);
}
