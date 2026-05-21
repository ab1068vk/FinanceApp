const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-admin-dashboard-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-admin-dashboard-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

async function createSession(label, role = 'user') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  if (role === 'admin') {
    db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', credentials.email);
  }

  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createAccount(accessToken) {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Dashboard Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  return response.body;
}

async function createExpenseCategory(accessToken) {
  const response = await request(app)
    .post('/api/categories')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: `Dashboard Review ${Date.now()}`, icon: 'bar-chart', color: '#14B8A6', type: 'expense' })
    .expect(201);
  return response.body;
}

async function createExpense(accessToken, accountId, categoryId, amount, date) {
  const response = await request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      account_id: accountId,
      category_id: categoryId,
      type: 'expense',
      amount,
      description: `Dashboard expense ${amount}`,
      date,
    })
    .expect(201);
  return response.body.transactions[0];
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Admin dashboard transaction analytics', () => {
  test('excludes admin-deleted transactions from dashboard counts, categories, and daily volume', async () => {
    const admin = await createSession('dashboard-admin', 'admin');
    const user = await createSession('dashboard-user');
    const account = await createAccount(user.accessToken);
    const category = await createExpenseCategory(user.accessToken);
    const transactionAt = new Date();
    transactionAt.setDate(transactionAt.getDate() - 1);
    transactionAt.setUTCHours(12, 0, 0, 0);
    const transactionDate = transactionAt.toISOString();
    const dashboardDate = transactionDate.slice(0, 10);

    await createExpense(user.accessToken, account.id, category.id, 40, transactionDate);
    const deletedTransaction = await createExpense(user.accessToken, account.id, category.id, 60, transactionDate);

    await request(app)
      .delete(`/api/admin/transactions/${deletedTransaction.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'dashboard regression coverage' })
      .expect(200);

    const dashboard = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(dashboard.body.total_transactions).toEqual(expect.objectContaining({
      count: 1,
      sum: 40,
    }));
    expect(dashboard.body.new_transactions_this_month).toBe(1);

    const categoryRow = dashboard.body.top_5_categories_by_spending.find((row) => row.category_id === category.id);
    expect(categoryRow).toEqual(expect.objectContaining({
      category_name: category.name,
      total: 40,
    }));
    expect(categoryRow.total).not.toBe(100);

    const dailyRow = dashboard.body.daily_transaction_volume.find((row) => row.date === dashboardDate);
    expect(dailyRow).toEqual(expect.objectContaining({
      count: 1,
      total: 40,
    }));
    expect(dailyRow.total).not.toBe(100);

    const categoryTotal = dashboard.body.top_5_categories_by_spending.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const dailyTotal = dashboard.body.daily_transaction_volume.reduce((sum, row) => sum + Number(row.total || 0), 0);
    expect(categoryTotal).toBe(dashboard.body.total_transactions.sum);
    expect(dailyTotal).toBe(dashboard.body.total_transactions.sum);
  });
});
