const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-balance-reconcile-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-balance-reconcile-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');
const { accountCurrentBalanceExpr, reconcileAccountBalances } = require('../src/utils/accountBalance');

async function createSession(label = 'reconcile', role = 'user') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  if (role === 'admin') db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', credentials.email);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createAccountWithTransaction(session, amount = 25) {
  const account = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({ name: `Recon ${Date.now()}`, type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  const categories = await request(app)
    .get('/api/categories')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .expect(200);
  const category = categories.body.data.find((item) => item.type === 'income');
  await request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({
      account_id: account.body.id,
      category_id: category.id,
      type: 'income',
      amount,
      description: 'Reconciliation seed',
      date: new Date().toISOString(),
    })
    .expect(201);
  return account.body;
}

function accountBalances(accountId) {
  return db.prepare(`
    SELECT a.balance, ${accountCurrentBalanceExpr('a')} AS derived_balance
    FROM accounts a
    WHERE a.id = ?
  `).get(accountId);
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('account balance reconciliation', () => {
  let admin;
  let user;

  beforeAll(async () => {
    admin = await createSession('reconcile-admin', 'admin');
    user = await createSession('reconcile-user');
  });

  test('detects and flags stored balance drift caused by direct DB writes', async () => {
    const account = await createAccountWithTransaction(user, 25);
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(9999, account.id);

    const result = reconcileAccountBalances({ source: 'unit-test' });

    expect(result).toEqual(expect.objectContaining({
      drift_count: 1,
      repaired_count: 0,
      notification_count: 1,
    }));
    expect(result.drifts[0]).toEqual(expect.objectContaining({
      account_id: account.id,
      user_id: user.user.id,
      stored_balance: 9999,
      derived_balance: 2500,
      difference: 7499,
      repaired: false,
    }));

    const marker = db.prepare("SELECT * FROM account_balance_drifts WHERE account_id = ? AND status = 'open'").get(account.id);
    expect(marker).toEqual(expect.objectContaining({
      account_id: account.id,
      user_id: user.user.id,
      stored_balance: 9999,
      derived_balance: 2500,
      difference: 7499,
      status: 'open',
    }));

    const notification = db.prepare(`
      SELECT *
      FROM notifications
      WHERE user_id = ? AND type = 'account-balance-drift'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(admin.user.id);
    expect(notification).toBeTruthy();
    expect(JSON.parse(notification.data_json)).toEqual(expect.objectContaining({
      account_id: account.id,
      affected_user_id: user.user.id,
      difference: 7499,
    }));

    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(2500, account.id);
  });

  test('auto-repair updates stored balance back to the derived transaction balance', async () => {
    const account = await createAccountWithTransaction(user, 40);
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(4100, account.id);

    const result = reconcileAccountBalances({ autoRepair: true, maxAutoRepairCents: 200, source: 'unit-test' });

    expect(result).toEqual(expect.objectContaining({
      drift_count: 1,
      repaired_count: 1,
    }));
    const balances = accountBalances(account.id);
    expect(balances.balance).toBe(balances.derived_balance);
    expect(balances.balance).toBe(4000);

    const marker = db.prepare("SELECT * FROM account_balance_drifts WHERE account_id = ? AND status = 'repaired' ORDER BY updated_at DESC LIMIT 1").get(account.id);
    expect(marker).toEqual(expect.objectContaining({
      stored_balance: 4100,
      derived_balance: 4000,
      difference: 100,
      status: 'repaired',
    }));
  });

  test('admin database reconcile endpoint detects and repairs drift on demand', async () => {
    const account = await createAccountWithTransaction(user, 55);
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(5600, account.id);

    const response = await request(app)
      .post('/api/admin/database/reconcile')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ auto_repair: true, max_auto_repair: 2 })
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      checked: expect.any(Number),
      drift_count: 1,
      repaired_count: 1,
      auto_repair: true,
      max_auto_repair_cents: 200,
    }));
    expect(response.body.drifts[0]).toEqual(expect.objectContaining({
      account_id: account.id,
      stored_balance: 56,
      derived_balance: 55,
      difference: 1,
      repaired: true,
    }));
    const balances = accountBalances(account.id);
    expect(balances.balance).toBe(5500);
    expect(balances.derived_balance).toBe(5500);
  });
});
