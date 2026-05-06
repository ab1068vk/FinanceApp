const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-balance-32-bytes-min';
process.env.DB_PATH = path.join(__dirname, `test-balance-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

let accessToken;
let account1;
let account2;
let incomeCategory;
let expenseCategory;

async function createSession() {
  const credentials = {
    email: `balance-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'Balance Tester',
  };
  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);
  return login.body;
}

async function createAccount(token, name) {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  return response.body;
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbPath}${suffix}`);
    } catch {
      /* ignore */
    }
  }
});

describe('Account Balance Accuracy', () => {
  beforeAll(async () => {
    const session = await createSession();
    accessToken = session.accessToken;
    account1 = await createAccount(accessToken, 'Account 1');
    account2 = await createAccount(accessToken, 'Account 2');

    const categories = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    incomeCategory = categories.body.data.find((category) => category.type === 'income');
    expenseCategory = categories.body.data.find((category) => category.type === 'expense');

    console.log('\nSETUP:', {
      account1: account1.name,
      account2: account2.name,
      incomeCategory: incomeCategory.name,
      expenseCategory: expenseCategory.name,
    });
  });

  test('Initial account balances should be 0', async () => {
    const a1 = await request(app)
      .get(`/api/accounts/${account1.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const a2 = await request(app)
      .get(`/api/accounts/${account2.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('\nINITIAL BALANCES:', {
      account1: { balance: a1.body.balance, current_balance: a1.body.current_balance },
      account2: { balance: a2.body.balance, current_balance: a2.body.current_balance },
    });

    expect(Number(a1.body.balance)).toBe(0);
    expect(Number(a2.body.balance)).toBe(0);
    expect(Number(a1.body.current_balance)).toBe(0);
    expect(Number(a2.body.current_balance)).toBe(0);
  });

  test('STEP 1: Income of 500 should increase balance by 500', async () => {
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: account1.id,
        category_id: incomeCategory.id,
        type: 'income',
        amount: 500,
        description: 'Income test',
        date: new Date().toISOString(),
      })
      .expect(201);

    const a1 = await request(app)
      .get(`/api/accounts/${account1.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('\nAFTER INCOME 500:', {
      balance: a1.body.balance,
      current_balance: a1.body.current_balance,
      expected: 500,
    });

    expect(Number(a1.body.balance)).toBe(500);
    expect(Number(a1.body.current_balance)).toBe(500);
  });

  test('STEP 2: Expense of 200 should decrease balance to 300', async () => {
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: account1.id,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 200,
        description: 'Expense test',
        date: new Date().toISOString(),
      })
      .expect(201);

    const a1 = await request(app)
      .get(`/api/accounts/${account1.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('\nAFTER EXPENSE 200:', {
      balance: a1.body.balance,
      current_balance: a1.body.current_balance,
      expected: 300,
    });

    expect(Number(a1.body.balance)).toBe(300);
    expect(Number(a1.body.current_balance)).toBe(300);
  });

  test('STEP 3: Transfer 100 from Account1 to Account2', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: account1.id,
        to_account_id: account2.id,
        category_id: expenseCategory.id,
        type: 'transfer',
        amount: 100,
        description: 'Transfer test',
        date: new Date().toISOString(),
      })
      .expect(201);

    console.log('\nTRANSFER RESPONSE:', response.body);

    const a1 = await request(app)
      .get(`/api/accounts/${account1.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const a2 = await request(app)
      .get(`/api/accounts/${account2.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('AFTER TRANSFER 100:', {
      account1: { balance: a1.body.balance, current_balance: a1.body.current_balance, expected: 200 },
      account2: { balance: a2.body.balance, current_balance: a2.body.current_balance, expected: 100 },
    });

    expect(Number(a1.body.balance)).toBe(200);
    expect(Number(a2.body.balance)).toBe(100);
    expect(Number(a1.body.current_balance)).toBe(200);
    expect(Number(a2.body.current_balance)).toBe(100);
  });

  test('STEP 4: Delete expense transaction should restore balance', async () => {
    const transactions = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ type: 'expense', limit: 10 })
      .expect(200);

    const expenseTx = transactions.body.data[0];
    console.log('\nDELETING EXPENSE:', { id: expenseTx.id, amount: expenseTx.amount });

    await request(app)
      .delete(`/api/transactions/${expenseTx.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirm: true })
      .expect(200);

    const a1 = await request(app)
      .get(`/api/accounts/${account1.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('AFTER DELETING EXPENSE:', {
      balance: a1.body.balance,
      current_balance: a1.body.current_balance,
      expected: 400,
    });

    expect(Number(a1.body.current_balance)).toBe(400);
  });

  test('STEP 5: Delete transfer should restore BOTH account balances', async () => {
    const transactions = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ type: 'transfer', limit: 10 })
      .expect(200);

    const transferTx = transactions.body.data[0];
    console.log('\nDELETING TRANSFER:', { id: transferTx.id });

    await request(app)
      .delete(`/api/transactions/${transferTx.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirm: true })
      .expect(200);

    const a1 = await request(app)
      .get(`/api/accounts/${account1.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const a2 = await request(app)
      .get(`/api/accounts/${account2.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('AFTER DELETING TRANSFER:', {
      account1: { balance: a1.body.balance, current_balance: a1.body.current_balance, expected: 500 },
      account2: { balance: a2.body.balance, current_balance: a2.body.current_balance, expected: 0 },
    });

    expect(Number(a1.body.current_balance)).toBe(500);
    expect(Number(a2.body.current_balance)).toBe(0);
  });
});
