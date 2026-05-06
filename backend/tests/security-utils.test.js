const { maskEmail, redactValue, serializeAuditValue } = require('../src/utils/audit');
const { normalizeLogMessage, sanitizeLogText } = require('../src/utils/logger');
const { resetUrlFor } = require('../src/utils/passwordResetDelivery');
const { assertJwtSecret } = require('../src/utils/security');

describe('security utilities', () => {
  test('audit serialization preserves falsy values', () => {
    expect(serializeAuditValue(0)).toBe('0');
    expect(serializeAuditValue(false)).toBe('false');
    expect(serializeAuditValue('')).toBe('""');
    expect(serializeAuditValue(null)).toBeNull();
    expect(serializeAuditValue(undefined)).toBeNull();
  });

  test('email masking hides local part and domain body', () => {
    expect(maskEmail('alice@example.com')).toBe('***@***.com');
  });

  test('redaction does not leak deeply nested sensitive values', () => {
    const payload = { a: [{ b: { c: { d: { token: 'live-token' } } } }] };
    const redacted = JSON.stringify(redactValue(payload));
    expect(redacted).not.toContain('live-token');
  });

  test('console log sanitizer removes newlines and ANSI escapes', () => {
    expect(sanitizeLogText('ok\n\x1b[31mfake\rline')).toBe('ok fake line');
  });

  test('logger message normalizer prevents blank error entries', () => {
    expect(normalizeLogMessage(undefined)).toBe('Log entry without message');
    expect(normalizeLogMessage(null)).toBe('Log entry without message');
    expect(normalizeLogMessage('server stopped')).toBe('server stopped');
  });

  test('password reset URLs put tokens in a path segment', () => {
    process.env.PASSWORD_RESET_URL = 'https://financeapp.test/auth';
    const url = resetUrlFor('token value');
    expect(url).toContain('/auth/reset-password/token%20value');
    expect(url).not.toContain('resetToken=');
    delete process.env.PASSWORD_RESET_URL;
  });

  test('JWT secret validator requires at least 32 bytes', () => {
    expect(() => assertJwtSecret('short')).toThrow(/32 bytes/);
    expect(() => assertJwtSecret('a'.repeat(32))).not.toThrow();
  });
});
