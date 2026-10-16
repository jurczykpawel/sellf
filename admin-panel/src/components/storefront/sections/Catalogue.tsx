'use client';

/** Public catalogue interaction over core DTOs. @see catalogue-section.ts */
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { catalogueLabels, cataloguePageSchema, catalogueRequestSchema } from '@/lib/storefront-templates/catalogue-section';
import { TASK_NAV_FILTER_EVENT, TASK_NAV_STATE_EVENT } from '@/lib/storefront-templates/task-nav-public';
import { productFormatSchema, resolveMarketingCopy } from '@/lib/validations/product-marketing';
import type { TaskNavFilter } from '@/lib/storefront-templates/task-nav-public';
import type { CatalogueGroup, PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { CatalogueProps, CatalogueRequest } from '@/lib/storefront-templates/catalogue-section';
import styles from './Catalogue.module.css';

type Query = Pick<CatalogueRequest, 'search' | 'categoryIds' | 'priceKind' | 'format'>;
const emptyQuery: Query = { search: '', categoryIds: [], priceKind: null, format: null };

export default function Catalogue({
  id = 'catalogue',
  variant,
  groups: initialGroups,
  filters,
  pageSize,
  density,
  locale,
  categories = [],
  initialQuery = emptyQuery,
}: CatalogueProps) {
  const labels = catalogueLabels[locale];
  const groupIds: CatalogueGroup[] = variant === 'detail-cards' ? ['all'] : ['featured', 'free', 'paid'];
  const [groups, setGroups] = useState(initialGroups);
  const [query, setQuery] = useState<Query>(initialQuery);
  const [search, setSearch] = useState(initialQuery.search);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<'INVALID' | 'UNAVAILABLE' | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const focusTarget = useRef<string | null>(null);
  const status = useRef<HTMLParagraphElement | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (focusTarget.current) {
      if (focusTarget.current === 'status') status.current?.focus();
      else headings.current.get(focusTarget.current)?.focus();
      focusTarget.current = null;
    }
  }, [groups]);

  async function request(next: Query, more: CatalogueGroup | null = null, focusAfter = more !== null) {
    const version = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const cursor = more ? (groups[more]?.nextCursor ?? null) : null;
    setQuery(next);
    setFailure(null);
    setPending(true);
    focusTarget.current = null;
    if (!more) setGroups({});
    try {
      const requested = more ? [more] : groupIds;
      const inputs = requested.map(group => ({ locale, ...next, group, cursor: more ? cursor : null, pageSize }));
      const response = await fetch(`/api/storefront/catalogue?input=${encodeURIComponent(JSON.stringify(inputs.length === 1 ? inputs[0] : inputs))}`, {
        signal: abort.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(response.status === 422 ? 'INVALID' : 'UNAVAILABLE');
      const raw = await response.json();
      const values = requested.length === 1 ? [raw] : raw;
      if (!Array.isArray(values) || values.length !== requested.length) throw new Error('UNAVAILABLE');
      const pages = requested.map((group, index) => [group, cataloguePageSchema(pageSize).parse(values[index])] as const);
      if (version !== generation.current) return;
      const updated: CatalogueProps['groups'] = more ? { ...groups } : {};
      if (focusAfter) focusTarget.current = 'status';
      for (const [group, page] of pages) {
        const previous = more ? (groups[group]?.products ?? []) : [];
        const seen = new Set(previous.map((p) => p.id));
        const added = page.products.filter(
          (p) => p.availability === 'available' && !seen.has(p.id) && (seen.add(p.id), true),
        );
        if (more && added[0]) focusTarget.current = `${group}:${added[0].id}`;
        updated[group] = { ...page, products: [...previous, ...added] };
      }
      setGroups(updated);
    } catch (error) {
      if (version !== generation.current) return;
      if (focusAfter) focusTarget.current = 'status';
      setGroups({});
      setFailure(error instanceof Error && error.message === 'INVALID' ? 'INVALID' : 'UNAVAILABLE');
    } finally {
      if (version === generation.current) setPending(false);
    }
  }
  useEffect(() => {
    const element = document.getElementById(id);
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<TaskNavFilter>).detail;
      if (detail?.target !== id) return;
      const next = { ...query, ...(detail.search !== undefined ? { search: detail.search } : {}), ...(detail.categoryIds ? { categoryIds: detail.categoryIds } : {}) };
      if (!catalogueRequestSchema.safeParse({ locale, ...next, group: groupIds[0], cursor: null, pageSize }).success) return;
      event.preventDefault();
      setSearch(next.search);
      void request(next);
    };
    element?.addEventListener(TASK_NAV_FILTER_EVENT, receive);
    element?.dispatchEvent(new CustomEvent(TASK_NAV_STATE_EVENT, { bubbles: true, detail: { target: id, categoryIds: query.categoryIds } }));
    return () => element?.removeEventListener(TASK_NAV_FILTER_EVENT, receive);
  });
  function update(patch: Partial<Query>) {
    void request({ ...query, ...patch, search });
  }
  const visible = Object.values(groups).reduce(
    (n, page) => n + (page?.products.filter((p) => p.availability === 'available').length ?? 0),
    0,
  );
  const moreLabel = (group: CatalogueGroup) =>
    group === 'featured'
      ? labels.moreFeatured
      : group === 'free'
        ? labels.moreFree
        : group === 'paid'
          ? labels.morePaid
          : labels.more;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={`${styles.catalogue} ${variant === 'default-groups' ? styles.defaultGroups : ''}`}
      data-density={density}
    >
      <div className={styles.wrap}>
        <h2 id={`${id}-heading`}>{labels.title}</h2>
        <form
          role="search"
          aria-label={labels.search}
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault();
            update({});
          }}
        >
          <label htmlFor={`${id}-search`}>{labels.search}</label>
          <div>
            <input
              id={`${id}-search`}
              type="search"
              maxLength={200}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit">{labels.submit}</button>
          </div>
        </form>
        <div className={styles.filters}>
          {filters.includes('category') && categories.length > 0 && (
            <fieldset>
              <legend>{labels.category}</legend>
              {categories.slice(0, 12).map((category) => (
                <label key={category.id}>
                  <input
                    type="checkbox"
                    checked={query.categoryIds.includes(category.id)}
                    onChange={(event) =>
                      update({
                        categoryIds: event.target.checked
                          ? [...query.categoryIds, category.id]
                          : query.categoryIds.filter((value) => value !== category.id),
                      })
                    }
                  />
                  {category.label}
                </label>
              ))}
            </fieldset>
          )}
          {filters.includes('price-kind') && (
            <label>
              {labels.price}
              <select
                value={query.priceKind ?? ''}
                onChange={(event) => update({ priceKind: (event.target.value as Query['priceKind']) || null })}
              >
                <option value="">{labels.all}</option>
                <option value="free">{labels.free}</option>
                <option value="one-time">{labels.oneTime}</option>
                <option value="subscription">{labels.subscription}</option>
                <option value="pwyw">{labels.pwyw}</option>
              </select>
            </label>
          )}
          {filters.includes('format') && (
            <label>
              {labels.format}
              <select
                value={query.format ?? ''}
                onChange={(event) => update({ format: (event.target.value as Query['format']) || null })}
              >
                <option value="">{labels.all}</option>
                {productFormatSchema.options.map((format, index) => (
                  <option key={format} value={format}>
                    {labels.formats[index]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              setSearch('');
              void request(emptyQuery);
            }}
          >
            {labels.reset}
          </button>
        </div>
        <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className={styles.results}>
          {pending ? labels.loading : failure ? labels.error : visible ? `${labels.shown}: ${visible}` : labels.empty}
        </p>
        {failure && (
          <div role="alert">
            <p>{failure === 'INVALID' ? labels.invalid : labels.error}</p>
            <button
              type="button"
              onClick={() => {
                void request(query, null, true);
              }}
            >
              {labels.retry}
            </button>
          </div>
        )}
        <div aria-busy={pending}>
          {groupIds.map((group) => {
            const page = groups[group];
            if (!page?.products.length) return null;
            return (
              <div key={group} className={styles.group}>
                {variant === 'default-groups' && (
                  <h3>{labels[group === 'featured' ? 'featured' : group === 'free' ? 'free' : 'paid']}</h3>
                )}
                <div className={styles.grid}>
                  {page.products
                    .filter((p) => p.availability === 'available')
                    .map((product) => (
                      <CatalogueCard
                        key={product.id}
                        product={product}
                        locale={locale}
                        grouped={variant === 'default-groups'}
                        headingRef={(element) => {
                          const key = `${group}:${product.id}`;
                          if (element) headings.current.set(key, element);
                          else headings.current.delete(key);
                        }}
                      />
                    ))}
                </div>
                {page.nextCursor && (
                  <button
                    type="button"
                    className={styles.more}
                    disabled={pending}
                    onClick={() => {
                      void request(query, group);
                    }}
                  >
                    {moreLabel(group)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CatalogueCard({
  product,
  locale,
  grouped,
  headingRef,
}: {
  product: PublicProductInfo;
  locale: 'en' | 'pl';
  grouped: boolean;
  headingRef: (element: HTMLHeadingElement | null) => void;
}) {
  const labels = catalogueLabels[locale];
  const marketing = resolveMarketingCopy(product.marketing, locale);
  const Heading = grouped ? 'h4' : 'h3';
  return (
    <article className={styles.card}>
      {product.image && (
        <div className={styles.cover}>
          <Image
            unoptimized
            src={product.image.src}
            alt={product.image.alt}
            width={product.image.width}
            height={product.image.height}
            loading="lazy"
          />
        </div>
      )}
      <div className={styles.body}>
        {!grouped && product.marketing.format && (
          <p className={styles.format}>
            {labels.formats[productFormatSchema.options.indexOf(product.marketing.format)]}
          </p>
        )}
        <Heading ref={headingRef} tabIndex={-1}>
          {product.title}
        </Heading>
        <div lang={marketing.locale}>
          {marketing.copy.result && <p className={styles.outcome}>{marketing.copy.result}</p>}
          {!grouped && (marketing.copy.tools.length > 0 || marketing.copy.requirements.length > 0) && (
            <dl className={styles.metadata}>
              {marketing.copy.tools.length > 0 && (
                <>
                  <dt>{labels.tools}</dt>
                  <dd>{marketing.copy.tools.join(', ')}</dd>
                </>
              )}
              {marketing.copy.requirements.length > 0 && (
                <>
                  <dt>{labels.requirements}</dt>
                  <dd>{marketing.copy.requirements.join(', ')}</dd>
                </>
              )}
            </dl>
          )}
        </div>
        <div className={styles.buyrow}>
          <p className={styles.price}>{product.price.display}</p>
          <a href={product.actions.details} aria-label={`${labels.details}: ${product.title}`}>
            {labels.details} <span aria-hidden="true">↗</span>
          </a>
        </div>
        {product.price.taxNote && <p className={styles.note}>{product.price.taxNote}</p>}
        {product.price.omnibus && <p className={styles.note}>{product.price.omnibus}</p>}
        {(marketing.copy.tools.length > 0 || marketing.copy.requirements.length > 0) && (
          <details className={styles.detail}>
            <summary>{labels.requirements}</summary>
            <div lang={marketing.locale}>
              {marketing.copy.tools.length > 0 && (
                <p>
                  {labels.tools}: {marketing.copy.tools.join(', ')}
                </p>
              )}
              {marketing.copy.requirements.length > 0 && <p>{marketing.copy.requirements.join(', ')}</p>}
            </div>
            <a href={product.actions.buy}>
              {product.price.kind === 'free'
                ? labels.getFree
                : product.price.kind === 'subscription'
                  ? labels.subscribe
                  : labels.buy}{' '}
              ↗
            </a>
          </details>
        )}
      </div>
    </article>
  );
}
