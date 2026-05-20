const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

  test('updateBalance throws and rolls back when the target account is missing', () => {
    const marker = crypto.randomUUID();
    const run = db.transaction(() => {
      db.prepare(`
        INSERT INTO audit_logs (id, action, entity_type, entity_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(marker, 'BALANCE_ROLLBACK_TEST', 'test', marker, new Date().toISOString());
      transactionPrivate.updateBalance(crypto.randomUUID(), crypto.randomUUID(), 100);
    });

    expect(run).toThrow(/Account balance update failed/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE id = ?').get(marker).count).toBe(0);
  });
});
