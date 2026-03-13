/**
 * Type declarations for the <altcha-widget> web component
 *
 * The altcha package registers a custom element. These declarations
 * let TypeScript/JSX accept <altcha-widget> with its props.
 */

declare namespace JSX {
  interface IntrinsicElements {
    'altcha-widget': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        challengeurl?: string;
        hidelogo?: boolean | '';
        hidefooter?: boolean | '';
        strings?: string;
        style?: React.CSSProperties;
      },
      HTMLElement
    >;
  }
}
