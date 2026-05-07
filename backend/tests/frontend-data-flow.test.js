/**
 * Frontend Data Flow Tests
 * Tests API response shapes and data transformations consumed by frontend flows.
 * Run with: npx jest tests/frontend-data-flow.test.js --verbose
 */

const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-dataflow-32-bytes-minimum';
process.env.DB_PATH = path.join(__dirname, `test-dataflow-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const request = require('supertest');
const app = require('../src/app');
const { db, dbPath } = require('../database/db');

let accessToken;
let session;
let account1;
let expenseCategory;
let incomeCategory;
let budgetId;

async function createSession() {
  const credentials = {
    email: `dataflow-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'DataFlow Tester',
  };
  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);
  return login.body;
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

describe('Frontend Data Flow - Redux Store Integration', () => {
  beforeAll(async () => {
    session = await createSession();
    accessToken = session.accessToken;

    account1 = (await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Main Account', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
      .expect(201)).body;

    await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Savings Account', type: 'savings', currency: 'USD', color: '#27AE60', icon: 'dollar-sign' })
      .expect(201);

    const catsResponse = (await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body;
    const cats = catsResponse.data;

    incomeCategory = cats.find((category) => category.type === 'income');
    expenseCategory = cats.find((category) => category.type === 'expense');
  });

  test('DATA FLOW 1: Create transactions and verify GET response shape', async () => {
    const txData = [
      { type: 'income', amount: 1000, description: 'Salary' },
      { type: 'income', amount: 500, description: 'Bonus' },
      { type: 'expense', amount: 200, description: 'Rent' },
      { type: 'expense', amount: 150, description: 'Food' },
      { type: 'expense', amount: 80, description: 'Transport' },
    ];

    for (const tx of txData) {
      await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          account_id: account1.id,
          category_id: tx.type === 'income' ? incomeCategory.id : expenseCategory.id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description,
          date: new Date().toISOString(),
        })
        .expect(201);
    }

    const txResponse = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ limit: 20, page: 1 })
      .expect(200);

    console.log('\nTRANSACTION RESPONSE SHAPE:', {
      hasDataArray: Array.isArray(txResponse.body.data),
      dataLength: txResponse.body.data?.length,
      paginationShape: txResponse.body.pagination,
      hasRequiredFields: txResponse.body.data?.[0] ? {
        hasId: Boolean(txResponse.body.data[0].id),
        hasType: Boolean(txResponse.body.data[0].type),
        hasAmount: typeof txResponse.body.data[0].amount === 'number',
        hasDate: Boolean(txResponse.body.data[0].date),
        hasCategoryName: Boolean(txResponse.body.data[0].category_name),
        hasAccountName: Boolean(txResponse.body.data[0].account_name),
      } : 'NO_DATA',
    });

    expect(Array.isArray(txResponse.body.data)).toBe(true);
    expect(txResponse.body.data.length).toBe(5);
    expect(txResponse.body.pagination).toHaveProperty('page', 1);
    expect(txResponse.body.pagination).toHaveProperty('total', 5);
    expect(txResponse.body.pagination).toHaveProperty('totalPages');
    expect(txResponse.body.pagination).toHaveProperty('limit');
  });

  test('DATA FLOW 2: Test pagination accuracy with multiple pages', async () => {
    for (let i = 0; i < 25; i += 1) {
      await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          account_id: account1.id,
          category_id: expenseCategory.id,
          type: 'expense',
          amount: 10,
          description: `Test Transaction ${i}`,
          date: new Date().toISOString(),
        })
        .expect(201);
    }

    const page1 = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ limit: 10, page: 1 })
      .expect(200);

    const page2 = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ limit: 10, page: 2 })
      .expect(200);

    const page3 = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ limit: 10, page: 3 })
      .expect(200);

    console.log('\nPAGINATION TEST:', {
      page1: { count: page1.body.data.length, total: page1.body.pagination.total, page: page1.body.pagination.page },
      page2: { count: page2.body.data.length, total: page2.body.pagination.total, page: page2.body.pagination.page },
      page3: { count: page3.body.data.length, total: page3.body.pagination.total, page: page3.body.pagination.page },
      noOverlap: !page1.body.data.some((t1) => page2.body.data.some((t2) => t2.id === t1.id)),
    });

    expect(page1.body.data.length).toBe(10);
    expect(page2.body.data.length).toBe(10);
    expect(page3.body.data.length).toBe(10);
    expect(page1.body.pagination.total).toBe(30);

    const page1Ids = new Set(page1.body.data.map((transaction) => transaction.id));
    const page2Ids = new Set(page2.body.data.map((transaction) => transaction.id));
    const overlap = [...page1Ids].filter((id) => page2Ids.has(id));
    expect(overlap.length).toBe(0);
  });

  test('DATA FLOW 3: Test filtering accuracy', async () => {
    const incomeOnly = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ type: 'income', limit: 50 })
      .expect(200);

    const expenseOnly = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ type: 'expense', limit: 50 })
      .expect(200);

    console.log('\nFILTER TEST:', {
      incomeCount: incomeOnly.body.data.length,
      expenseCount: expenseOnly.body.data.length,
      totalCount: incomeOnly.body.data.length + expenseOnly.body.data.length,
      allIncome: incomeOnly.body.data.every((transaction) => transaction.type === 'income'),
      allExpense: expenseOnly.body.data.every((transaction) => transaction.type === 'expense'),
    });

    expect(incomeOnly.body.data.every((transaction) => transaction.type === 'income')).toBe(true);
    expect(expenseOnly.body.data.every((transaction) => transaction.type === 'expense')).toBe(true);
  });

  test('DATA FLOW 4: Test search functionality', async () => {
    const searchResult = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ search: 'Salary', limit: 50 })
      .expect(200);

    const emptySearch = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ search: 'NONEXISTENT_QUERY_XYZ', limit: 50 })
      .expect(200);

    console.log('\nSEARCH TEST:', {
      searchTerm: 'Salary',
      resultsFound: searchResult.body.data.length,
      resultsMatch: searchResult.body.data.every((transaction) => transaction.description?.toLowerCase().includes('salary')),
      emptySearchResults: emptySearch.body.data.length,
    });

    expect(searchResult.body.data.length).toBeGreaterThan(0);
    expect(emptySearch.body.data.length).toBe(0);
  });

  test('DATA FLOW 5: Test budget creation and spending calculation consistency', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const budgetCategory = (await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: `Budget Flow ${Date.now()}`, type: 'expense', color: '#E94560', icon: 'target' })
      .expect(201)).body;

    const budget = (await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        category_id: budgetCategory.id,
        amount: 1000,
        period: 'monthly',
        start_date: startDate,
        end_date: endDate,
      })
      .expect(201)).body;

    budgetId = budget.id;

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: account1.id,
        category_id: budgetCategory.id,
        type: 'expense',
        amount: 300,
        description: 'Budgeted expense 1',
        date: new Date(now.getFullYear(), now.getMonth(), 10, 12, 0, 0, 0).toISOString(),
      })
      .expect(201);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: account1.id,
        category_id: budgetCategory.id,
        type: 'expense',
        amount: 250,
        description: 'Budgeted expense 2',
        date: new Date(now.getFullYear(), now.getMonth(), 20, 12, 0, 0, 0).toISOString(),
      })
      .expect(201);

    const budgetListResponse = (await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body;
    const budgetList = budgetListResponse.data;

    const foundBudget = budgetList.find((item) => item.id === budgetId);

    const budgetDetail = (await request(app)
      .get(`/api/budgets/${budgetId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body;

    console.log('\nBUDGET CONSISTENCY CHECK:', {
      list_spending: Number(foundBudget?.current_spending),
      list_remaining: Number(foundBudget?.remaining),
      detail_spending: Number(budgetDetail.current_spending),
      detail_remaining: Number(budgetDetail.remaining),
      expected_spending: 550,
      expected_remaining: 450,
      list_detail_match: Number(foundBudget?.current_spending) === Number(budgetDetail.current_spending),
    });

    expect(Number(foundBudget.current_spending)).toBe(550);
    expect(Number(foundBudget.remaining)).toBe(450);
    expect(Number(budgetDetail.current_spending)).toBe(550);
    expect(Number(budgetDetail.remaining)).toBe(450);
  });

  test('DATA FLOW 6: Test accounts list response shape', async () => {
    const accountsResponse = (await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body;
    const accounts = accountsResponse.data;

    console.log('\nACCOUNTS RESPONSE SHAPE:', {
      count: accounts.length,
      firstAccount: accounts[0] ? {
        hasId: Boolean(accounts[0].id),
        hasName: Boolean(accounts[0].name),
        hasType: Boolean(accounts[0].type),
        hasBalance: typeof accounts[0].balance === 'number',
        hasCurrentBalance: typeof accounts[0].current_balance === 'number',
        hasCurrency: Boolean(accounts[0].currency),
        hasColor: Boolean(accounts[0].color),
        hasIcon: Boolean(accounts[0].icon),
        isActive: accounts[0].is_active,
      } : 'NO_ACCOUNTS',
      allHaveCurrentBalance: accounts.every((account) => typeof account.current_balance === 'number'),
    });

    expect(Array.isArray(accounts)).toBe(true);
    expect(accountsResponse.pagination).toEqual(expect.objectContaining({ page: 1, page_size: 50, total_count: expect.any(Number) }));
    expect(accounts.length).toBeGreaterThanOrEqual(2);
    expect(typeof accounts[0].current_balance).toBe('number');
    expect(typeof accounts[0].balance).toBe('number');
  });

  test('DATA FLOW 7: Test admin dashboard stats response shape', async () => {
    const { db: database } = require('../database/db');
    database.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', session.user.id);

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: session.user.email, password: 'StrongPass1!' })
      .expect(200);

    const stats = (await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(200)).body;

    console.log('\nADMIN DASHBOARD STATS SHAPE:', {
      hasTotalUsers: Boolean(stats.total_users),
      hasTotalTransactions: Boolean(stats.total_transactions),
      hasTotalAccounts: typeof stats.total_accounts === 'number',
      hasNewUsers: typeof stats.new_users_this_month === 'number',
      hasNewTransactions: typeof stats.new_transactions_this_month === 'number',
      hasTopCategories: Array.isArray(stats.top_5_categories_by_spending),
      hasDailyVolume: Array.isArray(stats.daily_transaction_volume),
      hasSystemHealth: Boolean(stats.system_health),
      topCategoriesWithTotals: stats.top_5_categories_by_spending?.every((category) => category.category_name && typeof category.total === 'number'),
    });

    expect(stats.total_users).toBeDefined();
    expect(stats.total_transactions).toBeDefined();
    expect(typeof stats.total_accounts).toBe('number');
    expect(Array.isArray(stats.top_5_categories_by_spending)).toBe(true);
    expect(Array.isArray(stats.daily_transaction_volume)).toBe(true);
  });

  test('DATA FLOW 8: Test transactions sort order is newest first', async () => {
    const allTx = (await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ limit: 50 })
      .expect(200)).body;

    const dates = allTx.data.map((transaction) => new Date(transaction.date).getTime());
    const isDescending = dates.every((date, index) => index === 0 || date <= dates[index - 1]);

    console.log('\nSORT ORDER TEST:', {
      totalTransactions: allTx.data.length,
      isNewestFirst: isDescending,
      sampleDates: allTx.data.slice(0, 5).map((transaction) => ({
        description: transaction.description,
        date: transaction.date,
        timestamp: new Date(transaction.date).getTime(),
      })),
    });

    expect(isDescending).toBe(true);
  });
});
