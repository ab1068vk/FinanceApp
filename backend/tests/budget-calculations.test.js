const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-budget-calc-32-bytes-min';
process.env.DB_PATH = path.join(__dirname, `test-budget-calc-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

let accessToken;
let accountId;
let categoryId;
let budgetId;

async function createSession() {
  const credentials = {
    email: `test-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'Budget Tester',
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);

  return login.body;
}

async function createAccount(token) {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Test Checking',
      type: 'checking',
      currency: 'USD',
      color: '#0F3460',
      icon: 'credit-card',
    })
    .expect(201);
  return response.body;
}

async function getExpenseCategory(token) {
  const response = await request(app)
    .get('/api/categories')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return response.body.data.find((category) => category.type === 'expense');
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

describe('Budget Calculation Tests', () => {
  beforeAll(async () => {
    const session = await createSession();
    accessToken = session.accessToken;
    accountId = (await createAccount(accessToken)).id;
    categoryId = (await getExpenseCategory(accessToken)).id;
  });

  test('STEP 1: Create budget for current month - verify initial spending is 0', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        category_id: categoryId,
        amount: 500,
        period: 'monthly',
        start_date: startDate,
        end_date: endDate,
      })
      .expect(201);

    budgetId = response.body.id;
    console.log('\nBUDGET CREATED:', {
      id: budgetId,
      amount: response.body.amount,
      startDate: response.body.start_date,
      endDate: response.body.end_date,
      period: response.body.period,
    });

    const budgets = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const budget = budgets.body.data.find((item) => item.id === budgetId);
    console.log('INITIAL BUDGET STATE:', {
      budgeted: budget.amount,
      current_spending: budget.current_spending,
      remaining: budget.remaining,
    });

    expect(Number(budget.current_spending)).toBe(0);
    expect(Number(budget.remaining)).toBe(500);
  });

  test('STEP 2: Add expense transaction matching budget category - verify spending updates', async () => {
    const now = new Date();
    const transactionDate = new Date(now.getFullYear(), now.getMonth(), 15, 10, 0, 0, 0).toISOString();

    console.log('\nADDING TRANSACTION:', {
      amount: 75.50,
      date: transactionDate,
      categoryId,
      accountId,
    });

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: categoryId,
        type: 'expense',
        amount: 75.50,
        description: 'Budget test expense',
        date: transactionDate,
      })
      .expect(201);

    const budgets = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const budget = budgets.body.data.find((item) => item.id === budgetId);
    console.log('BUDGET AFTER EXPENSE:', {
      budgeted: budget.amount,
      current_spending: budget.current_spending,
      remaining: budget.remaining,
      expected_spending: 75.50,
      expected_remaining: 424.50,
    });

    expect(Number(budget.current_spending)).toBe(75.50);
    expect(Number(budget.remaining)).toBe(424.50);
  });

  test('STEP 3: Add another expense on the last day of month - verify end_date is inclusive', async () => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 18, 0, 0, 0).toISOString();

    console.log('\nADDING TRANSACTION ON LAST DAY:', {
      amount: 100,
      date: lastDay,
      note: 'This transaction is on the last day of the month',
    });

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: categoryId,
        type: 'expense',
        amount: 100,
        description: 'End of month expense',
        date: lastDay,
      })
      .expect(201);

    const budgets = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const budget = budgets.body.data.find((item) => item.id === budgetId);
    console.log('BUDGET AFTER END-OF-MONTH EXPENSE:', {
      current_spending: budget.current_spending,
      expected_spending: 175.50,
      remaining: budget.remaining,
      expected_remaining: 324.50,
    });

    expect(Number(budget.current_spending)).toBe(175.50);
    expect(Number(budget.remaining)).toBe(324.50);
  });

  test('STEP 4: Add expense OUTSIDE budget period - verify it is NOT counted', async () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 5, 10, 0, 0, 0).toISOString();

    console.log('\nADDING TRANSACTION OUTSIDE BUDGET:', {
      amount: 200,
      date: nextMonth,
      note: 'This transaction is next month, should NOT affect budget',
    });

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: categoryId,
        type: 'expense',
        amount: 200,
        description: 'Next month expense - ignore me',
        date: nextMonth,
      })
      .expect(201);

    const budgets = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const budget = budgets.body.data.find((item) => item.id === budgetId);
    console.log('BUDGET AFTER OUT-OF-RANGE EXPENSE:', {
      current_spending: budget.current_spending,
      expected_spending: 175.50,
      note: 'Should still be 175.50 because 200 is next month',
    });

    expect(Number(budget.current_spending)).toBe(175.50);
  });

  test('STEP 5: Verify budget detail endpoint matches list endpoint', async () => {
    const detail = await request(app)
      .get(`/api/budgets/${budgetId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const list = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const listBudget = list.body.data.find((item) => item.id === budgetId);

    console.log('\nCOMPARING BUDGET ENDPOINTS:', {
      detail_spending: detail.body.current_spending,
      list_spending: listBudget.current_spending,
      detail_remaining: detail.body.remaining,
      list_remaining: listBudget.remaining,
      match: detail.body.current_spending === listBudget.current_spending,
    });

    expect(Number(detail.body.current_spending)).toBe(Number(listBudget.current_spending));
    expect(Number(detail.body.remaining)).toBe(Number(listBudget.remaining));
  });

  test('STEP 6: Verify account balance reflects all transactions', async () => {
    const account = await request(app)
      .get(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('\nACCOUNT BALANCE:', {
      balance: account.body.balance,
      current_balance: account.body.current_balance,
      expected: -375.50,
      note: 'current_balance includes all transactions, including the next-month expense',
    });

    expect(Number(account.body.balance)).toBe(-375.50);
    expect(Number(account.body.current_balance)).toBe(-375.50);
  });
});
