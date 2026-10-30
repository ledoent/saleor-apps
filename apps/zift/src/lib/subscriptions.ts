/**
 * Subscription documents for the six payment webhooks.
 *
 * Each asks for everything its handler needs in one round trip. A second call
 * back to Saleor in the middle of a payment is the worst place in the app to
 * add latency, and the worst place to add a second thing that can fail.
 *
 * WHY THE CHARGE EVENT ASKS FOR THE WHOLE ORDER
 *
 * A plain charge needs only `action` and `transaction`. This app charges with
 * Level 3 line-item data as well, and by
 * the time AR presses Charge the checkout is long gone — the order is where
 * the lines live. `transaction { order { ... } }` is how they get here.
 * Dropping those fields would not fail; it would silently downgrade every
 * transaction to Level 1, which is the entire cost this app exists to avoid.
 */

/** Line items, shipping and the billing postcode: Level 3 plus AVS, in one shape. */
const ORDER_FOR_LEVEL_3 = `
  id
  number
  created
  poNumber: metafield(key: "poNumber")
  billingAddress { postalCode streetAddress1 countryArea country { code } }
  shippingAddress { postalCode countryArea country { code } }
  shippingPrice { net { amount } tax { amount } }
  total { gross { amount } currency }
  lines {
    quantity
    productName
    variantName
    productSku
    unitPrice { net { amount } }
    totalPrice { net { amount } tax { amount } }
  }
`;

const SOURCE_OBJECT = `
  sourceObject {
    __typename
    ... on Checkout {
      id
      user { id email }
      billingAddress { postalCode streetAddress1 countryArea country { code } }
      totalPrice { gross { amount } currency }
    }
    ... on Order {
      ${ORDER_FOR_LEVEL_3}
      user { id email }
    }
  }
`;

export const PAYMENT_GATEWAY_INITIALIZE_SESSION = `
  subscription PaymentGatewayInitializeSession {
    event {
      ... on PaymentGatewayInitializeSession {
        ${SOURCE_OBJECT}
        data
        amount
      }
    }
  }
`;

export const TRANSACTION_INITIALIZE_SESSION = `
  subscription TransactionInitializeSession {
    event {
      ... on TransactionInitializeSession {
        ${SOURCE_OBJECT}
        action { amount currency actionType }
        transaction { id pspReference }
        data
        idempotencyKey
      }
    }
  }
`;

export const TRANSACTION_PROCESS_SESSION = `
  subscription TransactionProcessSession {
    event {
      ... on TransactionProcessSession {
        ${SOURCE_OBJECT}
        action { amount currency actionType }
        transaction { id pspReference }
        data
      }
    }
  }
`;

export const TRANSACTION_CHARGE_REQUESTED = `
  subscription TransactionChargeRequested {
    event {
      ... on TransactionChargeRequested {
        action { amount currency actionType }
        transaction {
          id
          pspReference
          order { ${ORDER_FOR_LEVEL_3} }
        }
      }
    }
  }
`;

const TRANSACTION_ACTION = `
  action { amount currency actionType }
  transaction { id pspReference }
`;

export const TRANSACTION_REFUND_REQUESTED = `
  subscription TransactionRefundRequested {
    event { ... on TransactionRefundRequested { ${TRANSACTION_ACTION} } }
  }
`;

export const TRANSACTION_CANCELATION_REQUESTED = `
  subscription TransactionCancelationRequested {
    event { ... on TransactionCancelationRequested { ${TRANSACTION_ACTION} } }
  }
`;
