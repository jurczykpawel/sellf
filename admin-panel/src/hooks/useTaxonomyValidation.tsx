import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ZodType } from 'zod';

export function useTaxonomyValidation(schema: ZodType) {
  const id = useId();
  const t = useTranslations('common.taxonomyValidation');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clear = (name: string) => setErrors(current => ({ ...current, [name]: '' }));
  return {
    reset: () => setErrors({}),
    clear,
    validate(form: HTMLFormElement, values: Record<string, string>) {
      const result = schema.safeParse(values);
      if (result.success) return true;
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        next[field] ??= issue.code === 'too_big' ? t('tooLong', { max: Number(issue.maximum) })
          : issue.code === 'too_small' ? t('required') : t('slug');
      }
      setErrors(next);
      queueMicrotask(() => (form.elements.namedItem(Object.keys(next)[0]) as HTMLElement | null)?.focus());
      return false;
    },
    field(name: string) {
      return { id: `${id}-${name}`, name, 'aria-invalid': !!errors[name],
        'aria-describedby': errors[name] ? `${id}-${name}-error` : undefined };
    },
    error(name: string) {
      return errors[name] ? <p id={`${id}-${name}-error`} className="text-sm text-sf-danger">{errors[name]}</p> : null;
    },
  };
}
