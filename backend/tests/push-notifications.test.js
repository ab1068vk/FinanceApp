const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-push-suite-32-bytes-minimum';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-push-suite-32-bytes-min';
process.env.DB_PATH = path.join(__dirname, `test-push-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');
const { sendPushNotification } = require('../src/utils/pushNotifications');

async function registerAndLogin() {
  const credentials = {
    email: `push-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'Push Tester',
  };
  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return login.body;
}

afterEach(() => {
  global.fetch = undefined;
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Push notifications', () => {
  test('registers and deregisters an Expo push token', async () => {
    const login = await registerAndLogin();
    const auth = { Authorization: `Bearer ${login.accessToken}` };

    await request(app)
      .post('/api/auth/push-token')
      .set(auth)
      .send({ token: 'ExponentPushToken[test-token]', platform: 'ios' })
      .expect(201);

    expect(db.prepare('SELECT COUNT(*) AS count FROM push_tokens WHERE user_id = ?').get(login.user.id).count).toBe(1);

    await request(app)
      .delete('/api/auth/push-token')
      .set(auth)
      .send({ token: 'ExponentPushToken[test-token]' })
      .expect(200);

    expect(db.prepare('SELECT COUNT(*) AS count FROM push_tokens WHERE user_id = ?').get(login.user.id).count).toBe(0);
  });

  test('sendPushNotification calls Expo API and removes invalid tokens', async () => {
    const login = await registerAndLogin();
    db.prepare('INSERT INTO push_tokens (id, user_id, token, platform, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('token-id', login.user.id, 'ExponentPushToken[invalid]', 'ios', new Date().toISOString());

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ status: 'error', message: 'Device not registered', details: { error: 'DeviceNotRegistered' } }],
      }),
    });

    const result = await sendPushNotification(login.user.id, 'Title', 'Body', { type: 'password_changed' });

    expect(result.sent).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({ method: 'POST' })
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM push_tokens WHERE user_id = ?').get(login.user.id).count).toBe(0);
  });
});
