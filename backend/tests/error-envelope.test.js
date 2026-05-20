const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-error-envelope-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-error-envelope-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

async function createSession(label = 'error-envelope', role = 'user') {
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

function expectCanonicalErrorEnvelope(response) {
  expect(response.body).toMatchObject({
    error: expect.any(String),
  });
  expect(response.body).not.toHaveProperty('errors');
  if (response.body.details !== undefined) {
    expect(response.body.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: expect.any(String),
        message: expect.any(String),
      }),
    ]));
  }
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('API error envelope', () => {
  let user;
  let admin;

  beforeAll(async () => {
    user = await createSession('error-user');
    admin = await createSession('error-admin', 'admin');
  });

  test.each([
    ['auth validation', () => request(app).post('/api/auth/register').send({ email: 'invalid', password: 'weak', full_name: 'A' })],
    ['account validation', () => request(app).post('/api/accounts').set('Authorization', `Bearer ${user.accessToken}`).send({ name: '', type: 'wallet' })],
    ['transaction validation', () => request(app).get('/api/transactions?page=0').set('Authorization', `Bearer ${user.accessToken}`)],
    ['budget validation', () => request(app).post('/api/budgets').set('Authorization', `Bearer ${user.accessToken}`).send({ amount: 0, period: 'daily' })],
    ['category validation', () => request(app).post('/api/categories').set('Authorization', `Bearer ${user.accessToken}`).send({ name: '', type: 'other' })],
    ['announcement validation', () => request(app).post('/api/announcements/not-a-uuid/dismiss').set('Authorization', `Bearer ${user.accessToken}`)],
    ['admin validation', () => request(app).get('/api/admin/users?role=owner').set('Authorization', `Bearer ${admin.accessToken}`)],
  ])('%s uses the canonical validation envelope', async (_name, runRequest) => {
    const response = await runRequest().expect(400);

    expectCanonicalErrorEnvelope(response);
    expect(response.body).toMatchSnapshot();
  });

  test('not-found errors use the canonical error envelope', async () => {
    const response = await request(app).get('/api/missing-route').expect(404);

    expectCanonicalErrorEnvelope(response);
    expect(response.body).toEqual({ error: 'Route not found' });
  });

  test('account delete decision errors use details instead of custom top-level actions', async () => {
    const account = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ name: 'Envelope Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card', balance: 25 })
      .expect(201);

    const response = await request(app)
      .delete(`/api/accounts/${account.body.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(400);

    expectCanonicalErrorEnvelope(response);
    expect(response.body).toEqual({
      error: 'Choose whether to delete this account transactions or move them to Cash',
      details: [
        {
          field: 'transaction_action',
          message: 'Required when the account has 1 transaction; use delete or cash',
        },
      ],
    });
    expect(response.body).not.toHaveProperty('actions');
  });
});
