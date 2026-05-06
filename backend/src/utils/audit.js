const SENSITIVE_KEY_PATTERN = /(password|passcode|token|secret|authorization|cookie|hash|jwt)/i;
const PRIVATE_TEXT_KEYS = new Set(['description', 'note', 'receipt_path', 'tags', 'full_name']);
const MONEY_KEYS = new Set(['amount', 'balance', 'current_balance', 'transaction_total', 'total_volume']);

function maskEmail(value) {
  if (typeof value !== 'string' || !value.includes('@')) return '[REDACTED_EMAIL]';
  const domain = value.split('@').pop();
  const tld = domain.includes('.') ? domain.split('.').pop() : 'redacted';
  return `***@***.${tld}`;
}

function redactValue(value, key = '', depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[REDACTED_DEPTH]';

  const normalizedKey = key.toLowerCase();

  if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) return '[REDACTED]';
  if (normalizedKey === 'email') return maskEmail(value);
  if (PRIVATE_TEXT_KEYS.has(normalizedKey)) return '[REDACTED]';
  if (MONEY_KEYS.has(normalizedKey)) return '[REDACTED_AMOUNT]';

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey, depth + 1)]));
  }

  if (typeof value === 'string' && value.length > 128) {
    return `${value.slice(0, 32)}...[TRUNCATED]`;
  }

  return value;
}

function serializeAuditValue(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(redactValue(value));
}

module.exports = {
  maskEmail,
  redactValue,
  serializeAuditValue,
};
