// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Tooltip } from '@/components/ui/Tooltip';
afterEach(cleanup);
it('keeps the inactive product action on click and keyboard activation', () => {
  const activate = vi.fn();
  render(createElement(Tooltip, { content: 'Activate this product', children: createElement('button', { onClick: activate }, 'Inactive') }));
  const button = screen.getByRole('button', { name: 'Inactive' });
  fireEvent.click(button);
  expect(activate).toHaveBeenCalledTimes(1);
  button.focus();
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(button, { detail: 0 });
  expect(activate).toHaveBeenCalledTimes(2);
});
it('keeps child focus and pointer handlers', () => {
  const focus = vi.fn(), pointer = vi.fn();
  render(createElement(Tooltip, { content: 'Help', children: createElement('button', { onFocus: focus, onPointerDown: pointer }, 'Action') }));
  fireEvent.focus(screen.getByRole('button'));
  fireEvent.pointerDown(screen.getByRole('button'));
  expect(focus).toHaveBeenCalledTimes(1);
  expect(pointer).toHaveBeenCalledTimes(1);
});
