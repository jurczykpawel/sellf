/** Contact address used by checkout, fulfillment, and signed license claims. */
export function normalizePurchaseEmail(email: string): string {
  return email.trim().toLowerCase();
}
