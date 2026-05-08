const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-transaction-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-transactions-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

async function createSession(label) {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createAccount(accessToken, name = 'Checking') {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name, type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  return response.body;
}

async function getExpenseCategory(accessToken) {
  const response = await request(app).get('/api/categories').set('Authorization', `Bearer ${accessToken}`).expect(200);
  return response.body.data.find((category) => category.type === 'expense') || response.body.data[0];
}

async function getDifferentCategory(accessToken, categoryId) {
  const response = await request(app).get('/api/categories').set('Authorization', `Bearer ${accessToken}`).expect(200);
  return response.body.data.find((category) => category.id !== categoryId) || response.body.data[0];
}

function createdTransaction(body) {
  return body.transactions[0];
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Transactions API', () => {
  let userOne;
  let userTwo;
  let account;
  let category;
  let transaction;

  beforeAll(async () => {
    userOne = await createSession('owner');
    userTwo = await createSession('other');
    account = await createAccount(userOne.accessToken);
    category = await getExpenseCategory(userOne.accessToken);
  });

  test('create transaction returns 201', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 42.5,
        description: 'Test groceries',
        date: new Date().toISOString(),
      })
      .expect(201);

    transaction = createdTransaction(response.body);
    expect(transaction.id).toEqual(expect.any(String));
    expect(transaction.user_id).toBe(userOne.user.id);
    expect(transaction.category_id).toBe(category.id);
    expect(transaction.category_name).toBe(category.name);
    expect(transaction.account_name).toBe(account.name);
  });

  test('custom categories are persisted and returned on newly created transactions', async () => {
    const customCategory = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ name: 'Car Repairs', icon: 'tool', color: '#14B8A6', type: 'expense' })
      .expect(201);

    const created = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: customCategory.body.id,
        type: 'expense',
        amount: 88,
        description: 'Brake pads',
        date: new Date().toISOString(),
      })
      .expect(201);

    const createdTx = createdTransaction(created.body);
    expect(createdTx).toEqual(expect.objectContaining({
      category_id: customCategory.body.id,
      category_name: 'Car Repairs',
      account_name: account.name,
    }));

    const listed = await request(app)
      .get(`/api/transactions?category_id=${customCategory.body.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(listed.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: createdTx.id,
        category_name: 'Car Repairs',
      }),
    ]));
  });

  test('create transaction without account_id uses default cash account', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        category_id: category.id,
        type: 'expense',
        amount: 12,
        description: 'Cash purchase',
        date: new Date().toISOString(),
      })
      .expect(201);

    const tx = createdTransaction(response.body);
    expect(tx.account_id).toEqual(expect.any(String));

    const account = await request(app)
      .get(`/api/accounts/${tx.account_id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(account.body).toEqual(expect.objectContaining({
      name: 'Cash',
      type: 'cash',
    }));
    expect(Number(account.body.current_balance)).toBeCloseTo(-12);
  });

  test('validates transaction amount decimal and positivity rules', async () => {
    const basePayload = {
      account_id: account.id,
      category_id: category.id,
      type: 'expense',
      description: 'Amount validation',
      date: new Date().toISOString(),
    };

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ ...basePayload, amount: 10.999 })
      .expect(400);

    const accepted = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ ...basePayload, amount: 10.99 })
      .expect(201);
    expect(Number(createdTransaction(accepted.body).amount)).toBeCloseTo(10.99);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ ...basePayload, amount: -5 })
      .expect(400);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ ...basePayload, amount: 0 })
      .expect(400);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ ...basePayload, amount: 'abc' })
      .expect(400);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ ...basePayload, amount: '' })
      .expect(400);
  });

  test('get transactions returns paginated list', async () => {
    const response = await request(app)
      .get('/api/transactions?page=1&limit=20')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.pagination).toEqual(expect.objectContaining({ page: 1, limit: 20 }));
    expect(response.body.data.some((item) => item.id === transaction.id)).toBe(true);
  });

  test('get transactions supports page_size pagination metadata and rejects invalid pages', async () => {
    const response = await request(app)
      .get('/api/transactions?page=1&page_size=1')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      total_count: expect.any(Number),
      page: 1,
      page_size: 1,
      total_pages: expect.any(Number),
    }));
    expect(response.body.pagination.total_pages).toBe(Math.ceil(response.body.pagination.total_count / 1));

    await request(app)
      .get('/api/transactions?page=0')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(400);
  });

  test('search matches transaction notes and tags', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 9,
        description: 'Searchable lunch',
        note: 'Project alpha note',
        tags: ['alpha-tag', '<supermarket>'],
        date: new Date().toISOString(),
      })
      .expect(201);

    const byNote = await request(app)
      .get('/api/transactions?search=project%20alpha')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    const tx = createdTransaction(response.body);
    expect(byNote.body.data.some((item) => item.id === tx.id)).toBe(true);

    const byTag = await request(app)
      .get('/api/transactions?search=alpha-tag')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    expect(byTag.body.data.some((item) => item.id === tx.id)).toBe(true);

    const byRawTag = await request(app)
      .get(`/api/transactions?search=${encodeURIComponent('<supermarket>')}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    expect(byRawTag.body.data.some((item) => item.id === tx.id)).toBe(true);
    expect(tx.tags).toContain('<supermarket>');
  });

  test('preserves transaction text fields as user-authored API data', async () => {
    const sanitizingAccount = await createAccount(userOne.accessToken, 'Sanitize Checking');
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: sanitizingAccount.id,
        category_id: category.id,
        type: 'expense',
        amount: 5,
        description: '5 < 10 on groceries',
        note: 'Use "household" / shared budget',
        tags: ['<b>urgent</b>'],
        date: new Date().toISOString(),
      })
      .expect(201);

    const tx = createdTransaction(response.body);
    expect(tx.description).toBe('5 < 10 on groceries');
    expect(tx.note).toBe('Use "household" / shared budget');
    expect(tx.tags).toEqual(['<b>urgent</b>']);
  });

  test('blocks detected attack payloads before transaction storage', async () => {
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 5,
        description: '<script>alert("x")</script>',
        date: new Date().toISOString(),
      })
      .expect(400);
  });

  test('trims transaction text fields and stores blanks as null', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 6,
        description: '  5 < 10 on groceries  ',
        note: '   ',
        tags: ['  needs review  ', '   '],
        date: new Date().toISOString(),
      })
      .expect(201);

    const tx = createdTransaction(response.body);
    expect(tx.description).toBe('5 < 10 on groceries');
    expect(tx.note).toBeNull();
    expect(tx.tags).toEqual(['needs review']);
  });

  test('user cannot access another user transaction', async () => {
    await request(app)
      .get(`/api/transactions/${transaction.id}`)
      .set('Authorization', `Bearer ${userTwo.accessToken}`)
      .expect(404);
  });

  test('transfer transactions calculate source and destination balances from JSON tags', async () => {
    const source = await createAccount(userOne.accessToken, 'Transfer Source');
    const destination = await createAccount(userOne.accessToken, 'Transfer Destination');

    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: source.id,
        to_account_id: destination.id,
        category_id: category.id,
        type: 'transfer',
        amount: 25,
        description: 'Move money',
        date: new Date().toISOString(),
      })
      .expect(201);

    expect(response.body.transactions).toHaveLength(2);
    expect(response.body.transactions[0].transfer_group_id).toEqual(expect.any(String));
    expect(response.body.transactions[1].transfer_group_id).toBe(response.body.transactions[0].transfer_group_id);

    const sourceAfter = await request(app)
      .get(`/api/accounts/${source.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    const destinationAfter = await request(app)
      .get(`/api/accounts/${destination.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(Number(sourceAfter.body.current_balance)).toBeCloseTo(-25);
    expect(Number(destinationAfter.body.current_balance)).toBeCloseTo(25);

    await request(app)
      .delete(`/api/transactions/${response.body.transactions[0].id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ confirm: true })
      .expect(200);

    const sourceDeleted = await request(app)
      .get(`/api/accounts/${source.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    const destinationDeleted = await request(app)
      .get(`/api/accounts/${destination.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(Number(sourceDeleted.body.current_balance)).toBeCloseTo(0);
    expect(Number(destinationDeleted.body.current_balance)).toBeCloseTo(0);
  });

  test('transfer transactions can omit category and are excluded from summary category breakdown', async () => {
    const source = await createAccount(userOne.accessToken, 'Summary Transfer Source');
    const destination = await createAccount(userOne.accessToken, 'Summary Transfer Destination');

    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: source.id,
        to_account_id: destination.id,
        type: 'transfer',
        amount: 31,
        description: 'Transfer without category',
        date: new Date().toISOString(),
      })
      .expect(201);

    expect(response.body.transactions).toHaveLength(2);
    expect(response.body.transactions[0].category_id).toBeNull();
    expect(response.body.transactions[1].category_id).toBeNull();

    const summary = await request(app)
      .get('/api/transactions/summary')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(summary.body.grouped_by_category.some((item) => item.type === 'transfer')).toBe(false);
  });

  test('bulk category update changes selected transactions', async () => {
    const secondCategory = await getDifferentCategory(userOne.accessToken, category.id);
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 14,
        description: 'Bulk category',
        date: new Date().toISOString(),
      })
      .expect(201);

    await request(app)
      .patch('/api/transactions/bulk/category')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ transaction_ids: [createdTransaction(response.body).id], category_id: secondCategory.id })
      .expect(200);

    const updated = await request(app)
      .get(`/api/transactions/${createdTransaction(response.body).id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    expect(updated.body.category_id).toBe(secondCategory.id);
  });

  test('update transaction amount recalculates account balance', async () => {
    const amountAccount = await createAccount(userOne.accessToken, 'Amount Edit Checking');
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: amountAccount.id,
        category_id: category.id,
        type: 'expense',
        amount: 30,
        description: 'Amount before edit',
        date: new Date().toISOString(),
      })
      .expect(201);

    const updated = await request(app)
      .put(`/api/transactions/${createdTransaction(response.body).id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ amount: 12.5, description: 'Amount after edit' })
      .expect(200);

    expect(Number(updated.body.amount)).toBeCloseTo(12.5);
    expect(updated.body.description).toBe('Amount after edit');

    const accountAfter = await request(app)
      .get(`/api/accounts/${amountAccount.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(Number(accountAfter.body.balance)).toBeCloseTo(-12.5);
    expect(Number(accountAfter.body.current_balance)).toBeCloseTo(-12.5);
  });

  test('update transfer amount recalculates both account balances', async () => {
    const source = await createAccount(userOne.accessToken, 'Amount Transfer Source');
    const destination = await createAccount(userOne.accessToken, 'Amount Transfer Destination');

    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: source.id,
        to_account_id: destination.id,
        type: 'transfer',
        amount: 25,
        description: 'Transfer amount before edit',
        date: new Date().toISOString(),
      })
      .expect(201);

    const sourceTransaction = response.body.transactions.find((item) => item.transfer_direction === 'source');
    const destinationTransaction = response.body.transactions.find((item) => item.transfer_direction === 'destination');

    await request(app)
      .put(`/api/transactions/${sourceTransaction.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ amount: 40 })
      .expect(200);

    const sourceAfter = await request(app)
      .get(`/api/accounts/${source.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    const destinationAfter = await request(app)
      .get(`/api/accounts/${destination.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    const pairedAfter = await request(app)
      .get(`/api/transactions/${destinationTransaction.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(Number(sourceAfter.body.current_balance)).toBeCloseTo(-40);
    expect(Number(destinationAfter.body.current_balance)).toBeCloseTo(40);
    expect(Number(pairedAfter.body.amount)).toBeCloseTo(40);
  });

  test('bulk delete removes selected transactions and restores balances', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 7,
        description: 'Bulk delete',
        date: new Date().toISOString(),
      })
      .expect(201);

    const before = await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    await request(app)
      .delete('/api/transactions/bulk')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({ transaction_ids: [createdTransaction(response.body).id] })
      .expect(200);

    const after = await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);
    expect(Number(after.body.balance)).toBeCloseTo(Number(before.body.balance) + 7);
  });

  test('rejects transaction dates outside the allowed range', async () => {
    const tooOld = new Date();
    tooOld.setFullYear(tooOld.getFullYear() - 51);
    const tooFuture = new Date();
    tooFuture.setFullYear(tooFuture.getFullYear() + 6);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 3,
        description: 'Too old',
        date: tooOld.toISOString(),
      })
      .expect(400);

    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 3,
        description: 'Too future',
        date: tooFuture.toISOString(),
      })
      .expect(400);
  });

  test('delete transaction reverses account balance', async () => {
    const before = await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    const balanceBeforeDelete = Number(before.body.balance);

    await request(app)
      .delete(`/api/transactions/${transaction.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    const after = await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Authorization', `Bearer ${userOne.accessToken}`)
      .expect(200);

    expect(Number(after.body.balance)).toBeCloseTo(balanceBeforeDelete + 42.5);
    expect(Number(after.body.current_balance)).toBeCloseTo(balanceBeforeDelete + 42.5);
  });
});
