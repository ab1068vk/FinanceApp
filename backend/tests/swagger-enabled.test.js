const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ENABLE_SWAGGER = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-swagger-enabled-32';
process.env.DB_PATH = path.join(__dirname, `test-swagger-enabled-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Swagger configuration', () => {
  test('API docs are available when explicitly enabled', async () => {
    const response = await request(app).get('/api/docs/').expect(200);
    expect(response.text).toContain('Swagger UI');
  });
});
