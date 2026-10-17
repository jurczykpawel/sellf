// @vitest-environment happy-dom
/** Native form guidance uses the page locale. @see components/providers/LocalizedFormValidation.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import LocalizedFormValidation from '@/components/providers/LocalizedFormValidation';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it.each(['en', 'pl'] as const)('localizes required fields in %s and clears the message after input', locale => {
  const view = render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(React.Fragment, null, React.createElement(LocalizedFormValidation), React.createElement('input', { required: true }))));
  const field = view.container.querySelector('input')!;
  fireEvent.invalid(field);
  expect(field.validationMessage).toBe(locale === 'pl' ? 'Wypełnij to pole.' : 'Please fill out this field.');
  fireEvent.input(field, { target: { value: 'Completed' } });
  expect(field.validationMessage).toBe('');
});
