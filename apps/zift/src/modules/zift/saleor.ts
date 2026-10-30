/**
 * The shapes Saleor sends, as this app reads them.
 *
 * Hand-written rather than generated: these are exactly the fields
 * lib/subscriptions.ts asks for and nothing else, so the type and the query
 * are one change apart and a field added to one without the other fails the
 * typecheck rather than arriving as undefined at runtime.
 *
 * Everything optional is optional because Saleor really can omit it — an order
 * with no shipping address, a line whose variant was deleted — and the money
 * path has to keep working when it does.
 */

export interface Money {
  amount: number;
}

export interface Address {
  postalCode?: string | null;
  streetAddress1?: string | null;
  countryArea?: string | null;
  country?: { code?: string | null } | null;
}

export interface OrderLine {
  quantity: number;
  productName?: string | null;
  variantName?: string | null;
  productSku?: string | null;
  unitPrice?: { net?: Money | null } | null;
  totalPrice?: { net?: Money | null; tax?: Money | null } | null;
}

export interface Order {
  id: string;
  number?: string | null;
  /** ISO 8601. Zift wants orderDate as yyyyMMdd; see level3.ts. */
  created?: string | null;
  /** Aliased from `metafield(key: "poNumber")` — the buyer's PO, set at checkout. */
  poNumber?: string | null;
  billingAddress?: Address | null;
  shippingAddress?: Address | null;
  shippingPrice?: { net?: Money | null; tax?: Money | null } | null;
  total?: { gross?: Money | null; currency?: string | null } | null;
  lines?: OrderLine[] | null;
}

export interface TransactionAction {
  amount: number;
  currency: string;
  actionType: string;
}

export interface TransactionRef {
  id: string;
  pspReference?: string | null;
  order?: Order | null;
}

export interface ChargeRequestedEvent {
  action: TransactionAction;
  transaction?: TransactionRef | null;
}

export interface SessionEvent {
  action: TransactionAction;
  transaction?: TransactionRef | null;
  sourceObject?: ({ __typename?: string } & Partial<Order> & { user?: { id?: string; email?: string } | null }) | null;
  data?: unknown;
  idempotencyKey?: string | null;
}
