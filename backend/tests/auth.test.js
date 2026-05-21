const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

async function registerAdminAndLogin() {
  const session = await registerAndLogin({
    email: `admin-auth-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    full_name: 'Auth Admin',
  });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', session.user.id);
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

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'WrongPass1!' })
      .expect(401);
    expect(wrongPassword.body).toEqual({ error: 'Invalid credentials' });

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

  test('registration cleans up the user when verification email delivery fails', async () => {
    const originalFetch = global.fetch;
    const email = `delivery-fail-${Date.now()}@financeapp.test`;
    const payload = {
      email,
      password: 'StrongPass1!',
      full_name: 'Delivery Failure',
    };

    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    delete process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE;
    process.env.EMAIL_VERIFICATION_WEBHOOK_URL = 'https://email.financeapp.test/verify';
    process.env.EMAIL_VERIFICATION_WEBHOOK_SECRET = 'verify-webhook-secret';
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));

    const before = {
      users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
      accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count,
      tokens: db.prepare('SELECT COUNT(*) AS count FROM email_verification_tokens').get().count,
    };

    await request(app)
      .post('/api/auth/register')
      .send(payload)
      .expect(503);

    expect(db.prepare('SELECT id FROM users WHERE email = ?').get(email)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(before.users);
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count).toBe(before.accounts);
    expect(db.prepare('SELECT COUNT(*) AS count FROM email_verification_tokens').get().count).toBe(before.tokens);

    const resendAfterFailedRegistration = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email })
      .expect(200);
    expect(resendAfterFailedRegistration.body.verificationToken).toBeUndefined();

    process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE = 'true';
    delete process.env.EMAIL_VERIFICATION_WEBHOOK_URL;
    global.fetch = originalFetch;

    const retry = await request(app)
      .post('/api/auth/register')
      .send(payload)
      .expect(201);
    expect(retry.body.verificationToken).toEqual(expect.any(String));

    const resendAfterRetry = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email })
      .expect(200);
    expect(resendAfterRetry.body.verificationToken).toEqual(expect.any(String));

    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    delete process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE;
    delete process.env.EMAIL_VERIFICATION_WEBHOOK_URL;
    delete process.env.EMAIL_VERIFICATION_WEBHOOK_SECRET;
    global.fetch = originalFetch;
  });

  test('register with weak password returns 400', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: `weak-${Date.now()}@financeapp.test`,
      password: 'password',
      full_name: 'Weak Password',
    }).expect(400);

    expect(response.body).toEqual({
      error: 'Validation failed',
      details: expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    });
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

  test('login after 5 failures returns generic 401 while account is locked', async () => {
    const lockedUser = {
      email: `locked-${Date.now()}@financeapp.test`,
      password: 'StrongPass1!',
      full_name: 'Locked User',
    };
    await request(app).post('/api/auth/register').send(lockedUser).expect(201);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/api/auth/login').send({ email: lockedUser.email, password: 'WrongPass1!' }).expect(401);
    }

    const response = await request(app).post('/api/auth/login').send({ email: lockedUser.email, password: lockedUser.password }).expect(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
    expect(response.body.retryAfter).toBeUndefined();
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

  test('data export excludes admin-deleted transactions while keeping visible transactions', async () => {
    const admin = await registerAdminAndLogin();
    const session = await registerAndLogin();
    const account = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Export Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
      .expect(201);
    const categories = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    const expenseCategory = categories.body.data.find((category) => category.type === 'expense');
    const transactionDate = new Date().toISOString();

    const visible = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        account_id: account.body.id,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 12,
        description: 'Export visible',
        date: transactionDate,
      })
      .expect(201);

    const deleted = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        account_id: account.body.id,
        category_id: expenseCategory.id,
        type: 'expense',
        amount: 34,
        description: 'Export deleted',
        date: transactionDate,
      })
      .expect(201);

    const visibleId = visible.body.transactions[0].id;
    const deletedId = deleted.body.transactions[0].id;

    await request(app)
      .delete(`/api/admin/transactions/${deletedId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Remove from user export' })
      .expect(200);

    const exported = await request(app)
      .get('/api/auth/data')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    const exportedTransactionIds = exported.body.transactions.map((transaction) => transaction.id);
    expect(exportedTransactionIds).toContain(visibleId);
    expect(exportedTransactionIds).not.toContain(deletedId);
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

  test('refresh token reuse revokes the entire token family', async () => {
    const session = await registerAndLogin();
    const firstRotation = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    const family = db.prepare('SELECT family_id FROM refresh_tokens WHERE user_id = ? LIMIT 1').get(session.user.id);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    expect(db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE family_id = ? AND revoked = 0').get(family.family_id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND user_id = ?').get('SECURITY_REFRESH_TOKEN_REUSE', session.user.id).count).toBe(1);
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRotation.body.refreshToken })
      .expect(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: session.credentials.email, password: session.credentials.password })
      .expect(200);
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: newLogin.body.refreshToken })
      .expect(200);
  });

  test('refresh token race revokes attacker-issued child token after reuse is detected', async () => {
    const session = await registerAndLogin();
    const [left, right] = await Promise.all([
      request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken }),
      request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken }),
    ]);
    const responses = [left, right];
    const successful = responses.find((response) => response.status === 200);
    const rejected = responses.find((response) => response.status === 401);

    expect(successful?.body.refreshToken).toEqual(expect.any(String));
    expect(rejected?.body.error).toBe('Invalid refresh token');

    const family = db.prepare('SELECT family_id FROM refresh_tokens WHERE user_id = ? LIMIT 1').get(session.user.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE family_id = ? AND revoked = 0').get(family.family_id).count).toBe(0);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: successful.body.refreshToken })
      .expect(401);
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

  test('forgot password marks reset token used when delivery fails and allows retry', async () => {
    const session = await registerAndLogin();
    const originalFetch = global.fetch;
    process.env.PASSWORD_RESET_WEBHOOK_URL = 'https://hooks.financeapp.test/reset';
    process.env.PASSWORD_RESET_WEBHOOK_SECRET = 'reset-webhook-secret';
    process.env.PASSWORD_RESET_URL = 'https://app.financeapp.test/auth';
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: session.credentials.email })
      .expect(503);

    const liveTokensAfterFailure = db.prepare(`
      SELECT COUNT(*) AS count
      FROM password_reset_tokens
      WHERE user_id = ? AND used_at IS NULL
    `).get(session.user.id).count;
    expect(liveTokensAfterFailure).toBe(0);

    const delivered = [];
    global.fetch = jest.fn(async (url, options) => {
      delivered.push({ url, headers: options.headers, body: JSON.parse(options.body), rawBody: options.body });
      return { ok: true };
    });

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: session.credentials.email })
      .expect(200);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].body.token).toEqual(expect.any(String));
    const liveTokensAfterRetry = db.prepare(`
      SELECT COUNT(*) AS count
      FROM password_reset_tokens
      WHERE user_id = ? AND used_at IS NULL
    `).get(session.user.id).count;
    expect(liveTokensAfterRetry).toBe(1);
    const expectedSignature = `sha256=${crypto.createHmac('sha256', process.env.PASSWORD_RESET_WEBHOOK_SECRET).update(delivered[0].rawBody).digest('hex')}`;
    expect(delivered[0].headers['X-Webhook-Signature']).toBe(expectedSignature);

    delete process.env.PASSWORD_RESET_WEBHOOK_URL;
    delete process.env.PASSWORD_RESET_WEBHOOK_SECRET;
    delete process.env.PASSWORD_RESET_URL;
    global.fetch = originalFetch;
  });

  test('forgot password rejects unsafe auth delivery webhook URLs', async () => {
    const session = await registerAndLogin();
    const originalFetch = global.fetch;
    process.env.PASSWORD_RESET_WEBHOOK_SECRET = 'reset-webhook-secret';
    process.env.PASSWORD_RESET_URL = 'https://app.financeapp.test/auth';
    global.fetch = jest.fn(async () => ({ ok: true }));

    process.env.PASSWORD_RESET_WEBHOOK_URL = 'http://hooks.financeapp.test/reset';
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: session.credentials.email })
      .expect(503);
    expect(global.fetch).not.toHaveBeenCalled();

    process.env.PASSWORD_RESET_WEBHOOK_URL = 'https://localhost/reset';
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: session.credentials.email })
      .expect(503);
    expect(global.fetch).not.toHaveBeenCalled();

    process.env.PASSWORD_RESET_WEBHOOK_URL = 'https://10.0.0.5/reset';
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: session.credentials.email })
      .expect(503);
    expect(global.fetch).not.toHaveBeenCalled();

    const liveTokens = db.prepare(`
      SELECT COUNT(*) AS count
      FROM password_reset_tokens
      WHERE user_id = ? AND used_at IS NULL
    `).get(session.user.id).count;
    expect(liveTokens).toBe(0);

    delete process.env.PASSWORD_RESET_WEBHOOK_URL;
    delete process.env.PASSWORD_RESET_WEBHOOK_SECRET;
    delete process.env.PASSWORD_RESET_URL;
    global.fetch = originalFetch;
  });

  test('reset password token changes password and revokes sessions', async () => {
    const session = await registerAndLogin();
    const originalFetch = global.fetch;
    process.env.PASSWORD_RESET_WEBHOOK_URL = 'https://hooks.financeapp.test/reset';
    process.env.PASSWORD_RESET_WEBHOOK_SECRET = 'reset-webhook-secret';
    process.env.PASSWORD_RESET_URL = 'https://app.financeapp.test/auth';
    const delivered = [];
    global.fetch = jest.fn(async (url, options) => {
      delivered.push({ url, headers: options.headers, body: JSON.parse(options.body), rawBody: options.body });
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
    const expectedSignature = `sha256=${crypto.createHmac('sha256', process.env.PASSWORD_RESET_WEBHOOK_SECRET).update(delivered[0].rawBody).digest('hex')}`;
    expect(delivered[0].headers['X-Webhook-Signature']).toBe(expectedSignature);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND user_id = ?').get('PASSWORD_RESET_WEBHOOK_DISPATCHED', session.user.id).count).toBe(1);

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
    delete process.env.PASSWORD_RESET_WEBHOOK_SECRET;
    delete process.env.PASSWORD_RESET_URL;
    global.fetch = originalFetch;
  });
});
