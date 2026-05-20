const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-admin-csv-export-32';
process.env.DB_PATH = path.join(__dirname, `test-admin-csv-export-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

const MONTHLY_HEADERS = ['month', 'income', 'expense', 'net', 'count'];
const CATEGORY_HEADERS = ['category_name', 'type', 'count', 'total'];

async function createSession(label, role = 'user') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  if (role === 'admin') db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', credentials.email);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

function parseCsv(text) {
  return String(text).trimEnd().split('\n').map((line) => line.split(','));
}

function expectConsistentColumns(csv, headers) {
  const rows = parseCsv(csv);
  expect(rows[0]).toEqual(headers);
  for (const row of rows) {
    expect(row).toHaveLength(headers.length);
  }
  return rows;
}

async function createReportTransaction(session) {
  const account = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({ name: 'CSV Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  const categories = await request(app)
    .get('/api/categories')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .expect(200);
  const category = categories.body.data.find((item) => item.type === 'expense');
  await request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({
      account_id: account.body.id,
      category_id: category.id,
      type: 'expense',
      amount: 12.34,
      description: 'CSV export row',
      date: '2026-05-20T12:00:00.000Z',
    })
    .expect(201);
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('admin report CSV export', () => {
  let admin;

  beforeAll(async () => {
    admin = await createSession('csv-admin', 'admin');
  });

  test.each([
    ['monthly', MONTHLY_HEADERS],
    ['categories', CATEGORY_HEADERS],
  ])('empty %s export still returns predefined headers', async (type, headers) => {
    const response = await request(app)
      .get(`/api/admin/reports/export?type=${type}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toBe(headers.join(','));
  });

  test.each([
    ['monthly', MONTHLY_HEADERS],
    ['categories', CATEGORY_HEADERS],
  ])('%s export rows have the same column count as the header', async (type, headers) => {
    const user = await createSession(`csv-${type}`);
    await createReportTransaction(user);

    const response = await request(app)
      .get(`/api/admin/reports/export?type=${type}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const rows = expectConsistentColumns(response.text, headers);
    expect(rows.length).toBeGreaterThan(1);
  });
});
