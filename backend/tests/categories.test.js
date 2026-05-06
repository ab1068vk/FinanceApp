const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-categories-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-categories-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

async function createSession(label = 'category') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Categories API', () => {
  let owner;
  let other;
  let category;

  beforeAll(async () => {
    owner = await createSession('category-owner');
    other = await createSession('category-other');
  });

  test('lists default categories for a new user', async () => {
    const response = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.pagination).toEqual(expect.objectContaining({ page: 1, page_size: 50, total_count: expect.any(Number) }));
    expect(response.body.data.some((item) => item.is_default === 1)).toBe(true);
  });

  test('does not return duplicate category names when a user copy matches a global default', async () => {
    const defaults = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const defaultCategory = defaults.body.data.find((item) => item.type === 'expense' && item.is_default === 1) || defaults.body.data[0];

    db.prepare(`
      INSERT INTO categories (id, user_id, name, icon, color, type, is_default, is_system, is_active, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
    `).run(
      '11111111-1111-4111-8111-111111111111',
      owner.user.id,
      defaultCategory.name,
      defaultCategory.icon,
      defaultCategory.color,
      defaultCategory.type,
      defaultCategory.sort_order + 1,
      new Date().toISOString(),
    );

    const response = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(response.body.data.filter((item) => item.name === defaultCategory.name && item.type === defaultCategory.type)).toHaveLength(1);
  });

  test('creates a custom category', async () => {
    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Pet Supplies', icon: 'heart', color: '#14B8A6', type: 'expense' })
      .expect(201);

    category = response.body;
    expect(category).toEqual(expect.objectContaining({
      id: expect.any(String),
      user_id: owner.user.id,
      name: 'Pet Supplies',
      type: 'expense',
      is_default: 0,
      is_system: 0,
      is_active: 1,
    }));

    const categories = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(categories.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: category.id,
        name: 'Pet Supplies',
        type: 'expense',
        is_active: 1,
      }),
    ]));
  });

  test('updates only owned custom categories', async () => {
    const response = await request(app)
      .put(`/api/categories/${category.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Household Supplies', icon: 'home', color: '#E94560' })
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      id: category.id,
      name: 'Household Supplies',
      icon: 'home',
      color: '#E94560',
    }));

    await request(app)
      .put(`/api/categories/${category.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ name: 'Not Mine' })
      .expect(404);
  });

  test('reorders owned custom categories', async () => {
    const second = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Garden Supplies', icon: 'sun', color: '#27AE60', type: 'expense' })
      .expect(201);

    const response = await request(app)
      .put('/api/categories/reorder')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ category_ids: [second.body.id, category.id] })
      .expect(200);

    expect(response.body.map((item) => item.id)).toEqual([second.body.id, category.id]);
    expect(response.body[0].sort_order).toBeLessThan(response.body[1].sort_order);
  });

  test('deletes owned custom categories', async () => {
    await request(app)
      .delete(`/api/categories/${category.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const response = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.some((item) => item.id === category.id)).toBe(false);
  });
});
