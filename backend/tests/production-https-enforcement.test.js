const fs = require('fs');
const path = require('path');
const request = require('supertest');

const envKeys = [
  'NODE_ENV',
  'TRUST_PROXY_HOPS',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_PATH',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
  'DELETED_USER_ARCHIVE_DAYS',
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

process.env.NODE_ENV = 'production';
process.env.TRUST_PROXY_HOPS = '1';
process.env.JWT_SECRET = 'test-jwt-secret-production-https-32-bytes';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-production-https-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-production-https-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';
process.env.DELETED_USER_ARCHIVE_DAYS = '90';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

describe('Production HTTPS enforcement', () => {
  test('rejects plain HTTP requests before serving API data', async () => {
    const response = await request(app)
      .get('/health')
      .set('Host', 'api.financeapp.test')
      .expect(400);

    expect(response.body).toEqual({ error: 'HTTPS required' });
  });

  test('allows requests marked HTTPS by the trusted reverse proxy', async () => {
    const response = await request(app)
      .get('/health')
      .set('Host', 'api.financeapp.test')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(response.body.status).toBe('ok');
  });
});
