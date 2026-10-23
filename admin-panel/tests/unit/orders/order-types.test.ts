/** Generated types must describe legacy Stripe and offline references. */
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('accepts provider-independent order fields in the generated database contract', () => {
  const file = resolve('tests/fixtures/order-types.ts');
  const program = ts.createProgram([file], {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
});
