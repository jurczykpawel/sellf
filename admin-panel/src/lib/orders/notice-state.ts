export const ORDER_NOTICES = {
  placed: { kind: 'transfer_placed', column: 'transfer_mail_sent_at', state: 'transfer_mail_delivery_unknown', statuses: ['awaiting_payment', 'completed'] },
  reminder: { kind: 'payment_reminder', column: 'reminder_mail_sent_at', state: 'reminder_mail_delivery_unknown', statuses: ['awaiting_payment'] },
  cancelled: { kind: 'order_cancelled', column: 'cancelled_mail_sent_at', state: 'cancelled_mail_delivery_unknown', statuses: ['cancelled'] },
  paid: { kind: undefined, column: 'transfer_paid_mail_sent_at', state: 'transfer_paid_mail_delivery_unknown', statuses: ['completed'] },
} as const;
export type OrderNotice = keyof typeof ORDER_NOTICES;
export const NOTICE_RETRY_DELAY = 300000;
/** Refused payment confirmations wait 2, 4, 8… minutes (at most an hour); the 30th refusal (about a day) goes to the administrator. */
export const PAID_NOTICE_MAX_ATTEMPTS = 30;
export function paidNoticeRetryDelay(attempt: number): number {
  return Math.min(2 ** attempt, 60) * 60000;
}
/**
 * PostgREST `.or()` filter for confirmations whose retry time has come. `now` must be an ISO timestamp the
 * server generated; never pass a request value here, because `.or()` parses commas and dots as filter syntax.
 */
export function paidNoticeDue(now: string): string {
  return `transfer_paid_mail_retry_at.is.null,transfer_paid_mail_retry_at.lte.${now}`;
}
export function noticeMatchesStatus(notice: OrderNotice, status: string): boolean {
  return (ORDER_NOTICES[notice].statuses as readonly string[]).includes(status);
}
