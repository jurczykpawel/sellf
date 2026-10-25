'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getProductsList, ProductListItem } from '@/lib/actions/products';
import { useTranslations } from 'next-intl';
import { isExpectedApiError } from '@/lib/api/client';
import { Combobox } from '@/components/ui/Combobox'; // Import the new Combobox

export default function ProductFilter() {
  const t = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>(searchParams.get('productId') || '');

  useEffect(() => {
    let unmounted = false;
    getProductsList().then(data => {
      if (!unmounted) setProducts(data);
    }).catch(error => {
      if (!isExpectedApiError(error, unmounted)) console.error('Failed to load products:', error);
    });
    return () => { unmounted = true; };
  }, []);

  const handleSelect = (productId: string) => {
    setSelectedProduct(productId);
    
    const params = new URLSearchParams(searchParams.toString());
    if (productId) {
      params.set('productId', productId);
    } else {
      params.delete('productId');
    }
    
    router.push(`?${params.toString()}`);
  };

  // Map products to the format expected by Combobox
  const options = products.map(product => ({ value: product.id, label: product.name }));

  return (
    <div className="w-[250px]"> {/* Adjust width as needed */}
      <Combobox
        options={[{ value: '', label: t('allProducts', { defaultValue: 'All Products' }) }, ...options]}
        selectedValue={selectedProduct}
        onSelect={handleSelect}
        placeholder={t('search', { defaultValue: 'Search...' })}
      />
    </div>
  );
}
