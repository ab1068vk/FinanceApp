const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-money-roundtrip-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `../test-money-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../../src/app');
const { db, dbPath, migrateMoneyColumnsToCents } = require('../../database/db');

async function createSession(label = 'money') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function getCategory(accessToken, type = 'expense') {
  const response = await request(app).get('/api/categories').set('Authorization', `Bearer ${accessToken}`).expect(200);
  return response.body.data.find((category) => category.type === type) || response.body.data[0];
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('money roundtrips', () => {
  let session;
  let expenseCategory;
  let incomeCategory;

  beforeAll(async () => {
    session = await createSession();
    expenseCategory = await getCategory(session.accessToken, 'expense');
    incomeCategory = await getCategory(session.accessToken, 'income');
  });

  test('accounts store cents and return dollars', async () => {
    const created = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Cents Account', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card', balance: 10.50 })
      .expect(201);

    expect(created.body.balance).toBe(10.5);
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(created.body.id).balance).toBe(1050);

    const fetched = await request(app)
      .get(`/api/accounts/${created.body.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(fetched.body.balance).toBe(10.5);
    expect(fetched.body.current_balance).toBe(10.5);
  });

  test('transactions store cents, return dollars, and update balances in cents', async () => {
    const account = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Income Roundtrip', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card', balance: 100.00 })
      .expect(201);

    const transaction = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        account_id: account.body.id,
        category_id: incomeCategory.id,
        type: 'income',
        amount: 50.00,
        description: 'Roundtrip income',
        date: new Date().toISOString(),
      })
      .expect(201);

    expect(transaction.body.amount).toBe(50);
    expect(db.prepare('SELECT amount FROM transactions WHERE id = ?').get(transaction.body.id).amount).toBe(5000);

    const accountRow = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.body.id);
    expect(accountRow.balance).toBe(15000);

    const fetchedAccount = await request(app)
      .get(`/api/accounts/${account.body.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(fetchedAccount.body.balance).toBe(150);
    expect(fetchedAccount.body.current_balance).toBe(150);

    const fetchedTransaction = await request(app)
      .get(`/api/transactions/${transaction.body.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(fetchedTransaction.body.amount).toBe(50);
  });

  test('budgets store cents and return dollars', async () => {
    const startDate = new Date('2026-04-01T00:00:00.000Z').toISOString();
    const endDate = new Date('2026-04-30T23:59:59.999Z').toISOString();
    const created = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        category_id: expenseCategory.id,
        amount: 10.50,
        period: 'monthly',
        start_date: startDate,
        end_date: endDate,
      })
      .expect(201);

    expect(created.body.amount).toBe(10.5);
    expect(db.prepare('SELECT amount FROM budgets WHERE id = ?').get(created.body.id).amount).toBe(1050);

    const fetched = await request(app)
      .get(`/api/budgets/${created.body.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(fetched.body.amount).toBe(10.5);
    expect(fetched.body.current_spending).toBe(0);
    expect(fetched.body.remaining).toBe(10.5);
  });

  test('migrateMoneyColumnsToCents is idempotent on integer money columns', () => {
    const before = {
      accounts: db.prepare('SELECT id, balance, overdraft_limit FROM accounts ORDER BY id').all(),
      transactions: db.prepare('SELECT id, amount FROM transactions ORDER BY id').all(),
      budgets: db.prepare('SELECT id, amount FROM budgets ORDER BY id').all(),
    };

    migrateMoneyColumnsToCents();
    const afterFirstRun = {
      accounts: db.prepare('SELECT id, balance, overdraft_limit FROM accounts ORDER BY id').all(),
      transactions: db.prepare('SELECT id, amount FROM transactions ORDER BY id').all(),
      budgets: db.prepare('SELECT id, amount FROM budgets ORDER BY id').all(),
    };

    migrateMoneyColumnsToCents();
    const afterSecondRun = {
      accounts: db.prepare('SELECT id, balance, overdraft_limit FROM accounts ORDER BY id').all(),
      transactions: db.prepare('SELECT id, amount FROM transactions ORDER BY id').all(),
      budgets: db.prepare('SELECT id, amount FROM budgets ORDER BY id').all(),
    };

    expect(afterFirstRun).toEqual(before);
    expect(afterSecondRun).toEqual(afterFirstRun);
  });
});
