import { redirect } from 'next/navigation';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';

// Define Props type for the page component
type Props = {
  params: Promise<{ slug: string }>;
};

// Generate metadata for the page based on the product data
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('productView');

  // Fetch product data
  const supabase = await createClient();
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (!product) {
    return {
      title: t('notFound'),
    };
  }

  return {
    title: product.name,
    description: product.description,
  };
}

// Page component that redirects to the /p/[slug] route
export default async function ProductRedirectPage({ params }: Props) {
  const { slug } = await params;
  
  // Redirect to the canonical product URL
  redirect(`/p/${slug}`);
}
