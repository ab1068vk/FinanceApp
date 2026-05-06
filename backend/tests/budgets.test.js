const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-budgets-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-budgets-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

async function createSession(label = 'budget') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createAccount(accessToken) {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Budget Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  return response.body;
}

async function getExpenseCategory(accessToken) {
  const response = await request(app).get('/api/categories').set('Authorization', `Bearer ${accessToken}`).expect(200);
  return response.body.data.find((category) => category.type === 'expense') || response.body.data[0];
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Budgets API', () => {
  let owner;
  let other;
  let account;
  let category;
  let budget;
  const startDate = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const endDate = new Date('2026-01-31T23:59:59.999Z').toISOString();

  beforeAll(async () => {
    owner = await createSession('budget-owner');
    other = await createSession('budget-other');
    account = await createAccount(owner.accessToken);
    category = await getExpenseCategory(owner.accessToken);
  });

  test('creates a budget for an allowed category', async () => {
    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        category_id: category.id,
        amount: 300,
        period: 'monthly',
        start_date: startDate,
        end_date: endDate,
      })
      .expect(201);

    budget = response.body;
    expect(budget).toEqual(expect.objectContaining({
      id: expect.any(String),
      user_id: owner.user.id,
      category_id: category.id,
      amount: 300,
      period: 'monthly',
    }));
  });

  test('lists budget spending and remaining amounts', async () => {
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 45,
        description: 'Budgeted expense',
        date: new Date('2026-01-12T12:00:00.000Z').toISOString(),
      })
      .expect(201);

    const response = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const listed = response.body.data.find((item) => item.id === budget.id);
    expect(listed).toEqual(expect.objectContaining({
      current_spending: 45,
      remaining: 255,
      category_name: expect.any(String),
    }));
  });

  test('retrieves budget detail with weekly breakdown', async () => {
    const response = await request(app)
      .get(`/api/budgets/${budget.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      id: budget.id,
      current_spending: 45,
      remaining: 255,
      weekly_breakdown: expect.any(Array),
    }));

    await request(app)
      .get(`/api/budgets/${budget.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
  });

  test('includes spending on a budget end date stored at midnight', async () => {
    const midnightEndBudget = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        category_id: category.id,
        amount: 200,
        period: 'monthly',
        start_date: new Date('2026-02-01T00:00:00.000Z').toISOString(),
        end_date: new Date('2026-02-28T00:00:00.000Z').toISOString(),
      })
      .expect(201);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 30,
        description: 'End date expense',
        date: new Date('2026-02-28T18:00:00.000Z').toISOString(),
      })
      .expect(201);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 25,
        description: 'After budget expense',
        date: new Date('2026-03-01T12:00:00.000Z').toISOString(),
      })
      .expect(201);

    const listResponse = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const listed = listResponse.body.data.find((item) => item.id === midnightEndBudget.body.id);
    expect(listed).toEqual(expect.objectContaining({
      current_spending: 30,
      remaining: 170,
    }));

    const detailResponse = await request(app)
      .get(`/api/budgets/${midnightEndBudget.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(detailResponse.body).toEqual(expect.objectContaining({
      current_spending: 30,
      remaining: 170,
    }));
  });

  test('updates and deletes owned budgets', async () => {
    const updated = await request(app)
      .put(`/api/budgets/${budget.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        amount: 400,
        period: 'weekly',
        start_date: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        end_date: new Date('2026-01-07T23:59:59.999Z').toISOString(),
      })
      .expect(200);

    expect(updated.body).toEqual(expect.objectContaining({
      id: budget.id,
      amount: 400,
      period: 'weekly',
    }));

    await request(app)
      .delete(`/api/budgets/${budget.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    await request(app)
      .get(`/api/budgets/${budget.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });

  test('rejects inverted and period-mismatched budget ranges', async () => {
    await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        category_id: category.id,
        amount: 100,
        period: 'monthly',
        start_date: new Date('2026-02-10T00:00:00.000Z').toISOString(),
        end_date: new Date('2026-02-01T00:00:00.000Z').toISOString(),
      })
      .expect(400);

    await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        category_id: category.id,
        amount: 100,
        period: 'weekly',
        start_date: new Date('2026-03-01T00:00:00.000Z').toISOString(),
        end_date: new Date('2026-03-31T23:59:59.999Z').toISOString(),
      })
      .expect(400);
  });
});
