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

function amountToCents(value, { allowZero = true } = {}) {
  const raw = typeof value === 'string' ? value.trim() : value;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || (!allowZero && amount <= 0)) {
    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(raw))) {
    throw Object.assign(new Error('amount must have no more than 2 decimal places'), { statusCode: 400 });
  }
  return Math.round(amount * 100);
}

function centsToAmount(value) {
  if (value === null || value === undefined) return value;
  const cents = Number(value);
  if (!Number.isFinite(cents)) return value;
  return cents / 100;
}

function moneySql(column) {
  return `ROUND(${column} / 100.0, 2)`;
}

function serializeMoney(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => serializeMoney(item, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => {
    if (MONEY_RESPONSE_KEYS.has(childKey) && typeof childValue === 'number') {
      return [childKey, centsToAmount(childValue)];
    }
    return [childKey, serializeMoney(childValue, childKey)];
  }));
}

module.exports = {
  amountToCents,
  centsToAmount,
  moneySql,
  serializeMoney,
};
