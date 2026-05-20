const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-admin-balance-correction-32';
process.env.DB_PATH = path.join(__dirname, `test-admin-balance-correction-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');
const logger = require('../src/utils/logger');
const {
  accountCurrentBalanceExpr,
  getAccountBalanceSnapshot,
  warnIfAccountBalanceMismatch,
} = require('../src/utils/accountBalance');

async function createSession(label, role = 'user') {
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

async function createCorrectableAccount(session) {
  const account = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({ name: 'Correction Drift', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
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
      amount: 20,
      description: 'Correction baseline',
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

describe('admin balance correction', () => {
  test('uses derived balance as the base so stored and derived balances agree after correction', async () => {
    const admin = await createSession('balance-correction-admin', 'admin');
    const user = await createSession('balance-correction-user');
    const account = await createCorrectableAccount(user);
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(500, account.id);

    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    const response = await request(app)
      .post(`/api/admin/users/${user.user.id}/accounts/${account.id}/correction`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ target_balance: 75, reason: 'Support verified drift correction' })
      .expect(201);

    expect(response.body.transaction).toEqual(expect.objectContaining({
      type: 'income',
      amount: 55,
      description: 'Admin balance correction',
    }));
    expect(response.body.account.balance).toBe(75);

    const balances = accountBalances(account.id);
    expect(balances.balance).toBe(7500);
    expect(balances.derived_balance).toBe(7500);

    warnIfAccountBalanceMismatch(getAccountBalanceSnapshot(account.id, user.user.id), { source: 'admin-balance-correction-test' });
    expect(warnSpy).not.toHaveBeenCalledWith('Account balance mismatch', expect.any(Object));
    warnSpy.mockRestore();
  });
});
