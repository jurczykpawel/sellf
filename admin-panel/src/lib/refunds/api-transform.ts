interface RefundListProductRelation {
  id: string;
  name: string;
  slug: string;
}

interface RefundListTransactionRelation {
  id: string;
  customer_email: string;
  amount: number;
  currency: string;
  created_at: string;
}

interface RefundListRow {
  id: string;
  user_id: string | null;
  product_id: string;
  transaction_id: string;
  customer_email: string;
  requested_amount: number;
  currency: string;
  reason: string | null;
  status: string;
  admin_response: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  product: RefundListProductRelation | RefundListProductRelation[] | null;
  transaction: RefundListTransactionRelation | RefundListTransactionRelation[] | null;
}

function firstRelation<T>(relation: T | T[] | null): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

export function transformRefundRequestListItem(req: RefundListRow) {
  const product = firstRelation(req.product);
  const transaction = firstRelation(req.transaction);

  return {
    id: req.id,
    user_id: req.user_id,
    product_id: req.product_id,
    transaction_id: req.transaction_id,
    customer_email: req.customer_email,
    requested_amount: req.requested_amount,
    currency: req.currency,
    reason: req.reason,
    status: req.status,
    admin_response: req.admin_response,
    processed_at: req.processed_at,
    created_at: req.created_at,
    updated_at: req.updated_at,
    product_name: product?.name,
    purchase_date: transaction?.created_at,
    product: product ? { id: product.id, name: product.name, slug: product.slug } : null,
    transaction: transaction
      ? {
          id: transaction.id,
          customer_email: transaction.customer_email,
          amount: transaction.amount,
          currency: transaction.currency,
          created_at: transaction.created_at,
        }
      : null,
  };
}
