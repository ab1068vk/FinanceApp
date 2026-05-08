const MONEY_RESPONSE_KEYS = new Set([
  'amount',
  'balance',
  'overdraft_limit',
  'current_balance',
  'current_spending',
  'remaining',
  'total',
  'sum',
  'income',
  'expense',
  'net',
  'spending',
  'spent',
  'overBy',
  'target_balance',
  'delta',
  'total_income',
  'total_expense',
  'total_account_balance',
  'transaction_total',
]);

const BOOLEAN_RESPONSE_KEYS = new Set([
  'is_active',
  'recurring',
  'must_change_password',
  'has_completed_onboarding',
  'is_default',
  'is_system',
  'email_verified',
  'was_active',
]);

function amountToCents(value, { allowZero = true } = {}) {
  const raw = typeof value === 'string' ? value.trim() : value;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || (!allowZero && amount <= 0)) {
    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
  }
  if (!/^-?\d+(\.\d+)?$/.test(String(raw))) {
    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
  }
  const sign = amount < 0 ? -1 : 1;
  const [intPart, decPart = ''] = String(raw).replace('-', '').split('.');
  const centsDigits = decPart.padEnd(3, '0').slice(0, 3);
  const roundedCents = parseInt(centsDigits.slice(0, 2), 10) + (Number(centsDigits[2]) >= 5 ? 1 : 0);
  const abs = parseInt(intPart, 10) * 100 + roundedCents;
  if (abs === 0 && amount !== 0) {
    throw Object.assign(new Error('amount is too small to represent in cents'), { statusCode: 400 });
  }
  return sign * abs;
}

function centsToAmount(value) {
  if (value === null || value === undefined) return value;
  const cents = Number(value);
  if (!Number.isFinite(cents)) return value;
  return parseFloat((Math.round(cents) / 100).toFixed(2));
}

function computeBalanceDelta(transaction) {
  const amount = Number(transaction.amount || 0);
  if (transaction.type === 'income') return amount;
  if (transaction.type === 'expense') return -amount;
  if (transaction.type === 'transfer') {
    const dir = transaction.transfer_direction ?? null;
    return dir === 'destination' ? amount : -amount;
  }
  return 0;
}

function serializeMoney(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => serializeMoney(item, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => {
    if (MONEY_RESPONSE_KEYS.has(childKey) && typeof childValue === 'number') {
      return [childKey, centsToAmount(childValue)];
    }
    if (BOOLEAN_RESPONSE_KEYS.has(childKey)) {
      if (childValue === 1) return [childKey, true];
      if (childValue === 0) return [childKey, false];
    }
    if (childKey === 'tags' && typeof childValue === 'string') {
      try {
        return [childKey, JSON.parse(childValue)];
      } catch {
        return [childKey, []];
      }
    }
    return [childKey, serializeMoney(childValue, childKey)];
  }));
}

module.exports = {
  amountToCents,
  centsToAmount,
  computeBalanceDelta,
  serializeMoney,
};
