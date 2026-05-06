export function sanitizeDecimalInput(value: string, maxDecimals = 2): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [integer = '', ...decimalParts] = cleaned.split('.');
  const decimal = decimalParts.join('').slice(0, maxDecimals);
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
  return decimalParts.length ? `${normalizedInteger || '0'}.${decimal}` : normalizedInteger;
}

export function parsePositiveMoney(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeMoney(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
