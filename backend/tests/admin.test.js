const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-admin-suite-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-admin-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const app = require('../src/app');
const { db, dbPath } = require('../database/db');

async function createAdminSession() {
  const credentials = {
    email: `admin-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: 'Admin Tester',
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', credentials.email);

  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createUserSession(label = 'managed') {
  const credentials = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@financeapp.test`,
    password: 'StrongPass1!',
    full_name: `${label} User`,
  };

  await request(app).post('/api/auth/register').send(credentials).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
  return { ...login.body, credentials };
}

async function createAccount(accessToken) {
  const response = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Managed Checking', type: 'checking', currency: 'USD', color: '#0F3460', icon: 'credit-card' })
    .expect(201);
  return response.body;
}

async function getExpenseCategory(accessToken) {
  const response = await request(app).get('/api/categories').set('Authorization', `Bearer ${accessToken}`).expect(200);
  return response.body.data.find((category) => category.type === 'expense') || response.body.data[0];
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('Admin API', () => {
  let admin;
  let managedUser;
  let managedAccount;
  let managedCategory;

  beforeAll(async () => {
    admin = await createAdminSession();
    managedUser = await createUserSession('managed');
    managedAccount = await createAccount(managedUser.accessToken);
    managedCategory = await getExpenseCategory(managedUser.accessToken);
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${managedUser.accessToken}`)
      .send({
        account_id: managedAccount.id,
        category_id: managedCategory.id,
        type: 'expense',
        amount: 18.5,
        description: 'Admin visible transaction',
        date: new Date().toISOString(),
      })
      .expect(201);
  });

  test('get users returns empty data with pagination for no-match filters', async () => {
    const response = await request(app)
      .get('/api/admin/users?page=1&limit=20&search=no-user-with-this-name')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      data: [],
      pagination: expect.objectContaining({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        page_size: 20,
        total_count: 0,
        total_pages: 0,
      }),
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();
  });

  test('non-admin users cannot access admin endpoints', async () => {
    await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${managedUser.accessToken}`)
      .expect(403);
  });

  test('lists users and returns user detail summaries', async () => {
    const list = await request(app)
      .get(`/api/admin/users?search=${encodeURIComponent(managedUser.credentials.email)}&limit=10`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toEqual(expect.objectContaining({
      id: managedUser.user.id,
      email: managedUser.credentials.email,
      account_count: 2,
      transaction_count: 1,
    }));
    expect(list.body.data[0]).not.toHaveProperty('password_hash');

    const detail = await request(app)
      .get(`/api/admin/users/${managedUser.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(detail.body.user).toEqual(expect.objectContaining({
      id: managedUser.user.id,
      email: managedUser.credentials.email,
    }));
    expect(detail.body.user).not.toHaveProperty('password_hash');
    expect(detail.body.summary).toEqual(expect.objectContaining({
      account_count: 2,
      total_account_balance: -18.5,
      transaction_count: 1,
      refresh_token_count: expect.any(Number),
    }));
    expect(Array.isArray(detail.body.recent_audit_logs)).toBe(true);
  });

  test('paginates admin users and active sessions with page_size metadata', async () => {
    const sessionTarget = await createUserSession('session-page');

    const users = await request(app)
      .get('/api/admin/users?page=1&page_size=1')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(Array.isArray(users.body.data)).toBe(true);
    expect(users.body.data).toHaveLength(1);
    expect(users.body.pagination).toEqual(expect.objectContaining({
      total_count: expect.any(Number),
      page: 1,
      page_size: 1,
      total_pages: expect.any(Number),
    }));
    expect(users.body.pagination.total_pages).toBe(Math.ceil(users.body.pagination.total_count / 1));

    await request(app)
      .get('/api/admin/users?page=0')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(400);

    const sessions = await request(app)
      .get(`/api/admin/users/${sessionTarget.user.id}/sessions?page=1&page_size=1`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(Array.isArray(sessions.body.data)).toBe(true);
    expect(sessions.body.data).toHaveLength(1);
    expect(sessions.body.pagination).toEqual(expect.objectContaining({
      total_count: expect.any(Number),
      page: 1,
      page_size: 1,
      total_pages: expect.any(Number),
    }));
    expect(sessions.body.pagination.total_pages).toBe(Math.ceil(sessions.body.pagination.total_count / 1));

    await request(app)
      .get(`/api/admin/users/${sessionTarget.user.id}/sessions?page=0`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(400);
  });

  test('returns user analytics, login history, budget performance, and export data', async () => {
    const spending = await request(app)
      .get(`/api/admin/users/${managedUser.user.id}/spending-by-category`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(spending.body.total).toBe(18.5);
    expect(spending.body.data[0]).toEqual(expect.objectContaining({
      category_name: expect.any(String),
      total: 18.5,
      transaction_count: 1,
      percent: 100,
    }));

    const loginHistory = await request(app)
      .get(`/api/admin/users/${managedUser.user.id}/login-history?page=1&limit=5`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(loginHistory.body.pagination).toEqual(expect.objectContaining({ page: 1, limit: 5 }));
    expect(loginHistory.body.data.some((log) => log.action === 'USER_LOGIN')).toBe(true);

    const budgets = await request(app)
      .get(`/api/admin/users/${managedUser.user.id}/budget-performance`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(Array.isArray(budgets.body.data)).toBe(true);

    const exported = await request(app)
      .get(`/api/admin/users/${managedUser.user.id}/export?limit=1`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(exported.body).toEqual(expect.objectContaining({
      exported_at: expect.any(String),
      export_as_of: expect.any(String),
      export_limit: 1,
      next_cursor: expect.any(String),
      user: expect.objectContaining({ id: managedUser.user.id }),
      accounts: expect.any(Array),
      transactions: expect.any(Array),
      budgets: expect.any(Array),
      audit_logs: expect.any(Array),
    }));
    expect(exported.body.transactions).toHaveLength(1);
    expect(exported.headers['content-type']).toContain('application/json');
    expect(exported.body.accounts.length).toBeLessThanOrEqual(1);
    expect(exported.body.audit_logs.length).toBeLessThanOrEqual(1);

    const nextExport = await request(app)
      .get(`/api/admin/users/${managedUser.user.id}/export?limit=1&cursor=${encodeURIComponent(exported.body.next_cursor)}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(nextExport.body.cursor.as_of).toBe(exported.body.export_as_of);
    expect(nextExport.body.accounts.length).toBeLessThanOrEqual(1);
    expect(nextExport.body.audit_logs.length).toBeLessThanOrEqual(1);
  });

  test('records security attack attempts and authentication failures for admin review', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: "attacker@example.com' OR '1'='1", password: '<script>alert(1)</script>' })
      .expect(400);

    const securityLogs = await request(app)
      .get('/api/admin/audit-logs?action=SECURITY_ATTACK_ATTEMPT&limit=10')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(securityLogs.body.data.length).toBeGreaterThan(0);
    expect(JSON.parse(securityLogs.body.data[0].new_value).findings.some((finding) => ['xss', 'sql_injection'].includes(finding.attack_type))).toBe(true);

    await request(app)
      .post('/api/auth/login')
      .send({ email: managedUser.credentials.email, password: 'WrongPass1!' })
      .expect(401);

    const authFailureLogs = await request(app)
      .get('/api/admin/audit-logs?action=SECURITY_AUTH_FAILURE&limit=10')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(authFailureLogs.body.data.some((log) => log.user_id === managedUser.user.id)).toBe(true);

    const auditPage = await request(app)
      .get('/api/admin/audit-logs?page=1&page_size=1')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(Array.isArray(auditPage.body.data)).toBe(true);
    expect(auditPage.body.data).toHaveLength(1);
    expect(auditPage.body.pagination).toEqual(expect.objectContaining({
      total_count: expect.any(Number),
      page: 1,
      page_size: 1,
      total_pages: expect.any(Number),
    }));
    expect(auditPage.body.pagination.total_pages).toBe(Math.ceil(auditPage.body.pagination.total_count / 1));

    await request(app)
      .get('/api/admin/audit-logs?page=0')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(400);

    const dashboard = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(dashboard.body.security).toEqual(expect.objectContaining({
      attack_attempts: expect.any(Number),
      auth_failures: expect.any(Number),
      recent_events: expect.any(Array),
    }));
    expect(dashboard.body.security.attack_attempts).toBeGreaterThan(0);
    expect(dashboard.body.security.auth_failures).toBeGreaterThan(0);
  });

  test('updates user role and status while protecting admin self-actions', async () => {
    await request(app)
      .put(`/api/admin/users/${admin.user.id}/role`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'user' })
      .expect(400);

    const roleResponse = await request(app)
      .put(`/api/admin/users/${managedUser.user.id}/role`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'admin' })
      .expect(200);

    expect(roleResponse.body.role).toBe('admin');
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND entity_id = ?').get('ADMIN_UPDATED_USER_ROLE', managedUser.user.id).count).toBeGreaterThan(0);

    const statusResponse = await request(app)
      .put(`/api/admin/users/${managedUser.user.id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ is_active: false })
      .expect(200);

    expect(statusResponse.body.is_active).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = ? AND revoked = 0').get(managedUser.user.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND entity_id = ?').get('ADMIN_UPDATED_USER_STATUS', managedUser.user.id).count).toBeGreaterThan(0);
  });

  test('resets a user password and records audit logs', async () => {
    const target = await createUserSession('reset-target');

    const response = await request(app)
      .post(`/api/admin/users/${target.user.id}/reset-password`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ temporary_password: 'TempPass1!' })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      must_change_password: true,
      temporary_password: 'TempPass1!',
      delivery: expect.objectContaining({ channel: 'manual', sent: false }),
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: target.credentials.email, password: 'TempPass1!' })
      .expect(200);

    expect(login.body.user.must_change_password).toBe(1);

    await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);

    const changed = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: 'TempPass1!', newPassword: 'ChangedPass1!' })
      .expect(200);

    expect(changed.body.accessToken).toEqual(expect.any(String));

    await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${changed.body.accessToken}`)
      .expect(200);

    const auditLogs = await request(app)
      .get(`/api/admin/audit-logs?action=ADMIN_RESET_USER_PASSWORD&user_id=${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(auditLogs.body.data.some((log) => log.entity_id === target.user.id)).toBe(true);
    expect(auditLogs.body.data.find((log) => log.entity_id === target.user.id)).toEqual(expect.objectContaining({
      action_label: 'Reset User Password',
      summary: expect.stringContaining('reset the password'),
      old_value: expect.any(String),
      new_value: expect.any(String),
    }));

    const notification = await request(app)
      .get('/api/auth/notifications')
      .set('Authorization', `Bearer ${changed.body.accessToken}`)
      .expect(200);
    expect(notification.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'admin-password-reset',
        title: 'Password reset by admin',
      }),
    ]));

    const generatedTarget = await createUserSession('generated-reset-target');
    const generated = await request(app)
      .post(`/api/admin/users/${generatedTarget.user.id}/reset-password`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({})
      .expect(200);
    expect(generated.body.temporary_password).toEqual(expect.any(String));
    expect(generated.body.temporary_password).toHaveLength(16);
    await request(app)
      .post('/api/auth/login')
      .send({ email: generatedTarget.credentials.email, password: generated.body.temporary_password })
      .expect(200);
  });

  test('returns managed user transactions and system health', async () => {
    const transactions = await request(app)
      .get(`/api/admin/users/${managedUser.user.id}/transactions?limit=5`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(transactions.body.data).toHaveLength(1);
    expect(transactions.body.data[0]).toEqual(expect.objectContaining({
      user_id: managedUser.user.id,
      account_name: managedAccount.name,
      category_name: expect.any(String),
    }));

    const health = await request(app)
      .get('/api/admin/system-health')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(health.body).toEqual(expect.objectContaining({
      db_size_mb: expect.any(Number),
      active_sessions: expect.any(Number),
      uptime_seconds: expect.any(Number),
      heap_used_mb: expect.any(Number),
      heap_limit_mb: expect.any(Number),
    }));
    expect(health.body).not.toHaveProperty('node_version');
    expect(health.body).not.toHaveProperty('memory_usage');
  });

  test('manages global transactions and user account support actions', async () => {
    const target = await createUserSession('global-tx');
    const account = await createAccount(target.accessToken);
    const category = await getExpenseCategory(target.accessToken);
    const created = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 12,
        description: 'Global admin transaction',
        date: new Date().toISOString(),
      })
      .expect(201);

    const globalList = await request(app)
      .get(`/api/admin/transactions?search=${encodeURIComponent(target.credentials.email)}&limit=10`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(globalList.body.data.some((tx) => tx.id === created.body.id && tx.user_email === target.credentials.email)).toBe(true);

    const transactionPage = await request(app)
      .get('/api/admin/transactions?page=1&page_size=1')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(Array.isArray(transactionPage.body.data)).toBe(true);
    expect(transactionPage.body.data).toHaveLength(1);
    expect(transactionPage.body.pagination).toEqual(expect.objectContaining({
      total_count: expect.any(Number),
      page: 1,
      page_size: 1,
      total_pages: expect.any(Number),
    }));
    expect(transactionPage.body.pagination.total_pages).toBe(Math.ceil(transactionPage.body.pagination.total_count / 1));

    await request(app)
      .get('/api/admin/transactions?page=0')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(400);

    const detail = await request(app)
      .get(`/api/admin/transactions/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(detail.body).toEqual(expect.objectContaining({ id: created.body.id, user_email: target.credentials.email }));

    const accounts = await request(app)
      .get(`/api/admin/users/${target.user.id}/accounts`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(accounts.body.data.some((row) => row.id === account.id)).toBe(true);

    const correction = await request(app)
      .post(`/api/admin/users/${target.user.id}/accounts/${account.id}/correction`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ target_balance: 100, reason: 'Support verified correction' })
      .expect(201);
    expect(correction.body.transaction.description).toBe('Admin balance correction');
    expect(correction.body.account.balance).toBe(100);

    const closed = await request(app)
      .put(`/api/admin/users/${target.user.id}/accounts/${account.id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ is_active: false, reason: 'Support close request' })
      .expect(200);
    expect(closed.body.is_active).toBe(0);

    const accountToDelete = await createAccount(target.accessToken);
    const movedTransaction = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({
        account_id: accountToDelete.id,
        category_id: category.id,
        type: 'expense',
        amount: 9,
        description: 'Move before account delete',
        date: new Date().toISOString(),
      })
      .expect(201);

    const deletedAccount = await request(app)
      .delete(`/api/admin/users/${target.user.id}/accounts/${accountToDelete.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Support requested account deletion', transaction_action: 'cash' })
      .expect(200);
    expect(deletedAccount.body.transactions).toEqual(expect.objectContaining({ action: 'cash', moved: 1 }));
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE id = ?').get(accountToDelete.id).count).toBe(0);
    expect(db.prepare('SELECT account_id FROM transactions WHERE id = ?').get(movedTransaction.body.id).account_id).not.toBe(accountToDelete.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND entity_id = ?').get('ADMIN_DELETED_USER_ACCOUNT', accountToDelete.id).count).toBe(1);
    const accountDeleteNotification = await request(app)
      .get('/api/auth/notifications')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .expect(200);
    expect(accountDeleteNotification.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'admin-account-deleted',
        title: 'Account deleted by admin',
        body: expect.stringContaining('Support requested account deletion'),
      }),
    ]));

    const accountToDeleteWithTransactions = await createAccount(target.accessToken);
    const deletedTransaction = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({
        account_id: accountToDeleteWithTransactions.id,
        category_id: category.id,
        type: 'expense',
        amount: 5,
        description: 'Delete with account',
        date: new Date().toISOString(),
      })
      .expect(201);
    const deletedAccountWithTransactions = await request(app)
      .delete(`/api/admin/users/${target.user.id}/accounts/${accountToDeleteWithTransactions.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Remove account and transactions', transaction_action: 'delete' })
      .expect(200);
    expect(deletedAccountWithTransactions.body.transactions).toEqual(expect.objectContaining({ action: 'delete', deleted: 1 }));
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE id = ?').get(accountToDeleteWithTransactions.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE id = ?').get(deletedTransaction.body.id).count).toBe(0);

    await request(app)
      .delete(`/api/admin/transactions/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Fraud review duplicate' })
      .expect(200);

    const hiddenFromUser = await request(app)
      .get(`/api/transactions/${created.body.id}`)
      .set('Authorization', `Bearer ${target.accessToken}`)
      .expect(404);
    expect(hiddenFromUser.body.error).toBe('Transaction not found');

    const includeDeleted = await request(app)
      .get(`/api/admin/transactions?include_deleted=true&search=${encodeURIComponent('Global admin transaction')}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(includeDeleted.body.data.some((tx) => tx.id === created.body.id && tx.admin_delete_reason === 'Fraud review duplicate')).toBe(true);

    const adminDeleted = await request(app)
      .get('/api/admin/transactions?admin_deleted=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(adminDeleted.body.data.some((tx) => tx.id === created.body.id)).toBe(true);
  });

  test('admin date-only range filters include the full selected day', async () => {
    const target = await createUserSession('date-range');
    const account = await createAccount(target.accessToken);
    const category = await getExpenseCategory(target.accessToken);

    const inside = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 21,
        description: 'Inside date range',
        date: '2026-05-06T18:30:00.000Z',
      })
      .expect(201);

    const outside = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({
        account_id: account.id,
        category_id: category.id,
        type: 'expense',
        amount: 22,
        description: 'Outside date range',
        date: '2026-05-07T01:30:00.000Z',
      })
      .expect(201);

    const global = await request(app)
      .get('/api/admin/transactions?start_date=2026-05-06&end_date=2026-05-06&limit=20')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(global.body.data.some((tx) => tx.id === inside.body.id)).toBe(true);
    expect(global.body.data.some((tx) => tx.id === outside.body.id)).toBe(false);

    const userTransactions = await request(app)
      .get(`/api/admin/users/${target.user.id}/transactions?start_date=2026-05-06&end_date=2026-05-06&limit=20`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(userTransactions.body.data.map((tx) => tx.id)).toContain(inside.body.id);
    expect(userTransactions.body.data.map((tx) => tx.id)).not.toContain(outside.body.id);

    db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
      VALUES (?, ?, 'DATE_RANGE_TEST', 'test', NULL, NULL, NULL, NULL, NULL, ?)
    `).run('00000000-0000-4000-8000-000000000002', admin.user.id, '2026-05-06T22:45:00.000Z');

    const auditLogs = await request(app)
      .get('/api/admin/audit-logs?action=DATE_RANGE_TEST&start_date=2026-05-06&end_date=2026-05-06')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(auditLogs.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'DATE_RANGE_TEST' }),
    ]));
  });

  test('manages defaults, safety blocks, settings, reports, announcements, tokens, and webhooks', async () => {
    const pushTarget = await createUserSession('push-target');
    const activeCategoryName = `Existing Push ${Date.now()}`;
    await request(app)
      .post('/api/admin/default-categories')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: activeCategoryName, type: 'expense', icon: 'file-text', color: '#654321', is_system: true })
      .expect(201);

    const userCategoriesBeforePush = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${pushTarget.accessToken}`)
      .expect(200);
    expect(userCategoriesBeforePush.body.data.filter((item) => item.name === activeCategoryName && item.type === 'expense')).toHaveLength(1);

    const pushDefaults = await request(app)
      .post('/api/admin/default-categories/push')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(pushDefaults.body.inserted).toBe(0);
    expect(pushDefaults.body.skipped).toBeGreaterThan(0);

    const userCategoriesAfterPush = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${pushTarget.accessToken}`)
      .expect(200);
    expect(userCategoriesAfterPush.body.data.filter((item) => item.name === activeCategoryName && item.type === 'expense')).toHaveLength(1);

    const category = await request(app)
      .post('/api/admin/default-categories')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: `Compliance ${Date.now()}`, type: 'expense', icon: 'file-text', color: '#123456', is_system: true })
      .expect(201);
    expect(category.body.is_system).toBe(1);

    const updatedCategory = await request(app)
      .put(`/api/admin/default-categories/${category.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ sort_order: 5, is_active: false })
      .expect(200);
    expect(updatedCategory.body.is_active).toBe(0);
    const deletedCategory = await request(app)
      .delete(`/api/admin/default-categories/${category.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(deletedCategory.body).toEqual(expect.objectContaining({ deleted: true }));
    expect(db.prepare('SELECT id FROM categories WHERE id = ?').get(category.body.id)).toBeUndefined();

    await request(app)
      .post('/api/admin/default-categories/push')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const bulkTarget = await createUserSession('bulk-target');
    await request(app)
      .post('/api/admin/users/bulk')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ user_ids: [bulkTarget.user.id], action: 'force_password_reset', reason: 'Security support request' })
      .expect(200);
    expect(db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(bulkTarget.user.id).must_change_password).toBe(1);

    const revoked = await request(app)
      .post(`/api/admin/users/${bulkTarget.user.id}/revoke-sessions`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(0);

    const impersonation = await request(app)
      .post(`/api/admin/users/${bulkTarget.user.id}/impersonate`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Support reproduction' })
      .expect(200);
    expect(impersonation.body.accessToken).toEqual(expect.any(String));
    expect(impersonation.body.warning).toMatch(/sensitive/i);

    const block = await request(app)
      .post('/api/admin/security-blocks')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ ip: '203.0.113.10', duration_minutes: 5 })
      .expect(201);
    expect(block.body.is_blocked).toBe(true);
    const blocks = await request(app).get('/api/admin/security-blocks').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    expect(blocks.body.data.some((row) => row.ip === '203.0.113.10')).toBe(true);
    await request(app).delete('/api/admin/security-blocks/203.0.113.10').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);

    const config = await request(app).get('/api/admin/system-config').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    expect(config.body.writable_settings.default_currency).toBe('USD');
    const updatedConfig = await request(app)
      .put('/api/admin/system-config')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ default_currency: 'cad', audit_retention_months: 18 })
      .expect(200);
    expect(updatedConfig.body.writable_settings.default_currency).toBe('CAD');
    await request(app)
      .put('/api/admin/system-config')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ default_currency: 'US<script>', audit_retention_months: 0 })
      .expect(400);
    const safeConfig = await request(app)
      .get('/api/admin/system-config')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(safeConfig.body.writable_settings.default_currency).toBe('CAD');
    expect(safeConfig.body.writable_settings.audit_retention_months).toBe(18);

    db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
      VALUES (?, ?, 'OLD_TEST_LOG', 'test', NULL, NULL, NULL, NULL, NULL, ?)
    `).run('00000000-0000-4000-8000-000000000001', admin.user.id, '2020-01-01T00:00:00.000Z');
    const retention = await request(app).get('/api/admin/audit-retention').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    expect(retention.body.count).toBeGreaterThan(0);
    const purge = await request(app)
      .post('/api/admin/audit-retention/purge')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ before: '2021-01-01T00:00:00.000Z' })
      .expect(200);
    expect(purge.body.purged).toBe(1);

    const integrity = await request(app).post('/api/admin/database/integrity-check').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    expect(integrity.body.ok).toBe(true);

    const reports = await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    expect(reports.body).toEqual(expect.objectContaining({ monthly_financials: expect.any(Array), cohorts: expect.any(Array), categories: expect.any(Array) }));
    const csv = await request(app).get('/api/admin/reports/export?type=monthly').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');

    const announcement = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ title: 'Maintenance', body: 'Planned maintenance window', is_active: true })
      .expect(201);
    const userAnnouncements = await request(app)
      .get('/api/announcements')
      .set('Authorization', `Bearer ${pushTarget.accessToken}`)
      .expect(200);
    expect(userAnnouncements.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: announcement.body.id, title: 'Maintenance', body: 'Planned maintenance window' }),
    ]));
    await request(app)
      .post(`/api/announcements/${announcement.body.id}/dismiss`)
      .set('Authorization', `Bearer ${pushTarget.accessToken}`)
      .expect(200);
    const dismissedAnnouncements = await request(app)
      .get('/api/announcements')
      .set('Authorization', `Bearer ${pushTarget.accessToken}`)
      .expect(200);
    expect(dismissedAnnouncements.body.data.some((item) => item.id === announcement.body.id)).toBe(false);
    await request(app)
      .put(`/api/admin/announcements/${announcement.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ is_active: false })
      .expect(200);
    const hiddenAnnouncements = await request(app)
      .get('/api/announcements')
      .set('Authorization', `Bearer ${pushTarget.accessToken}`)
      .expect(200);
    expect(hiddenAnnouncements.body.data.some((item) => item.id === announcement.body.id)).toBe(false);
    const deletedAnnouncement = await request(app)
      .delete(`/api/admin/announcements/${announcement.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(deletedAnnouncement.body).toEqual(expect.objectContaining({ deleted: true, dismissals_deleted: 1 }));
    expect(db.prepare('SELECT id FROM announcements WHERE id = ?').get(announcement.body.id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM announcement_dismissals WHERE announcement_id = ?').get(announcement.body.id).count).toBe(0);
    await request(app)
      .put(`/api/admin/announcements/${announcement.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ is_active: true })
      .expect(404);

    const token = await request(app)
      .post('/api/admin/api-tokens')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Reporting token', scopes: ['read:users'] })
      .expect(201);
    expect(token.body.token).toMatch(/^fa_/);
    expect(token.body.scopes).toEqual(['read:users']);
    await request(app).delete(`/api/admin/api-tokens/${token.body.id}`).set('Authorization', `Bearer ${admin.accessToken}`).expect(200);

    const invalidToken = await request(app)
      .post('/api/admin/api-tokens')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Invalid reporting token', scopes: ['reports:read'] })
      .expect(400);
    expect(invalidToken.body.error).toContain('reports:read');
    expect(invalidToken.body.allowed_scopes).toContain('read:users');
    const invalidTokenAudit = await request(app)
      .get('/api/admin/audit-logs?action=ADMIN_REJECTED_API_TOKEN_SCOPE&limit=1')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(invalidTokenAudit.body.data[0]).toEqual(expect.objectContaining({
      action_label: 'Rejected Api Token Scope',
      summary: expect.stringContaining('unsupported scope'),
    }));

    const webhook = await request(app)
      .post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Password reset hook', url: 'https://example.com/hooks/password', event: 'password_reset' })
      .expect(201);
    expect(webhook.body.secret).toBe('[configured]');
    await request(app)
      .put(`/api/admin/webhooks/${webhook.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ is_active: false })
      .expect(200);
    const deliveries = await request(app)
      .get(`/api/admin/webhooks/${webhook.body.id}/deliveries`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(deliveries.body.data).toEqual([]);
  });

  test('hard-deletes a user and removes deleted-user records', async () => {
    const target = await createUserSession('delete-target');
    const retainedAuditBefore = db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ? OR entity_id = ?').get(target.user.id, target.user.id).count;
    expect(retainedAuditBefore).toBeGreaterThan(0);

    const deleted = await request(app)
      .delete(`/api/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    await request(app)
      .get(`/api/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(404);

    expect(db.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').get(target.user.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(target.user.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(target.user.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = ?').get(target.user.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ?').get(target.user.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id = ?').get(target.user.id).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND user_id = ?').get('ADMIN_HARD_DELETED_USER', admin.user.id).count).toBe(1);

    const deletedUsers = await request(app)
      .get(`/api/admin/deleted-users?search=${encodeURIComponent(target.credentials.email)}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(deletedUsers.body.data).toHaveLength(1);
    expect(deletedUsers.body.data[0]).toEqual(expect.objectContaining({
      id: deleted.body.archive_id,
      original_user_id: target.user.id,
      email: target.credentials.email,
      full_name: target.credentials.full_name,
      account_count: expect.any(Number),
      transaction_count: expect.any(Number),
    }));

    const deletedUsersPage = await request(app)
      .get('/api/admin/deleted-users?page=1&page_size=1')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(Array.isArray(deletedUsersPage.body.data)).toBe(true);
    expect(deletedUsersPage.body.data).toHaveLength(1);
    expect(deletedUsersPage.body.pagination).toEqual(expect.objectContaining({
      total_count: expect.any(Number),
      page: 1,
      page_size: 1,
      total_pages: expect.any(Number),
    }));
    expect(deletedUsersPage.body.pagination.total_pages).toBe(Math.ceil(deletedUsersPage.body.pagination.total_count / 1));

    const deletedUsersByDate = await request(app)
      .get(`/api/admin/deleted-users?date_from=${encodeURIComponent(new Date(Date.now() - 60 * 1000).toISOString())}&date_to=${encodeURIComponent(new Date(Date.now() + 60 * 1000).toISOString())}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(deletedUsersByDate.body.data.some((row) => row.id === deleted.body.archive_id)).toBe(true);

    await request(app)
      .get('/api/admin/deleted-users?page=0')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(400);

    const deletedDetail = await request(app)
      .get(`/api/admin/deleted-users/${deleted.body.archive_id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(deletedDetail.body.details).toEqual({
      summary: expect.objectContaining({
        account_count: expect.any(Number),
        transaction_count: expect.any(Number),
        budget_count: expect.any(Number),
        total_account_balance: expect.any(Number),
        transaction_total: expect.any(Number),
      }),
    });
    expect(deletedDetail.body.details.accounts).toBeUndefined();
    expect(deletedDetail.body.details.audit_logs).toBeUndefined();

    const loginAfterDelete = await request(app)
      .post('/api/auth/login')
      .send({ email: target.credentials.email, password: target.credentials.password })
      .expect(401);
    expect(loginAfterDelete.body).toEqual({ error: 'Invalid credentials' });

    await request(app)
      .post('/api/auth/register')
      .send(target.credentials)
      .expect(201);
    const recreatedUser = db.prepare('SELECT id, email, full_name FROM users WHERE email = ?').get(target.credentials.email);
    expect(recreatedUser).toEqual(expect.objectContaining({
      email: target.credentials.email,
      full_name: target.credentials.full_name,
    }));
    expect(recreatedUser.id).not.toBe(target.user.id);

    const loginAfterRecreate = await request(app)
      .post('/api/auth/login')
      .send({ email: target.credentials.email, password: target.credentials.password })
      .expect(200);
    expect(loginAfterRecreate.body.user.id).toBe(recreatedUser.id);

    const retainedLogs = db.prepare('SELECT old_value, new_value FROM audit_logs WHERE action = ?').all('ADMIN_HARD_DELETED_USER');
    expect(JSON.stringify(retainedLogs)).not.toContain(target.credentials.email);
    expect(JSON.stringify(retainedLogs)).not.toContain(target.credentials.full_name);
    expect(JSON.stringify(db.prepare('SELECT * FROM users').all())).not.toContain('Deleted User');
  });
});
