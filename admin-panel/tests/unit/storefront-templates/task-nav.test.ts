/** Task navigation binding and public rendering contract. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TaskNav from '@/components/storefront/sections/TaskNav';
import { resolveTaskNav } from '@/lib/storefront-templates/task-nav';
import { taskNavHref } from '@/lib/storefront-templates/task-nav-public';
import { STOREFRONT_TEMPLATES, validateRecipe } from '@/lib/storefront-templates/registry';
import { checkTemplate } from '@/lib/storefront-templates/check';
import { D_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { settingsSchema } from '@/lib/storefront-templates/schemas';
import { taskNavFixture } from '../../fixtures/storefront-sections/task-nav';

vi.mock('@/components/storefront/sections/TaskNav.module.css', () => ({ default: {} }));

const recipe = STOREFRONT_TEMPLATES.d.defaults;
const spec = recipe.sections.find(section => section.type === 'task-nav/1')!;
const props = taskNavFixture('en');
const inputs = { locale: 'en' as const, settings: { taskCategories: props.categories.map(c => c.id) },
  categoriesById: Object.fromEntries(props.categories.map(c => [c.id, c])), slots: { 'home.tasks': props.content! } };

describe('task navigation', () => {
  it('resolves only selected batched categories in seller order and omits absent rows', () => {
    const selected = [props.categories[2].id, '99999999-9999-4999-8999-999999999999', props.categories[0].id];
    const result = resolveTaskNav(spec, { ...inputs, settings: { taskCategories: selected } }, recipe);
    expect(result).toEqual({ success: true, data: { ...props, categories: [props.categories[2], props.categories[0]] } });
  });
  it('rejects undeclared or non-catalogue targets, wrong bindings and oversized selections', () => {
    expect(validateRecipe({ ...recipe, sections: recipe.sections.map(s => s === spec ? { ...s, target: 'hero' } : s) }).valid).toBe(false);
    for (const value of [{ ...spec, target: 'missing' }, { ...spec, target: 'hero' }, { ...spec, categories: { setting: 'other' } }]) {
      expect(resolveTaskNav(value, inputs, recipe)).toEqual({ success: false, error: 'INVALID' });
    }
    expect(settingsSchema.safeParse({ taskCategories: Array.from({ length: 13 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`) }).success).toBe(false);
    const wrong = { ...props.categories[0], filterTarget: 'other' };
    expect(resolveTaskNav(spec, { ...inputs, categoriesById: { [wrong.id]: wrong } }, recipe)).toEqual({ success: false, error: 'INVALID' });
  });
  it('rejects unknown categories at publication while empty runtime categories stay omitted', () => {
    const config = structuredClone(D_CONFIG);
    config.settingsByTemplate.d!.taskCategories = [props.categories[0].id];
    expect(checkTemplate(config, 'publish', PUBLIC_FIXTURE).errors).toContainEqual(expect.objectContaining({ path: '/settingsByTemplate/d/taskCategories/0', code: 'BINDING' }));
    expect(renderToStaticMarkup(createElement(TaskNav, taskNavFixture('pl', 13))).match(/<a /g)).toHaveLength(12);
  });
  it('requires resolved heading slots and category identity, with no extra public fields', () => {
    expect(resolveTaskNav(spec, { ...inputs, slots: {} }, recipe)).toMatchObject({ success: true, data: { content: null } });
    expect(resolveTaskNav(spec, { ...inputs, slots: { 'home.tasks': { kind: 'cta', heading: 'x', body: '' } } }, recipe)).toEqual({ success: false, error: 'INVALID' });
    expect(resolveTaskNav(spec, { ...inputs, categoriesById: { [props.categories[0].id]: { ...props.categories[1] } } }, recipe)).toEqual({ success: false, error: 'INVALID' });
  });
  it('has bounded escaped links and omits the entire empty section', () => {
    expect(renderToStaticMarkup(createElement(TaskNav, { ...props, categories: [] }))).toBe('');
    const html = renderToStaticMarkup(createElement(TaskNav, { ...props, categories: [{ ...props.categories[0], label: '<img src=x onerror=alert(1)>' }] }));
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).toContain(`href="?category=${props.categories[0].id}#catalogue"`);
    expect(html).not.toContain('<h1');
    expect(html).toContain('type="search"');
    expect(taskNavHref('catalogue', props.categories[0].id)).toBe(`?category=${props.categories[0].id}#catalogue`);
    expect(taskNavHref('bad#target', 'a&b')).toBe('?category=a%26b#bad%23target');
  });
});
