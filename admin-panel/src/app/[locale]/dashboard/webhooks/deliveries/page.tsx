import WebhookDeliveriesPageContent from '@/components/WebhookDeliveriesPageContent';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Webhook deliveries - Sellf Admin',
};

export default function WebhookDeliveriesPage() {
  return <WebhookDeliveriesPageContent />;
}
