// @vitest-environment happy-dom
import { createElement, createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Tooltip } from '@/components/ui/Tooltip';
const referenceInputs = vi.hoisted(() => vi.fn());
vi.mock('@floating-ui/react', async importOriginal => {
  const original = await importOriginal<typeof import('@floating-ui/react')>();
  return { ...original, useInteractions: (...args: Parameters<typeof original.useInteractions>) => {
    const interactions = original.useInteractions(...args);
    return { ...interactions, getReferenceProps: (props?: React.HTMLProps<Element>) => {
      referenceInputs(props);
      return interactions.getReferenceProps(props);
    } };
  } };
});
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

it('keeps the child ref out of interaction props and attaches both references', () => {
  referenceInputs.mockClear();
  const ref = createRef<HTMLButtonElement>();
  const view = render(createElement(Tooltip, { content: 'Help', children: createElement('button', { ref }, 'Referenced') }));
  const button = screen.getByRole('button', { name: 'Referenced' });
  expect(ref.current).toBe(button);
  expect(referenceInputs.mock.calls.every(([props]) => !Object.hasOwn(props ?? {}, 'ref'))).toBe(true);
  view.unmount();
  expect(ref.current).toBeNull();
});
