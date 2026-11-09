// @vitest-environment happy-dom
import React from 'react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { expect, it } from 'vitest';

it.each(['api.md', 'pl/api.md'])('renders user price units inside the monetary units table in %s', (file) => {
  const markdown = readFileSync(path.resolve(process.cwd(), `../docs-site/src/content/docs/${file}`), 'utf8');
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], children: markdown }));
  const document = new DOMParser().parseFromString(html, 'text/html');
  const row = [...document.querySelectorAll('tr')].find(row => row.textContent?.includes('GET /users/{id}'));
  expect(row, 'the user endpoint must be a table row').toBeDefined();
  expect(row?.closest('table')?.querySelector('thead')?.textContent).toMatch(/Endpoint/);
  const paragraph = [...document.querySelectorAll('p')].find(p => /^(Revenue fields|Pola przychodu)/.test(p.textContent ?? ''));
  expect(paragraph).toBeDefined();
  expect(paragraph?.closest('table')).toBeNull();
});
