/** Transfer account number as the buyer reads it on the order page and in mail. @see components/checkout/TransferInstructions.tsx */
export function formatTransferAccount(account: unknown): string {
  return String(account ?? '').replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') ?? '';
}
