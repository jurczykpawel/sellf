'use client';

/** `next/link` that keeps the active locale in internal links (GitHub #73). */
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { localizedPath } from '@/lib/navigation/locale-path';
import type { ComponentProps } from 'react';

export default function LocaleLink({ href, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  return <Link href={localizedPath(useLocale(), href)} {...props} />;
}
