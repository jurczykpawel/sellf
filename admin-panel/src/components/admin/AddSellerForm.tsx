'use client';

/**
 * Inline form for adding a new seller from the admin sellers page.
 *
 * Creates the seller (provisions schema) and then invites them
 * by creating an auth user so they can log in via magic link.
 *
 * @see src/lib/actions/sellers.ts — createSeller, inviteSeller
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createSeller, inviteSeller } from '@/lib/actions/sellers';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function AddSellerForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [email, setEmail] = useState('');
  const [platformFeePercent, setPlatformFeePercent] = useState('5');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleNameChange = useCallback((value: string) => {
    setDisplayName(value);
    if (!slugManuallyEdited) {
      setSlug(slugify(value));
    }
  }, [slugManuallyEdited]);

  const handleSlugChange = useCallback((value: string) => {
    setSlugManuallyEdited(true);
    setSlug(slugify(value));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);

    try {
      const fee = parseFloat(platformFeePercent);
      if (isNaN(fee) || fee < 0 || fee > 50) {
        setMessage({ type: 'error', text: 'Platform fee must be between 0% and 50%' });
        setSubmitting(false);
        return;
      }

      // Step 1: Create seller (provisions schema)
      const createResult = await createSeller({
        slug,
        displayName: displayName.trim(),
        email: email.trim(),
        platformFeePercent: fee,
      });

      if (!createResult.success || !createResult.data) {
        setMessage({ type: 'error', text: createResult.error || 'Failed to create seller' });
        setSubmitting(false);
        return;
      }

      // Step 2: Invite seller (create auth user + link)
      const inviteResult = await inviteSeller(email.trim(), createResult.data.sellerId);

      if (!inviteResult.success) {
        setMessage({
          type: 'error',
          text: `Seller created but invite failed: ${inviteResult.error}. You can manually invite them later.`,
        });
        router.refresh();
        setSubmitting(false);
        return;
      }

      // Success — reset form
      setMessage({ type: 'success', text: `Seller "${displayName.trim()}" created and invited successfully.` });
      setDisplayName('');
      setSlug('');
      setSlugManuallyEdited(false);
      setEmail('');
      setPlatformFeePercent('5');
      router.refresh();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-sf-surface border border-sf-border rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-sf-heading mb-4">Add Seller</h2>

      {message && (
        <div
          className={`mb-4 px-4 py-3 rounded border text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Display Name */}
        <div>
          <label htmlFor="seller-name" className="block text-xs font-medium text-sf-muted mb-1">
            Display Name
          </label>
          <input
            id="seller-name"
            type="text"
            required
            minLength={2}
            value={displayName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Acme Store"
            className="w-full px-3 py-2 bg-sf-deep border border-sf-border rounded text-sm text-sf-heading placeholder:text-sf-muted/50 focus:outline-none focus:border-sf-accent"
          />
        </div>

        {/* Slug */}
        <div>
          <label htmlFor="seller-slug" className="block text-xs font-medium text-sf-muted mb-1">
            Slug
          </label>
          <input
            id="seller-slug"
            type="text"
            required
            minLength={3}
            maxLength={50}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="acme-store"
            className="w-full px-3 py-2 bg-sf-deep border border-sf-border rounded text-sm text-sf-heading font-mono placeholder:text-sf-muted/50 focus:outline-none focus:border-sf-accent"
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="seller-email" className="block text-xs font-medium text-sf-muted mb-1">
            Email
          </label>
          <input
            id="seller-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seller@example.com"
            className="w-full px-3 py-2 bg-sf-deep border border-sf-border rounded text-sm text-sf-heading placeholder:text-sf-muted/50 focus:outline-none focus:border-sf-accent"
          />
        </div>

        {/* Platform Fee % */}
        <div>
          <label htmlFor="seller-fee" className="block text-xs font-medium text-sf-muted mb-1">
            Platform Fee %
          </label>
          <div className="flex gap-2">
            <input
              id="seller-fee"
              type="number"
              required
              min={0}
              max={50}
              step={0.1}
              value={platformFeePercent}
              onChange={(e) => setPlatformFeePercent(e.target.value)}
              className="w-full px-3 py-2 bg-sf-deep border border-sf-border rounded text-sm text-sf-heading placeholder:text-sf-muted/50 focus:outline-none focus:border-sf-accent"
            />
            <button
              type="submit"
              disabled={submitting || !displayName.trim() || !slug || !email}
              className="px-4 py-2 bg-sf-accent text-white text-sm font-medium rounded hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {submitting ? 'Adding...' : 'Add Seller'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
