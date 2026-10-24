/** Checkout without a product uses the localized missing-page view. */
import { notFound } from 'next/navigation';
export default function CheckoutIndex(): never { return notFound(); }
