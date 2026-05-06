process.env.NODE_ENV = 'test';
process.env.MOBILE_APP_ORIGIN = 'http://localhost:19006';

const { resetUrlFor, verificationUrlFor } = require('../src/utils/passwordResetDelivery');

describe('Deep-link email URLs', () => {
  test('uses custom-scheme query links for reset and verification tokens', () => {
    expect(resetUrlFor('abc123abc123abc123abc123abc123abc123')).toBe('financeapp://reset-password?token=abc123abc123abc123abc123abc123abc123');
    expect(verificationUrlFor('def456def456def456def456def456def456')).toBe('financeapp://verify-email?token=def456def456def456def456def456def456');
  });
});
