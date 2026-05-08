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
  return Math.round(cents) / 100;
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
