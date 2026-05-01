/**
 * Type declarations for the <altcha-widget> web component
 *
 * The altcha package registers a custom element. These declarations
 * let TypeScript/JSX accept <altcha-widget> with its props.
 */

import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'altcha-widget': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          challenge?: string;
          auto?: 'off' | 'onload' | 'onsubmit' | 'onfocus';
          floating?: 'top' | 'bottom' | 'auto' | boolean | '';
          hidelogo?: boolean | '';
          hidefooter?: boolean | '';
          strings?: string;
          style?: React.CSSProperties;
        },
        HTMLElement
      >;
    }
  }
}
