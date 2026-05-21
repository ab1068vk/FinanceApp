const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-hardening-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-hardening-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

jest.setTimeout(30000);

async function registerAndLogin(label = 'hardening') {
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
  const session = await registerAndLogin('admin-hardening');
  db.prepare("UPDATE users SET role = 'admin', security_stamp = lower(hex(randomblob(32))) WHERE id = ?").run(session.user.id);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: session.credentials.email, password: session.credentials.password })
    .expect(200);
  return { ...login.body, credentials: session.credentials };
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Security hardening regressions', () => {
  test('CSRF is enabled by default for non-Bearer state-changing requests', async () => {
    await request(app)
      .post('/api/accounts')
      .send({ name: 'No CSRF', type: 'checking' })
      .expect(403);

    const csrf = await request(app).get('/api/auth/csrf').expect(200);
    expect(csrf.body.csrfToken).toEqual(expect.any(String));
    expect(csrf.headers['set-cookie']?.join(';')).toContain('financeapp_csrf=');

    await request(app)
      .post('/api/accounts')
      .set('Cookie', csrf.headers['set-cookie'])
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ name: 'CSRF ok but unauthenticated', type: 'checking' })
      .expect(401);
  });

  test('admin webhooks encrypt secrets and reject private network URLs', async () => {
    const admin = await createAdminSession();

    await request(app)
      .post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Bad private target', url: 'https://127.0.0.1/hook', event: 'transaction.created' })
      .expect(400);

    const created = await request(app)
      .post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Ledger hook', url: 'https://example.com/hook', event: 'transaction.created', secret: 'plain-secret' })
      .expect(201);

    expect(created.body.secret).toBe('[configured]');
    const stored = db.prepare('SELECT secret FROM webhooks WHERE id = ?').get(created.body.id);
    expect(stored.secret).not.toBe('plain-secret');
    expect(stored.secret).toMatch(/^enc:v1:/);
  });

  test('security IP blocks persist in SQLite and are enforced by middleware', async () => {
    const admin = await createAdminSession();
    const ip = '127.0.0.1';

    await request(app)
      .post('/api/admin/security-blocks')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ ip, duration_minutes: 30 })
      .expect(201);

    expect(db.prepare('SELECT ip FROM security_ip_blocks WHERE ip = ?').get(ip)).toBeTruthy();
    try {
      await request(app).get('/health').expect(429);
    } finally {
      db.prepare('DELETE FROM security_ip_blocks WHERE ip = ?').run(ip);
    }
  });

  test('security audit logs include attack source details for blocked and invalid requests', async () => {
    const admin = await createAdminSession();

    await request(app)
      .post('/api/auth/login?probe=../../etc/passwd')
      .set('User-Agent', 'security-test-agent')
      .set('Referer', 'https://evil.example/login')
      .send({ email: 'source@example.com', password: 'StrongPass1!' })
      .expect(429);

    const attackLogs = await request(app)
      .get('/api/admin/audit-logs?action=SECURITY_ATTACK_ATTEMPT&limit=5')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const attackPayload = JSON.parse(attackLogs.body.data[0].new_value);
    expect(attackPayload.source).toEqual(expect.objectContaining({
      ip: expect.any(String),
      referer: 'https://evil.example/login',
      user_agent: 'security-test-agent',
    }));
    expect(attackPayload.findings.some((finding) => finding.attack_type === 'path_traversal')).toBe(true);
    expect(attackLogs.body.data[0].summary).toContain('from');

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-valid-jwt')
      .expect(401);

    const authLogs = await request(app)
      .get('/api/admin/audit-logs?action=SECURITY_AUTH_FAILURE&limit=5')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(authLogs.body.data.some((log) => {
      const payload = JSON.parse(log.new_value);
      return payload.reason === 'invalid_jwt' && payload.source?.ip;
    })).toBe(true);
  });

  test('admin API tokens work before revocation and fail after revocation', async () => {
    const admin = await createAdminSession();
    const created = await request(app)
      .post('/api/admin/api-tokens')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Automation token', scopes: ['read:users'] })
      .expect(201);

    await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${created.body.token}`)
      .expect(200);

    await request(app)
      .delete(`/api/admin/api-tokens/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${created.body.token}`)
      .expect(401);
  });

  test('demoting an admin revokes their active admin API tokens', async () => {
    const actingAdmin = await createAdminSession();
    const demotedAdmin = await createAdminSession();
    const created = await request(app)
      .post('/api/admin/api-tokens')
      .set('Authorization', `Bearer ${demotedAdmin.accessToken}`)
      .send({ name: 'Demotion token', scopes: ['read:users'] })
      .expect(201);

    await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${created.body.token}`)
      .expect(200);

    await request(app)
      .put(`/api/admin/users/${demotedAdmin.user.id}/role`)
      .set('Authorization', `Bearer ${actingAdmin.accessToken}`)
      .send({ role: 'user' })
      .expect(200);

    const tokenRow = db.prepare('SELECT is_active, revoked_at FROM admin_api_tokens WHERE id = ?').get(created.body.id);
    expect(tokenRow.is_active).toBe(0);
    expect(tokenRow.revoked_at).toEqual(expect.any(String));

    await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${created.body.token}`)
      .expect(401);
  });

  test('admin session revocation invalidates existing access tokens', async () => {
    const admin = await createAdminSession();
    const user = await registerAndLogin('revoke-target');

    await request(app)
      .post(`/api/admin/users/${user.user.id}/revoke-sessions`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(401);
  });
});
