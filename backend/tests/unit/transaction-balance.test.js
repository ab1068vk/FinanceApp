const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-transaction-balance-32-bytes';
process.env.DB_PATH = path.join(__dirname, `../test-transaction-balance-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const { db, dbPath } = require('../../database/db');
const { __private: transactionPrivate } = require('../../src/controllers/transactionController');

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('transaction balance checks', () => {
  test('assertBalanceAllowed catches overdraft when called with the fresh account balance', () => {
    const staleAccount = { type: 'checking', balance: 10000, overdraft_limit: 0 };
    const freshAccount = { type: 'checking', balance: 2500, overdraft_limit: 0 };

    expect(() => transactionPrivate.assertBalanceAllowed(staleAccount, -7500)).not.toThrow();
    expect(() => transactionPrivate.assertBalanceAllowed(freshAccount, -7500)).toThrow(/overdraft limit/i);
  });
});
