const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-suite-32-bytes-minimum';
process.env.DB_PATH = path.join(__dirname, `test-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');
const { clientIp } = require('../src/utils/clientIp');

jest.setTimeout(30000);

const validUser = {
  email: `auth-${Date.now()}@financeapp.test`,
  password: 'StrongPass1!',
  full_name: 'Auth Tester',
};

async function registerAndLogin(overrides = {}) {
  const data = {
    email: `user-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'Test User',
    ...overrides,
  };

  await request(app).post('/api/auth/register').send(data).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: data.email, password: data.password }).expect(200);
  return { ...login.body, credentials: data };
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Authentication API', () => {
  test('register with valid data returns 201', async () => {
    const response = await request(app).post('/api/auth/register').send(validUser).expect(201);
    expect(response.body).toEqual({ success: true, message: 'Account created successfully. You can now sign in.' });
    expect(response.body.password_hash).toBeUndefined();
  });

  test('register with duplicate email returns generic success', async () => {
    const response = await request(app).post('/api/auth/register').send(validUser).expect(201);
    expect(response.body).toEqual({ success: true, message: 'If this email is not registered, an account has been created. Check your email to verify your account.' });
  });

  test('email verification is required when enabled', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE = 'true';
    const user = {
      email: `verify-${Date.now()}@financeapp.test`,
      password: 'StrongPass1!',
      full_name: 'Verify User',
    };

    const register = await request(app).post('/api/auth/register').send(user).expect(201);
    expect(register.body.verificationToken).toEqual(expect.any(String));

    await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(403);

    await request(app)
      .post('/api/auth/verify-email')
      .send({ verificationToken: register.body.verificationToken })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    delete process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE;
  });

  test('register with weak password returns 400', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: `weak-${Date.now()}@financeapp.test`,
      password: 'password',
      full_name: 'Weak Password',
    }).expect(400);

    expect(response.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'password' })]));
  });

  test('login with correct credentials returns tokens', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: validUser.email, password: validUser.password }).expect(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.body.user.email).toBe(validUser.email);
    expect(response.body.user.password_hash).toBeUndefined();
  });

  test('login with wrong password returns 401', async () => {
    await request(app).post('/api/auth/login').send({ email: validUser.email, password: 'WrongPass1!' }).expect(401);
  });

  test('login after 5 failures returns 423 while account is locked', async () => {
    const lockedUser = {
      email: `locked-${Date.now()}@financeapp.test`,
      password: 'StrongPass1!',
      full_name: 'Locked User',
    };
    await request(app).post('/api/auth/register').send(lockedUser).expect(201);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/api/auth/login').send({ email: lockedUser.email, password: 'WrongPass1!' }).expect(401);
    }

    const response = await request(app).post('/api/auth/login').send({ email: lockedUser.email, password: lockedUser.password }).expect(423);
    expect(response.body.retryAfter.minutes).toBeGreaterThan(0);
  });

  test('protected route without token returns 401', async () => {
    await request(app).get('/api/auth/me').expect(401);
  });

  test('client IP helper ignores raw forwarded headers', () => {
    delete process.env.TRUSTED_PROXIES;
    expect(clientIp({
      ip: undefined,
      headers: { 'x-forwarded-for': '192.168.1.1' },
      socket: { remoteAddress: '203.0.113.10' },
    })).toBe('203.0.113.10');

    expect(clientIp({
      ip: '198.51.100.5',
      headers: { 'x-forwarded-for': '192.168.1.1' },
      socket: { remoteAddress: '203.0.113.10' },
    })).toBe('198.51.100.5');
  });

  test('client IP helper uses forwarded chain from configured trusted proxies', () => {
    process.env.TRUSTED_PROXIES = '203.0.113.10';
    expect(clientIp({
      ip: undefined,
      get: (name) => (name.toLowerCase() === 'x-forwarded-for' ? '198.51.100.25, 203.0.113.10' : undefined),
      socket: { remoteAddress: '203.0.113.10' },
    })).toBe('198.51.100.25');
    delete process.env.TRUSTED_PROXIES;
  });

  test('protected route with valid token returns 200', async () => {
    const session = await registerAndLogin();
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.accessToken}`).expect(200);
    expect(response.body.email).toBe(session.user.email);
    expect(response.body.password_hash).toBeUndefined();
  });

  test('updates profile name and avatar color', async () => {
    const session = await registerAndLogin();
    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ full_name: 'Updated Profile', avatar_color: '#27AE60' })
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      email: session.user.email,
      full_name: 'Updated Profile',
      avatar_color: '#27AE60',
    }));
    expect(response.body.password_hash).toBeUndefined();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(me.body.full_name).toBe('Updated Profile');
    expect(me.body.avatar_color).toBe('#27AE60');
  });

  test('deletes user financial data and recreates default cash account', async () => {
    const session = await registerAndLogin();
    const account = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Data Delete Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
      .expect(201);
    const categories = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    const expenseCategory = categories.body.data.find((category) => category.type === 'expense');
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        account_id: account.body.id,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 25,
        description: 'Delete me',
        date: new Date().toISOString(),
      })
      .expect(201);

    const response = await request(app)
      .delete('/api/auth/data')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(response.body.deleted.transactions).toBeGreaterThanOrEqual(1);

    const transactions = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(transactions.body.pagination.total).toBe(0);

    const accounts = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(accounts.body.data).toHaveLength(1);
    expect(accounts.body.data[0]).toEqual(expect.objectContaining({ name: 'Cash', type: 'cash' }));
  });

  test('session summary returns active refresh token sessions', async () => {
    const session = await registerAndLogin();
    const response = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(response.body.active_sessions).toBeGreaterThanOrEqual(1);
    expect(response.body.sessions[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      created_at: expect.any(String),
      expires_at: expect.any(String),
      device_hint: expect.any(String),
    }));
    expect(response.body.sessions[0]).not.toHaveProperty('token_hash');
  });

  test('revokes an individual active session', async () => {
    const session = await registerAndLogin();
    const sessions = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    const target = sessions.body.sessions[0];

    await request(app)
      .delete(`/api/auth/sessions/${target.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  test('revokes all other sessions while keeping the current refresh token', async () => {
    const session = await registerAndLogin();
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: session.credentials.email, password: session.credentials.password })
      .expect(200);

    await request(app)
      .delete('/api/auth/sessions/others')
      .set('Authorization', `Bearer ${secondLogin.body.accessToken}`)
      .send({ refreshToken: secondLogin.body.refreshToken })
      .expect(200);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: secondLogin.body.refreshToken })
      .expect(200);
  });

  test('protected route rejects signed tokens without a sub claim', async () => {
    const session = await registerAndLogin();
    const idOnlyToken = jwt.sign({ id: session.user.id, email: session.user.email, role: session.user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const userIdOnlyToken = jwt.sign({ userId: session.user.id, email: session.user.email, role: session.user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });

    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${idOnlyToken}`).expect(401);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userIdOnlyToken}`).expect(401);
  });

  test('token refresh returns a new access token', async () => {
    const session = await registerAndLogin();
    const response = await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
  });

  test('logout revokes refresh token', async () => {
    const session = await registerAndLogin();
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.accessToken}`).expect(401);
  });

  test('forgot password returns a generic response for unknown email', async () => {
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: `missing-${Date.now()}@financeapp.test` })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'If an account exists for that email, a password reset token has been sent.',
    });
  });

  test('reset password token changes password and revokes sessions', async () => {
    const session = await registerAndLogin();
    const originalFetch = global.fetch;
    process.env.PASSWORD_RESET_WEBHOOK_URL = 'https://hooks.financeapp.test/reset';
    process.env.PASSWORD_RESET_URL = 'https://app.financeapp.test/auth';
    const delivered = [];
    global.fetch = jest.fn(async (url, options) => {
      delivered.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    });

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: session.credentials.email })
      .expect(200);

    expect(forgot.body.resetToken).toBeUndefined();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].body.resetUrl).toContain('/reset-password/');
    expect(delivered[0].body.resetUrl).not.toContain('resetToken=');
    const resetToken = delivered[0].body.token;
    expect(resetToken).toEqual(expect.any(String));

    await request(app)
      .post('/api/auth/reset-password')
      .send({ resetToken, newPassword: 'NewStrongPass1!' })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: session.credentials.email, password: session.credentials.password })
      .expect(401);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: session.credentials.email, password: 'NewStrongPass1!' })
      .expect(200);

    expect(login.body.accessToken).toEqual(expect.any(String));

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    await request(app)
      .post('/api/auth/reset-password')
      .send({ resetToken, newPassword: 'AnotherPass1!' })
      .expect(400);

    delete process.env.PASSWORD_RESET_WEBHOOK_URL;
    delete process.env.PASSWORD_RESET_URL;
    global.fetch = originalFetch;
  });
});
