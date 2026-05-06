const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-reports-32-bytes-minimum';
process.env.DB_PATH = path.join(__dirname, `test-reports-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

let accessToken;
let accountId;
let categories = {};
const transactionIds = [];

async function createSession() {
  const credentials = {
    email: `reports-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'Reports Tester',
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
      name: 'Reports Checking',
      type: 'checking',
      currency: 'USD',
      color: '#27AE60',
      icon: 'dollar-sign',
    })
    .expect(201);
  return response.body;
}

async function getCategories(token) {
  const response = await request(app)
    .get('/api/categories')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const cats = {};
  for (const category of response.body.data) {
    if (!cats[category.type]) cats[category.type] = category;
  }
  return cats;
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

describe('Reports Data Tests', () => {
  const transactionDates = {};

  beforeAll(async () => {
    const session = await createSession();
    accessToken = session.accessToken;
    accountId = (await createAccount(accessToken)).id;
    categories = await getCategories(accessToken);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const transactions = [
      { type: 'income', amount: 1000, description: 'Salary', day: 1 },
      { type: 'income', amount: 500, description: 'Freelance', day: 10 },
      { type: 'expense', amount: 200, description: 'Groceries', day: 3 },
      { type: 'expense', amount: 150, description: 'Utilities', day: 7 },
      { type: 'expense', amount: 80, description: 'Transport', day: 12 },
      { type: 'expense', amount: 300, description: 'Entertainment', day: 15 },
      { type: 'expense', amount: 120, description: 'Health', day: 20 },
      { type: 'expense', amount: 60, description: 'Shopping', day: 25 },
    ];

    for (const tx of transactions) {
      const date = new Date(year, month, tx.day, 10, 0, 0, 0).toISOString();
      transactionDates[tx.description] = date;

      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          account_id: accountId,
          category_id: tx.type === 'income' ? categories.income.id : categories.expense.id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description,
          date,
        })
        .expect(201);

      transactionIds.push(response.body.id || response.body.transactions?.[0]?.id);
    }

    console.log('\nCREATED TEST DATA:', {
      totalTransactions: transactions.length,
      totalIncome: 1500,
      totalExpense: 910,
      dateRange: `${new Date(year, month, 1).toISOString().slice(0, 10)} to ${new Date(year, month + 1, 0).toISOString().slice(0, 10)}`,
    });
  });

  test('STEP 1: Transaction summary returns correct totals for current month', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const response = await request(app)
      .get('/api/transactions/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ start_date: startDate, end_date: endDate })
      .expect(200);

    console.log('\nTRANSACTION SUMMARY API RESPONSE:', response.body);
    console.log('EXPECTED VALUES:', {
      total_income: 1500,
      total_expense: 910,
      net: 590,
    });

    expect(Number(response.body.total_income)).toBe(1500);
    expect(Number(response.body.total_expense)).toBe(910);
    expect(Number(response.body.net)).toBe(590);
  });

  test('STEP 2: Transaction list returns all transactions for current month', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const response = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ start_date: startDate, end_date: endDate, limit: 50 })
      .expect(200);

    console.log('\nTRANSACTION LIST RESPONSE:', {
      count: response.body.data.length,
      pagination: response.body.pagination,
      types: response.body.data.map((transaction) => ({
        type: transaction.type,
        amount: transaction.amount,
        description: transaction.description,
      })),
    });

    expect(response.body.data.length).toBe(8);
    expect(response.body.pagination.total).toBe(8);
  });

  test('STEP 3: Test date boundary - transaction on first day of month is included', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth(), 1, 23, 59, 59, 999).toISOString();

    const response = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ start_date: startDate, end_date: endDate })
      .expect(200);

    console.log('\nFIRST DAY TRANSACTIONS:', response.body.data);

    const hasSalary = response.body.data.some((transaction) => transaction.description === 'Salary');
    console.log('Salary transaction on day 1 found:', hasSalary);
    expect(hasSalary).toBe(true);
  });

  test('STEP 4: Test date boundary - transaction on last day of month is included', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 0, 0, 0, 0).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const lastDayDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12, 0, 0, 0).toISOString();
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: categories.expense.id,
        type: 'expense',
        amount: 50,
        description: 'Last Day Expense',
        date: lastDayDate,
      })
      .expect(201);

    const response = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ start_date: startDate, end_date: endDate })
      .expect(200);

    const hasLastDay = response.body.data.some((transaction) => transaction.description === 'Last Day Expense');
    console.log('\nLAST DAY BOUNDARY TEST:', {
      startDate,
      endDate,
      lastDayTransaction: lastDayDate,
      found: hasLastDay,
    });

    expect(hasLastDay).toBe(true);
  });

  test('STEP 5: Verify grouped_by_category returns correct spending', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const response = await request(app)
      .get('/api/transactions/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ start_date: startDate, end_date: endDate })
      .expect(200);

    console.log('\nGROUPED BY CATEGORY:', response.body.grouped_by_category);

    expect(response.body.grouped_by_category.length).toBeGreaterThan(0);

    const expenseSum = response.body.grouped_by_category
      .filter((group) => group.type === 'expense')
      .reduce((sum, group) => sum + Number(group.total), 0);

    console.log('EXPENSE VERIFICATION:', {
      expense_sum_from_groups: expenseSum,
      total_expense_from_api: response.body.total_expense,
      match: expenseSum === Number(response.body.total_expense),
    });

    expect(expenseSum).toBe(Number(response.body.total_expense));
  });
});
