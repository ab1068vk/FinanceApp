const crypto = require('crypto');
const { db } = require('../../database/db');

const DEFAULT_CASH_ACCOUNT = {
  name: 'Cash',
  type: 'cash',
  balance: 0,
  overdraft_limit: null,
  currency: 'USD',
  color: '#27AE60',
  icon: 'dollar-sign',
};

function nowIso() {
  return new Date().toISOString();
}

function createDefaultCashAccount(userId) {
  const account = {
    id: crypto.randomUUID(),
    user_id: userId,
    is_active: 1,
    created_at: nowIso(),
    updated_at: null,
    ...DEFAULT_CASH_ACCOUNT,
  };

  db.prepare(`
    INSERT INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
    VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)
  `).run(account);

  return account;
}

function getOrCreateDefaultCashAccount(userId) {
  return db.transaction(() => {
    const account = {
      id: crypto.randomUUID(),
      user_id: userId,
      is_active: 1,
      created_at: nowIso(),
      updated_at: null,
      ...DEFAULT_CASH_ACCOUNT,
    };

    db.prepare(`
      INSERT OR IGNORE INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
      VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)
    `).run(account);

    return db.prepare(`
      SELECT * FROM accounts
      WHERE user_id = ? AND is_active = 1 AND type = ? AND name = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(userId, DEFAULT_CASH_ACCOUNT.type, DEFAULT_CASH_ACCOUNT.name);
  })();
}

module.exports = {
  DEFAULT_CASH_ACCOUNT,
  createDefaultCashAccount,
  getOrCreateDefaultCashAccount,
};
