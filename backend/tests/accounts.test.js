const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-accounts-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-accounts-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');
const { accountCurrentBalanceExpr } = require('../src/utils/accountBalance');

async function createSession(label = 'account') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createAccount(accessToken, name, balance = 0) {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name, type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card', balance })
    .expect(201);
  return response.body;
}

function accountBalanceRow(accountId) {
  return db.prepare(`
    SELECT a.balance, ${accountCurrentBalanceExpr('a')} AS current_balance
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

describe('Accounts API', () => {
  let owner;
  let other;
  let account;

  beforeAll(async () => {
    owner = await createSession('account-owner');
    other = await createSession('account-other');
  });

  test('creates an account with valid data', async () => {
    const response = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Checking', type: 'checking', currency: 'usd', color: '#0F3460', icon: 'credit-card', balance: 100 })
      .expect(201);

    account = response.body;
    expect(account).toEqual(expect.objectContaining({
      id: expect.any(String),
      user_id: owner.user.id,
      name: 'Checking',
      type: 'checking',
      currency: 'USD',
      balance: 100,
      is_active: true,
    }));
  });

  test('validates account money fields as non-negative amounts with two decimals', async () => {
    const basePayload = { name: 'Money Rules', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' };

    await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...basePayload, name: 'Three Decimal Balance', balance: 10.999 })
      .expect(400);

    const accepted = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...basePayload, name: 'Two Decimal Balance', balance: 10.99, overdraft_limit: 0 })
      .expect(201);
    expect(accepted.body.balance).toBe(10.99);
    expect(accepted.body.overdraft_limit).toBe(0);

    const zero = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...basePayload, name: 'Zero Balance', balance: 0 })
      .expect(201);
    expect(zero.body.balance).toBe(0);

    await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...basePayload, name: 'Negative Balance', balance: -5 })
      .expect(400);

    await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...basePayload, name: 'Invalid Balance', balance: 'abc' })
      .expect(400);
  });

  test('lists and retrieves only owned active accounts', async () => {
    const list = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(list.body.data.some((item) => item.id === account.id)).toBe(true);
    expect(list.body.data[0]).toHaveProperty('current_balance');
    expect(Number(list.body.data.find((item) => item.id === account.id).current_balance)).toBe(100);

    const detail = await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(detail.body.id).toBe(account.id);
    expect(Number(detail.body.current_balance)).toBe(100);
    expect(detail.body.recent_transactions.some((transaction) => transaction.description === 'Opening balance')).toBe(true);
    expect(Array.isArray(detail.body.recent_transactions)).toBe(true);

    await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
  });

  test('updates account profile fields', async () => {
    const response = await request(app)
      .put(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Emergency Fund', currency: 'cad', color: '#27AE60', icon: 'shield' })
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      id: account.id,
      name: 'Emergency Fund',
      currency: 'CAD',
      color: '#27AE60',
      icon: 'shield',
    }));
  });

  test('requires a transaction decision before deleting an account with transactions', async () => {
    await request(app)
      .delete(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400);
  });

  test('deletes an account and its transactions when requested', async () => {
    await request(app)
      .delete(`/api/accounts/${account.id}?transaction_action=delete`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    const list = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(list.body.data.some((item) => item.id === account.id)).toBe(false);

    const transactions = await request(app)
      .get(`/api/transactions?account_id=${account.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(transactions.body.pagination.total).toBe(0);
  });

  test('moves deleted account transactions to the default cash account when requested', async () => {
    const created = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Travel Wallet', type: 'checking', currency: 'usd', color: '#0F3460', icon: 'credit-card', balance: 75 })
      .expect(201);

    const beforeAccounts = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const cash = beforeAccounts.body.data.find((item) => item.name === 'Cash' && item.type === 'cash');
    expect(cash).toBeTruthy();

    const response = await request(app)
      .delete(`/api/accounts/${created.body.id}?transaction_action=cash`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.transactions).toEqual(expect.objectContaining({
      action: 'cash',
      moved: 1,
      cash_account_id: cash.id,
    }));

    const movedTransactions = await request(app)
      .get(`/api/transactions?account_id=${cash.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(movedTransactions.body.data.some((transaction) => transaction.description === 'Opening balance' && Number(transaction.amount) === 75)).toBe(true);
  });

  test('refuses to move an account to Cash when related transfer groups are incomplete', async () => {
    const broken = await createAccount(owner.accessToken, 'Broken Transfer Metadata');
    const accounts = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const cash = accounts.body.data.find((item) => item.name === 'Cash' && item.type === 'cash');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO transactions (
        id, user_id, account_id, category_id, type, amount, description, note, date,
        recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction,
        to_account_id, from_account_id, created_at, updated_at
      )
      VALUES (?, ?, ?, NULL, 'transfer', 1200, 'Incomplete legacy transfer', NULL, ?,
        0, NULL, NULL, '[]', ?, 'destination', NULL, ?, ?, NULL)
    `).run(crypto.randomUUID(), owner.user.id, cash.id, now, crypto.randomUUID(), broken.id, now);

    const response = await request(app)
      .delete(`/api/accounts/${broken.id}?transaction_action=cash`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(409);

    expect(response.body).toEqual({
      error: 'Please resolve incomplete transfers before moving this account to Cash',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'transfer_group_id',
          message: expect.stringContaining('expected 2 complete transfer rows'),
        }),
      ]),
    });
    expect(db.prepare('SELECT is_active FROM accounts WHERE id = ?').get(broken.id).is_active).toBe(1);
  });

  test('moves complete transfer groups to Cash with the correct balance delta', async () => {
    const source = await createAccount(owner.accessToken, 'Move Transfer Source');
    const destination = await createAccount(owner.accessToken, 'Move Transfer Destination');
    const beforeAccounts = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const cash = beforeAccounts.body.data.find((item) => item.name === 'Cash' && item.type === 'cash');
    const cashBefore = accountBalanceRow(cash.id);

    const transfer = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        account_id: source.id,
        to_account_id: destination.id,
        type: 'transfer',
        amount: 30,
        description: 'Move me to cash',
        date: new Date().toISOString(),
      })
      .expect(201);
    expect(transfer.body.transactions).toHaveLength(2);

    const response = await request(app)
      .delete(`/api/accounts/${source.id}?transaction_action=cash`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.transactions).toEqual(expect.objectContaining({
      action: 'cash',
      moved: 1,
      cash_account_id: cash.id,
    }));

    const cashAfter = accountBalanceRow(cash.id);
    expect(cashAfter.balance - cashBefore.balance).toBe(-3000);
    expect(cashAfter.current_balance - cashBefore.current_balance).toBe(-3000);
    expect(accountBalanceRow(destination.id)).toEqual(expect.objectContaining({
      balance: 3000,
      current_balance: 3000,
    }));
  });
});
