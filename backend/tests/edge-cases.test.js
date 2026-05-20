/**
 * Edge Cases and Error Handling Tests
 * Tests boundary conditions, invalid inputs, and error recovery.
 * Run with: npx jest tests/edge-cases.test.js --verbose
 */

const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-edge-32-bytes-minimum';
process.env.DB_PATH = path.join(__dirname, `test-edge-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const request = require('supertest');
const app = require('../src/app');
const { db, dbPath } = require('../database/db');

let accessToken;
let accountId;
let expenseCategory;

async function createSession() {
  const credentials = {
    email: `edge-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'Edge Case Tester',
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

describe('Edge Cases and Error Handling', () => {
  beforeAll(async () => {
    const session = await createSession();
    accessToken = session.accessToken;

    accountId = (await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Edge Account', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
      .expect(201)).body.id;

    const catsResponse = (await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body;
    const cats = catsResponse.data;

    expenseCategory = cats.find((category) => category.type === 'expense');
  });

  test('EDGE 1: Transaction with amount 0 should be rejected', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 0,
        description: 'Zero amount',
        date: new Date().toISOString(),
      })
      .expect(400);

    console.log('\nZERO AMOUNT REJECTION:', {
      status: response.status,
      error: response.body.details?.[0]?.message || response.body.error,
    });

    expect(response.status).toBe(400);
  });

  test('allows Expo dev server origins during local development', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:8084')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8084');
  });

  test('EDGE 2: Transaction with negative amount should be rejected', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: -50,
        description: 'Negative amount',
        date: new Date().toISOString(),
      })
      .expect(400);

    console.log('\nNEGATIVE AMOUNT REJECTION:', {
      status: response.status,
      error: response.body.details?.[0]?.message || response.body.error,
    });

    expect(response.status).toBe(400);
  });

  test('EDGE 3: Transaction with future date should be accepted', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 100,
        description: 'Future transaction',
        date: futureDate.toISOString(),
      })
      .expect(201);

    console.log('\nFUTURE DATE ACCEPTED:', {
      status: response.status,
      date: futureDate.toISOString(),
      note: 'Future dates are allowed for planned transactions',
    });

    expect(response.status).toBe(201);
  });

  test('EDGE 4: Budget with start_date after end_date should be rejected', async () => {
    const startDate = new Date('2026-06-01').toISOString();
    const endDate = new Date('2026-05-01').toISOString();

    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        category_id: expenseCategory.id,
        amount: 500,
        period: 'monthly',
        start_date: startDate,
        end_date: endDate,
      })
      .expect(400);

    console.log('\nINVERTED DATE RANGE:', {
      status: response.status,
      startDate,
      endDate,
      wasRejected: response.status === 400,
      error: response.body.error,
    });

    expect(response.body.error).toMatch(/end_date/i);
  });

  test('EDGE 5: Transaction with empty description should be accepted', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 50,
        date: new Date().toISOString(),
      })
      .expect(201);

    console.log('\nEMPTY DESCRIPTION:', {
      status: response.status,
      description: response.body.transactions[0].description,
      note: 'Description defaults to null when not provided',
    });

    expect(response.body.transactions[0].description).toBeNull();
  });

  test('EDGE 6: Transaction above maximum amount should be rejected', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 999999999.99,
        description: 'Very large amount',
        date: new Date().toISOString(),
      })
      .expect(400);

    console.log('\nLARGE AMOUNT HANDLING:', {
      status: response.status,
      error: response.body.details?.[0]?.message || response.body.error,
      note: 'Amounts above the configured business limit are rejected',
    });

    expect(response.status).toBe(400);
  });

  test('EDGE 6B: Explicit zero overdraft rejects protected-account overspend', async () => {
    const protectedAccountId = (await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'No Overdraft', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card', overdraft_limit: 0 })
      .expect(201)).body.id;

    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: protectedAccountId,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 1,
        description: 'Blocked overspend',
        date: new Date().toISOString(),
      })
      .expect(400);

    expect(response.body.error).toMatch(/overdraft/i);
  });

  test('EDGE 7: Concurrent transactions should maintain account balance integrity', async () => {
    const before = (await request(app)
      .get(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body;

    const beforeBalance = Number(before.current_balance);

    const promises = [];
    for (let i = 0; i < 5; i += 1) {
      promises.push(
        request(app)
          .post('/api/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            account_id: accountId,
            category_id: expenseCategory.id,
            type: 'expense',
            amount: 10,
            description: `Concurrent ${i}`,
            date: new Date().toISOString(),
          })
      );
    }

    const results = await Promise.all(promises);
    const allSucceeded = results.every((response) => response.status === 201);

    const after = (await request(app)
      .get(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body;

    const afterBalance = Number(after.current_balance);
    const expectedBalance = beforeBalance - 50;

    console.log('\nCONCURRENT TRANSACTIONS:', {
      beforeBalance,
      afterBalance,
      expectedBalance,
      allSucceeded,
      balanceCorrect: afterBalance === expectedBalance,
      difference: afterBalance - expectedBalance,
    });

    expect(allSucceeded).toBe(true);
    expect(afterBalance).toBe(expectedBalance);
  });

  test('EDGE 8: Transaction with extremely long description should be rejected', async () => {
    const longDesc = 'A'.repeat(300);

    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 50,
        description: longDesc,
        date: new Date().toISOString(),
      });

    console.log('\nLONG DESCRIPTION:', {
      status: response.status,
      descriptionLength: longDesc.length,
      wasRejected: response.status === 400,
      error: response.body.details?.[0]?.message || response.body.error,
    });

    expect(response.status).toBe(400);
  });

  test('EDGE 9: Transaction summary with no date range should return all-time totals', async () => {
    const response = await request(app)
      .get('/api/transactions/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    console.log('\nALL-TIME SUMMARY:', {
      total_income: response.body.total_income,
      total_expense: response.body.total_expense,
      net: response.body.net,
      note: 'Includes all transactions regardless of date',
    });

    expect(typeof response.body.total_income).toBe('number');
    expect(typeof response.body.total_expense).toBe('number');
    expect(typeof response.body.net).toBe('number');
  });

  test('EDGE 10: Delete non-existent transaction should return 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await request(app)
      .delete(`/api/transactions/${fakeId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirm: true });

    console.log('\nDELETE NON-EXISTENT:', {
      status: response.status,
      error: response.body.error,
      note: 'Should return not found',
    });

    expect(response.status).toBe(404);
  });

  test('EDGE 11: Transfer to same account should be rejected', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        account_id: accountId,
        to_account_id: accountId,
        category_id: expenseCategory.id,
        type: 'transfer',
        amount: 100,
        description: 'Same account transfer',
        date: new Date().toISOString(),
      });

    console.log('\nSAME ACCOUNT TRANSFER:', {
      status: response.status,
      wasRejected: response.status === 400,
      error: response.body.error || response.body.details?.[0]?.message,
    });

    expect(response.status).toBe(400);
  });

  test('EDGE 12: Verify balance can be inspected when negative', async () => {
    const currentBalance = (await request(app)
      .get(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)).body.current_balance;

    console.log('\nNEGATIVE BALANCE CHECK:', {
      currentBalance,
      isNegative: Number(currentBalance) < 0,
      note: 'Current behavior permits negative balances',
    });

    expect(typeof currentBalance).toBe('number');
  });
});
