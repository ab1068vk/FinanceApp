const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-reports-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-reports-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

async function createSession(label = 'report') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createAdminSession() {
  const admin = await createSession('report-admin');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', admin.user.id);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: admin.credentials.email, password: admin.credentials.password })
    .expect(200);
  return { ...login.body, credentials: admin.credentials };
}

async function createAccount(accessToken) {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Reports Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  return response.body;
}

async function getCategory(accessToken, type) {
  const response = await request(app).get('/api/categories').set('Authorization', `Bearer ${accessToken}`).expect(200);
  return response.body.data.find((category) => category.type === type) || response.body.data[0];
}

async function createTransaction(accessToken, account, category, type, amount, description) {
  const response = await request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      account_id: account.id,
      category_id: category.id,
      type,
      amount,
      description,
      date: new Date().toISOString(),
    })
    .expect(201);
  return response.body;
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Reports API', () => {
  let user;
  let admin;
  let account;
  let expenseCategory;
  let incomeCategory;

  beforeAll(async () => {
    user = await createSession('report-user');
    admin = await createAdminSession();
    account = await createAccount(user.accessToken);
    expenseCategory = await getCategory(user.accessToken, 'expense');
    incomeCategory = await getCategory(user.accessToken, 'income');

    await createTransaction(user.accessToken, account, incomeCategory, 'income', 1200, 'Paycheck');
    await createTransaction(user.accessToken, account, expenseCategory, 'expense', 150, 'Groceries');
  });

  test('generates transaction summary totals and category groupings', async () => {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() + 1);

    const response = await request(app)
      .get(`/api/transactions/summary?start_date=${encodeURIComponent(start.toISOString())}&end_date=${encodeURIComponent(end.toISOString())}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      total_income: 1200,
      total_expense: 150,
      net: 1050,
      grouped_by_category: expect.any(Array),
    }));
    expect(response.body.grouped_by_category).toEqual(expect.arrayContaining([
      expect.objectContaining({ category_id: incomeCategory.id, type: 'income', total: 1200 }),
      expect.objectContaining({ category_id: expenseCategory.id, type: 'expense', total: 150 }),
    ]));
  });

  test('generates admin dashboard reporting aggregates', async () => {
    const response = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      total_users: expect.objectContaining({ total: expect.any(Number), active: expect.any(Number) }),
      total_transactions: expect.objectContaining({ count: 2, sum: 1350 }),
      total_accounts: expect.any(Number),
      new_users_this_month: expect.any(Number),
      new_transactions_this_month: expect.any(Number),
      top_5_categories_by_spending: expect.any(Array),
      daily_transaction_volume: expect.any(Array),
      system_health: expect.objectContaining({
        db_size_mb: expect.any(Number),
        log_count: expect.any(Number),
        uptime_seconds: expect.any(Number),
      }),
    }));
    expect(response.body.daily_transaction_volume).toHaveLength(30);
    expect(response.body.top_5_categories_by_spending).toEqual(expect.arrayContaining([
      expect.objectContaining({ category_id: expenseCategory.id, total: 150 }),
    ]));
  });
});
