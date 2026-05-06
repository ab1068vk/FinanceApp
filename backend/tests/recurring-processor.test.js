const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-recurring-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-recurring-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const { db, dbPath } = require('../database/db');
const { addFrequency, processRecurringTransactions } = require('../src/utils/recurringProcessor');

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function createUser(label) {
  const user = {
    id: id(),
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password_hash: '$2b$12$U4FllaCUfwsaj732rMkmH.qcIo.jMD8ycJcyK9.W7PX0Y/9cp7GvK',
    full_name: `${label} User`,
    role: 'user',
    is_active: 1,
    created_at: nowIso(),
    email_verified_at: nowIso(),
    security_stamp: crypto.randomBytes(32).toString('hex'),
  };
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, email_verified_at, security_stamp)
    VALUES (@id, @email, @password_hash, @full_name, @role, @is_active, @created_at, @email_verified_at, @security_stamp)
  `).run(user);
  return user;
}

function createAccount(userId, overrides = {}) {
  const account = {
    id: id(),
    user_id: userId,
    name: 'Checking',
    type: 'checking',
    balance: 100,
    overdraft_limit: 0,
    currency: 'USD',
    color: '#0F3460',
    icon: 'credit-card',
    is_active: 1,
    created_at: nowIso(),
    updated_at: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
    VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)
  `).run(account);
  return account;
}

function createCategory(userId, type = 'expense') {
  const category = {
    id: id(),
    user_id: userId,
    name: type === 'income' ? 'Salary' : 'Bills',
    icon: 'tag',
    color: '#E94560',
    type,
    sort_order: 1,
    created_at: nowIso(),
  };
  db.prepare(`
    INSERT INTO categories (id, user_id, name, icon, color, type, is_default, is_system, is_active, sort_order, created_at)
    VALUES (@id, @user_id, @name, @icon, @color, @type, 0, 0, 1, @sort_order, @created_at)
  `).run(category);
  return category;
}

function createRule(userId, accountId, categoryId, overrides = {}) {
  const rule = {
    id: id(),
    user_id: userId,
    account_id: accountId,
    category_id: categoryId,
    amount: 25,
    description: 'Recurring bill',
    frequency: 'monthly',
    next_due_date: '2026-05-06',
    last_processed_date: null,
    is_active: 1,
    created_at: nowIso(),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO recurring_transactions (
      id, user_id, account_id, category_id, amount, description, frequency,
      next_due_date, last_processed_date, is_active, created_at
    )
    VALUES (
      @id, @user_id, @account_id, @category_id, @amount, @description, @frequency,
      @next_due_date, @last_processed_date, @is_active, @created_at
    )
  `).run(rule);
  return rule;
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Recurring transaction processor', () => {
  test('posts a due recurring transaction and updates account balance atomically', () => {
    const user = createUser('recurring-posts');
    const account = createAccount(user.id, { balance: 100, overdraft_limit: 0 });
    const category = createCategory(user.id, 'expense');
    const rule = createRule(user.id, account.id, category.id, { amount: 30, frequency: 'monthly' });

    const result = processRecurringTransactions(new Date('2026-05-06T12:00:00.000Z'));

    expect(result).toEqual([expect.objectContaining({ status: 'processed', rule_id: rule.id })]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND description = ?').get(user.id, 'Recurring bill').count).toBe(1);
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance).toBe(70);
    expect(db.prepare('SELECT last_processed_date, next_due_date FROM recurring_transactions WHERE id = ?').get(rule.id)).toEqual({
      last_processed_date: '2026-05-06',
      next_due_date: '2026-06-06',
    });
  });

  test('skips due transactions that would breach overdraft and creates a notification', () => {
    const user = createUser('recurring-skip');
    const account = createAccount(user.id, { balance: 0, overdraft_limit: 10 });
    const category = createCategory(user.id, 'expense');
    const rule = createRule(user.id, account.id, category.id, { amount: 25, frequency: 'weekly' });

    const result = processRecurringTransactions(new Date('2026-05-06T12:00:00.000Z'));

    expect(result).toEqual([expect.objectContaining({ status: 'skipped', rule_id: rule.id })]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND account_id = ?').get(user.id, account.id).count).toBe(0);
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND type = ?').get(user.id, 'recurring-transaction-skipped').count).toBe(1);
  });

  test('advances next_due_date correctly for every supported frequency', () => {
    expect(addFrequency('2026-05-06', 'daily')).toBe('2026-05-07');
    expect(addFrequency('2026-05-06', 'weekly')).toBe('2026-05-13');
    expect(addFrequency('2026-05-06', 'monthly')).toBe('2026-06-06');
    expect(addFrequency('2026-05-06', 'yearly')).toBe('2027-05-06');
  });

  test('does not double-post when run twice on the same day', () => {
    const user = createUser('recurring-once');
    const account = createAccount(user.id, { balance: 100, overdraft_limit: 0 });
    const category = createCategory(user.id, 'expense');
    const rule = createRule(user.id, account.id, category.id, { amount: 10, frequency: 'daily' });

    processRecurringTransactions(new Date('2026-05-06T08:00:00.000Z'));
    processRecurringTransactions(new Date('2026-05-06T16:00:00.000Z'));

    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND account_id = ?').get(user.id, account.id).count).toBe(1);
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance).toBe(90);
    expect(db.prepare('SELECT last_processed_date, next_due_date FROM recurring_transactions WHERE id = ?').get(rule.id)).toEqual({
      last_processed_date: '2026-05-06',
      next_due_date: '2026-05-07',
    });
  });
});
