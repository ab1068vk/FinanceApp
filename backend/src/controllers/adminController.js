const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const v8 = require('v8');
const { db, dbPath } = require('../../database/db');
const logger = require('../utils/logger');
const { generateAccessToken, hashPassword, hashToken, encryptSecret, sanitizeUser } = require('../utils/security');
const { serializeAuditValue } = require('../utils/audit');
const { clientIp } = require('../utils/clientIp');
const { blockSecurityIp, clearSecurityIp, listSecurityBlocks } = require('../middleware/securityMonitor');
const { getOrCreateDefaultCashAccount } = require('../utils/defaultAccount');
const { assertSafeWebhookUrl } = require('../utils/urlSafety');
const { sendPushNotification } = require('../utils/pushNotifications');

const backendRoot = path.join(__dirname, '..', '..');
const logDir = path.join(backendRoot, 'logs');
const MAX_EXPORT_LIMIT = 50000;
const AVAILABLE_TOKEN_SCOPES = [
  'admin:*',
  'read:users',
  'write:users',
  'read:transactions',
  'write:transactions',
  'write:announcements',
  'db:backup',
  'db:maintenance',
];

function nowIso() {
  return new Date().toISOString();
}

function newSecurityStamp() {
  return crypto.randomBytes(32).toString('hex');
}

function audit(req, action, entityType, entityId, oldValue = null, newValue = null) {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    req.user.id,
    action,
    entityType,
    entityId,
    serializeAuditValue(oldValue),
    serializeAuditValue(newValue),
    clientIp(req),
    req.get('user-agent') || null,
    nowIso()
  );
}

function replaceLiteral(value, target, replacement) {
  if (!value || !target) return value;
  return String(value).split(target).join(replacement);
}

function redactDeletedUserAuditValue(value, user) {
  let redacted = value;
  redacted = replaceLiteral(redacted, user.email, '[DELETED_USER_EMAIL]');
  redacted = replaceLiteral(redacted, user.full_name, '[DELETED_USER_NAME]');
  return redacted;
}

function redactDeletedUserAuditHistory(user) {
  const rows = db.prepare(`
    SELECT id, user_id, old_value, new_value
    FROM audit_logs
    WHERE user_id = ?
      OR entity_id = ?
      OR old_value LIKE ?
      OR new_value LIKE ?
      OR old_value LIKE ?
      OR new_value LIKE ?
  `).all(
    user.id,
    user.id,
    `%${user.email}%`,
    `%${user.email}%`,
    `%${user.full_name}%`,
    `%${user.full_name}%`
  );
  const update = db.prepare(`
    UPDATE audit_logs
    SET user_id = CASE WHEN user_id = @deleted_user_id THEN NULL ELSE user_id END,
        old_value = @old_value,
        new_value = @new_value
    WHERE id = @id
  `);

  for (const row of rows) {
    update.run({
      id: row.id,
      deleted_user_id: user.id,
      old_value: redactDeletedUserAuditValue(row.old_value, user),
      new_value: redactDeletedUserAuditValue(row.new_value, user),
    });
  }
}

function mb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function mb1(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}

function getLogStats() {
  if (!fs.existsSync(logDir)) {
    return { log_count: 0, log_size_mb: 0 };
  }

  const stats = fs.readdirSync(logDir).reduce((acc, name) => {
    const filePath = path.join(logDir, name);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return acc;
    return { count: acc.count + 1, bytes: acc.bytes + stat.size };
  }, { count: 0, bytes: 0 });

  return {
    log_count: stats.count,
    log_size_mb: mb(stats.bytes),
  };
}

function getDbSizeMb() {
  return fs.existsSync(dbPath) ? mb(fs.statSync(dbPath).size) : 0;
}

function pagination(req, defaultLimit = 50) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || defaultLimit, 1), 200);
  return { page, limit, offset: (page - 1) * limit };
}

function paginationMeta(page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    page_size: limit,
    total_count: total,
    total_pages: totalPages,
  };
}

function exportLimit(req) {
  return Math.min(Math.max(Number(req.query.limit) || 1000, 1), MAX_EXPORT_LIMIT);
}

function encodeExportCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeExportCursor(value) {
  if (!value) {
    return { accounts: 0, transactions: 0, budgets: 0, audit_logs: 0, as_of: null };
  }

  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed.as_of || Number.isNaN(Date.parse(parsed.as_of))) {
      throw new Error('Cursor is missing a valid as_of value');
    }
    return {
      accounts: Math.max(Number(parsed.accounts) || 0, 0),
      transactions: Math.max(Number(parsed.transactions) || 0, 0),
      budgets: Math.max(Number(parsed.budgets) || 0, 0),
      audit_logs: Math.max(Number(parsed.audit_logs) || 0, 0),
      as_of: parsed.as_of,
    };
  } catch {
    throw Object.assign(new Error('Invalid export cursor'), { statusCode: 400 });
  }
}

function writeJsonValue(res, key, value, prefix = ',') {
  res.write(`${prefix}"${key}":${JSON.stringify(value)}`);
}

function streamJsonArray(res, key, statement, params, limit, offset) {
  res.write(`,"${key}":[`);
  let count = 0;
  let hasMore = false;
  let first = true;

  for (const row of statement.iterate(...params, limit + 1, offset)) {
    if (count >= limit) {
      hasMore = true;
      break;
    }
    if (!first) res.write(',');
    res.write(JSON.stringify(row));
    first = false;
    count += 1;
  }

  res.write(']');
  return { count, hasMore };
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function rangeStartIso(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  return new Date(raw).toISOString();
}

function rangeEndIso(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59.999Z`;
  return new Date(raw).toISOString();
}

function assertUserExists(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function activeAdminCount() {
  return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
}

function wouldRemoveLastActiveAdmin(user) {
  return user?.role === 'admin' && user?.is_active === 1 && activeAdminCount() <= 1;
}

function userDateFilters(req, column, params) {
  const where = [];
  if (req.query.start_date) {
    where.push(`${column} >= ?`);
    params.push(rangeStartIso(req.query.start_date));
  }
  if (req.query.end_date) {
    where.push(`${column} <= ?`);
    params.push(rangeEndIso(req.query.end_date));
  }
  return where;
}

function transactionDelta(transaction) {
  const amount = Number(transaction.amount || 0);
  if (transaction.type === 'income') return amount;
  if (transaction.type === 'expense') return -amount;
  if (transaction.type === 'transfer') return transaction.transfer_direction === 'destination' ? amount : -amount;
  return 0;
}

function updateStoredBalance(accountId, userId, delta) {
  if (!accountId) return;
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
}

function transactionsForAccountDelete(accountId, userId) {
  const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
  const transferGroupIds = Array.from(new Set(direct.map((tx) => tx.transfer_group_id).filter(Boolean)));
  if (!transferGroupIds.length) return direct;

  const placeholders = transferGroupIds.map(() => '?').join(', ');
  const transferRows = db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ? AND transfer_group_id IN (${placeholders})
      AND admin_deleted_at IS NULL
  `).all(userId, ...transferGroupIds);

  const byId = new Map();
  [...direct, ...transferRows].forEach((tx) => byId.set(tx.id, tx));
  return Array.from(byId.values());
}

function deleteAccountTransactions(accountId, userId) {
  const transactions = transactionsForAccountDelete(accountId, userId);
  for (const transaction of transactions) {
    updateStoredBalance(transaction.account_id, userId, -transactionDelta(transaction));
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(transaction.id, userId);
  }
  return transactions.length;
}

function moveAccountTransactionsToCash(accountId, userId) {
  const cashAccount = getOrCreateDefaultCashAccount(userId);
  if (!cashAccount) throw Object.assign(new Error('Default cash account is unavailable'), { statusCode: 500 });
  if (cashAccount.id === accountId) throw Object.assign(new Error('The default cash account cannot be attached to itself'), { statusCode: 400 });

  const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
  const movedDelta = direct.reduce((sum, transaction) => sum + transactionDelta(transaction), 0);
  const updatedAt = nowIso();

  db.prepare('UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ?')
    .run(cashAccount.id, updatedAt, accountId, userId);
  db.prepare('UPDATE transactions SET from_account_id = ?, updated_at = ? WHERE from_account_id = ? AND user_id = ?')
    .run(cashAccount.id, updatedAt, accountId, userId);
  db.prepare('UPDATE transactions SET to_account_id = ?, updated_at = ? WHERE to_account_id = ? AND user_id = ?')
    .run(cashAccount.id, updatedAt, accountId, userId);

  updateStoredBalance(accountId, userId, -movedDelta);
  updateStoredBalance(cashAccount.id, userId, movedDelta);

  return { moved: direct.length, cashAccountId: cashAccount.id };
}

function cleanQueryValue(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setSetting(req, key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(key, JSON.stringify(value), nowIso(), req.user.id);
}

const defaultRuntimeSettings = {
  max_accounts_per_user: 25,
  default_currency: 'USD',
  date_format: 'MMM d, yyyy',
  lockout_attempts: Number(process.env.LOGIN_LOCK_ATTEMPTS) || 5,
  lockout_minutes: Number(process.env.LOGIN_LOCK_MINUTES) || 15,
  password_requires_special: true,
  password_min_length: 8,
  password_reset_url: process.env.PASSWORD_RESET_URL || '',
  webhook_timeout_ms: 5000,
  audit_retention_months: 24,
};

function publicSystemConfig() {
  return {
    node_env: process.env.NODE_ENV || 'development',
    db_path: dbPath,
    jwt_issuer: process.env.JWT_ISSUER || null,
    jwt_audience: process.env.JWT_AUDIENCE || null,
    access_token_ttl: '15m',
    writable_settings: getSetting('runtime', defaultRuntimeSettings),
  };
}

function getDashboardStats(req, res, next) {
  try {
    const userCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive,
        COUNT(*) AS total
      FROM users
    `).get();
    const transactionTotals = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS sum FROM transactions').get();
    const totalAccounts = db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count;
    const deletedUsersCount = db.prepare('SELECT COUNT(*) AS count FROM deleted_users').get().count;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const newUsersThisMonth = db.prepare('SELECT COUNT(*) AS count FROM users WHERE created_at >= ?').get(monthStart).count;
    const newTransactionsThisMonth = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE created_at >= ?').get(monthStart).count;
    const topCategories = db.prepare(`
      SELECT c.id AS category_id, COALESCE(c.name, 'Uncategorized') AS category_name, COALESCE(SUM(t.amount), 0) AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.type = 'expense'
      GROUP BY c.id, c.name
      ORDER BY total DESC
      LIMIT 5
    `).all();
    const securitySummary = db.prepare(`
      SELECT
        SUM(CASE WHEN action = 'SECURITY_ATTACK_ATTEMPT' THEN 1 ELSE 0 END) AS attack_attempts,
        SUM(CASE WHEN action IN ('SECURITY_AUTH_FAILURE', 'SECURITY_ACCOUNT_LOCKED') THEN 1 ELSE 0 END) AS auth_failures,
        COUNT(*) AS total_security_events
      FROM audit_logs
      WHERE action LIKE 'SECURITY_%'
    `).get();
    const recentSecurityEvents = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.ip_address, al.user_agent,
             al.created_at, u.email AS user_email, u.full_name AS user_full_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.action LIKE 'SECURITY_%'
      ORDER BY al.created_at DESC
      LIMIT 5
    `).all();

    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    const rows = db.prepare(`
      SELECT substr(date, 1, 10) AS date, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE date >= ?
      GROUP BY substr(date, 1, 10)
    `).all(start.toISOString());
    const rowMap = new Map(rows.map((row) => [row.date, row]));
    const dailyVolume = [];
    for (let i = 0; i < 30; i += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = dateOnly(day);
      dailyVolume.push(rowMap.get(key) || { date: key, count: 0, total: 0 });
    }

    const logStats = getLogStats();
    return res.json({
      total_users: {
        active: userCounts.active || 0,
        inactive: userCounts.inactive || 0,
        total: userCounts.total || 0,
      },
      total_transactions: transactionTotals,
      total_accounts: totalAccounts,
      deleted_users_count: deletedUsersCount,
      new_users_this_month: newUsersThisMonth,
      new_transactions_this_month: newTransactionsThisMonth,
      top_5_categories_by_spending: topCategories,
      daily_transaction_volume: dailyVolume,
      system_health: {
        db_size_mb: getDbSizeMb(),
        log_count: logStats.log_count,
        uptime_seconds: Math.floor(process.uptime()),
      },
      security: {
        attack_attempts: securitySummary.attack_attempts || 0,
        auth_failures: securitySummary.auth_failures || 0,
        total_security_events: securitySummary.total_security_events || 0,
        recent_events: recentSecurityEvents,
      },
    });
  } catch (error) {
    return next(error);
  }
}

function getUsers(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];

    if (req.query.role) {
      where.push('u.role = ?');
      params.push(req.query.role);
    }
    if (req.query.is_active !== undefined) {
      where.push('u.is_active = ?');
      params.push(req.query.is_active === 'true' || req.query.is_active === '1' ? 1 : 0);
    }
    if (req.query.search) {
      where.push('(LOWER(u.email) LIKE ? OR LOWER(u.full_name) LIKE ?)');
      const search = `%${req.query.search.toLowerCase()}%`;
      params.push(search, search);
    }
    if (req.query.locked === 'true') {
      where.push('u.locked_until IS NOT NULL AND u.locked_until > ?');
      params.push(nowIso());
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM users u ${whereSql}`).get(...params).count;
    const users = db.prepare(`
      SELECT u.*, 
        (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS account_count,
        (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS transaction_count
      FROM users u
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map(sanitizeUser);

    return res.json({
      data: users,
      pagination: paginationMeta(page, limit, total),
    });
  } catch (error) {
    return next(error);
  }
}

function getUser(req, res, next) {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const summary = {
      account_count: db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(req.params.id).count,
      active_account_count: db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ? AND is_active = 1').get(req.params.id).count,
      total_account_balance: db.prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM accounts WHERE user_id = ? AND is_active = 1').get(req.params.id).total,
      transaction_count: db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(req.params.id).count,
      transaction_total: db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ?').get(req.params.id).total,
      budget_count: db.prepare('SELECT COUNT(*) AS count FROM budgets WHERE user_id = ?').get(req.params.id).count,
      refresh_token_count: db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = ? AND revoked = 0 AND expires_at > ?').get(req.params.id, nowIso()).count,
    };
    const auditLogs = db.prepare(`
      SELECT * FROM audit_logs
      WHERE user_id = ? OR entity_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(req.params.id, req.params.id);

    return res.json({ user: sanitizeUser(user), summary, recent_audit_logs: auditLogs });
  } catch (error) {
    return next(error);
  }
}

function updateUserStatus(req, res, next) {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own status' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isActive = req.body.is_active ? 1 : 0;
    if (!isActive && wouldRemoveLastActiveAdmin(user)) return res.status(409).json({ error: 'At least one active admin must remain' });
    let updated;
    db.transaction(() => {
      db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive, nowIso(), req.params.id);
      if (!isActive) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(req.params.id);
      updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
      audit(req, 'ADMIN_UPDATED_USER_STATUS', 'user', req.params.id, sanitizeUser(user), sanitizeUser(updated));
    })();
    return res.json(sanitizeUser(updated));
  } catch (error) {
    return next(error);
  }
}

function deletedUserSummary(user) {
  const accountStats = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(balance), 0) AS balance FROM accounts WHERE user_id = ?').get(user.id);
  const transactionStats = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ?').get(user.id);
  const budgetStats = db.prepare('SELECT COUNT(*) AS count FROM budgets WHERE user_id = ?').get(user.id);
  return {
    summary: {
      account_count: accountStats.count,
      transaction_count: transactionStats.count,
      budget_count: budgetStats.count,
      total_account_balance: accountStats.balance,
      transaction_total: transactionStats.total,
    },
  };
}

function getDeletedUsers(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];
    if (req.query.search) {
      where.push('(LOWER(email) LIKE ? OR LOWER(full_name) LIKE ? OR LOWER(original_user_id) LIKE ?)');
      const search = `%${req.query.search.toLowerCase()}%`;
      params.push(search, search, search);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM deleted_users ${whereSql}`).get(...params).count;
    const users = db.prepare(`
      SELECT id, original_user_id, email, full_name, role, was_active, created_at, last_login, deleted_at,
             deleted_by, account_count, transaction_count, budget_count, total_account_balance, transaction_total
      FROM deleted_users
      ${whereSql}
      ORDER BY deleted_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return res.json({ data: users, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function getDeletedUser(req, res, next) {
  try {
    const row = db.prepare('SELECT * FROM deleted_users WHERE id = ? OR original_user_id = ?').get(req.params.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Deleted user not found' });
    let details = {};
    try {
      details = row.details_json ? JSON.parse(row.details_json) : {};
    } catch {
      details = {};
    }
    delete row.details_json;
    return res.json({ user: row, details });
  } catch (error) {
    return next(error);
  }
}

function updateUserRole(req, res, next) {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (req.body.role !== 'admin' && wouldRemoveLastActiveAdmin(user)) return res.status(409).json({ error: 'At least one active admin must remain' });

    let updated;
    db.transaction(() => {
      db.prepare('UPDATE users SET role = ?, security_stamp = ?, updated_at = ? WHERE id = ?').run(req.body.role, newSecurityStamp(), nowIso(), req.params.id);
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(req.params.id);
      updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
      audit(req, 'ADMIN_UPDATED_USER_ROLE', 'user', req.params.id, sanitizeUser(user), sanitizeUser(updated));
    })();
    return res.json(sanitizeUser(updated));
  } catch (error) {
    return next(error);
  }
}

async function resetUserPassword(req, res, next) {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const passwordHash = await hashPassword(req.body.temporary_password);
    const updatedAt = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, must_change_password = 1, security_stamp = ?,
            failed_login_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?
      `).run(passwordHash, newSecurityStamp(), updatedAt, req.params.id);
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(req.params.id);
      audit(req, 'ADMIN_RESET_USER_PASSWORD', 'user', req.params.id, { id: user.id, email: user.email }, { must_change_password: true });
    })();

    return res.json({ success: true, must_change_password: true });
  } catch (error) {
    return next(error);
  }
}

function deleteUser(req, res, next) {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (wouldRemoveLastActiveAdmin(user)) return res.status(409).json({ error: 'At least one active admin must remain' });
    const deletedUser = sanitizeUser(user);
    const deletedAt = nowIso();
    const archive = deletedUserSummary(user);
    const archivedId = crypto.randomUUID();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO deleted_users (
          id, original_user_id, email, full_name, role, was_active, created_at, last_login, deleted_at, deleted_by,
          account_count, transaction_count, budget_count, total_account_balance, transaction_total, details_json
        )
        VALUES (
          @id, @original_user_id, @email, @full_name, @role, @was_active, @created_at, @last_login, @deleted_at, @deleted_by,
          @account_count, @transaction_count, @budget_count, @total_account_balance, @transaction_total, @details_json
        )
      `).run({
        id: archivedId,
        original_user_id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        was_active: user.is_active,
        created_at: user.created_at,
        last_login: user.last_login,
        deleted_at: deletedAt,
        deleted_by: req.user.id,
        account_count: archive.summary.account_count,
        transaction_count: archive.summary.transaction_count,
        budget_count: archive.summary.budget_count,
        total_account_balance: archive.summary.total_account_balance,
        transaction_total: archive.summary.transaction_total,
        details_json: JSON.stringify({ summary: archive.summary }),
      });
      db.prepare(`
        DELETE FROM audit_logs
        WHERE user_id = ?
          OR entity_id = ?
          OR old_value LIKE ?
          OR new_value LIKE ?
          OR old_value LIKE ?
          OR new_value LIKE ?
      `).run(
        req.params.id,
        req.params.id,
        `%${user.email}%`,
        `%${user.email}%`,
        `%${user.full_name}%`,
        `%${user.full_name}%`
      );
      db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
      audit(req, 'ADMIN_HARD_DELETED_USER', 'deleted_user', archivedId, { id: deletedUser.id, role: deletedUser.role }, {
        deleted: true,
        deleted_user_id: req.params.id,
        archive_id: archivedId,
        hard_deleted: true,
      });
    })();

    return res.json({ success: true, deleted: true, hard_deleted: true, archive_id: archivedId });
  } catch (error) {
    return next(error);
  }
}

function getAuditLogs(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req, 50);
    const where = [];
    const params = [];

    if (req.query.user_id) {
      where.push('al.user_id = ?');
      params.push(req.query.user_id);
    }
    if (req.query.action) {
      where.push('al.action = ?');
      params.push(req.query.action);
    }
    if (req.query.start_date) {
      where.push('al.created_at >= ?');
      params.push(rangeStartIso(req.query.start_date));
    }
    if (req.query.end_date) {
      where.push('al.created_at <= ?');
      params.push(rangeEndIso(req.query.end_date));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs al ${whereSql}`).get(...params).count;
    const logs = db.prepare(`
      SELECT al.*, u.email AS user_email, u.full_name AS user_full_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${whereSql}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return res.json({ data: logs, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function getUserTransactions(req, res, next) {
  try {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { page, limit, offset } = pagination(req);
    const where = ['t.user_id = ?'];
    const params = [req.params.id];

    for (const [key, column] of [['account_id', 't.account_id'], ['category_id', 't.category_id'], ['type', 't.type']]) {
      if (req.query[key]) {
        where.push(`${column} = ?`);
        params.push(req.query[key]);
      }
    }
    if (req.query.start_date) {
      where.push('t.date >= ?');
      params.push(rangeStartIso(req.query.start_date));
    }
    if (req.query.end_date) {
      where.push('t.date <= ?');
      params.push(rangeEndIso(req.query.end_date));
    }
    if (req.query.search) {
      where.push('LOWER(t.description) LIKE ?');
      params.push(`%${req.query.search.toLowerCase()}%`);
    }

    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${whereSql}`).get(...params).count;
    const transactions = db.prepare(`
      SELECT t.*, c.name AS category_name, a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
      WHERE ${whereSql}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    audit(req, 'ADMIN_VIEWED_USER_DATA', 'user', req.params.id, null, {
      data_type: 'transactions',
      filters: req.query,
      result_count: transactions.length,
    });

    return res.json({ data: transactions, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function getUserSpendingByCategory(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const params = [req.params.id];
    const where = ['t.user_id = ?', "t.type = 'expense'", ...userDateFilters(req, 't.date', params)];
    const rows = db.prepare(`
      SELECT c.id AS category_id,
             COALESCE(c.name, 'Uncategorized') AS category_name,
             COALESCE(c.color, '#64748B') AS category_color,
             COUNT(t.id) AS transaction_count,
             COALESCE(SUM(t.amount), 0) AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY c.id, c.name, c.color
      ORDER BY total DESC
    `).all(...params);
    const total = rows.reduce((sum, row) => sum + Number(row.total), 0);

    return res.json({
      data: rows.map((row) => ({ ...row, percent: total > 0 ? (Number(row.total) / total) * 100 : 0 })),
      total,
    });
  } catch (error) {
    return next(error);
  }
}

function getUserLoginHistory(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { page, limit, offset } = pagination(req, 20);
    const params = [req.params.id];
    const where = ["al.user_id = ?", "al.action IN ('USER_LOGIN', 'USER_LOGOUT', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGED')", ...userDateFilters(req, 'al.created_at', params)];
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs al WHERE ${whereSql}`).get(...params).count;
    const logs = db.prepare(`
      SELECT al.*
      FROM audit_logs al
      WHERE ${whereSql}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return res.json({ data: logs, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function getUserBudgetPerformance(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rows = db.prepare(`
      SELECT b.*, c.name AS category_name, c.color AS category_color,
        COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = b.user_id AND t.category_id = b.category_id
          AND t.type = 'expense' AND datetime(t.date) >= datetime(b.start_date)
          AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date, '+1 day', '-1 second'))), 0) AS current_spending
      FROM budgets b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `).all(req.params.id);

    return res.json({
      data: rows.map((budget) => {
        const current = Number(budget.current_spending || 0);
        const amount = Number(budget.amount || 0);
        return {
          ...budget,
          remaining: amount - current,
          percent_used: amount > 0 ? (current / amount) * 100 : 0,
          status: amount > 0 && current > amount ? 'over' : 'within',
        };
      }),
    });
  } catch (error) {
    return next(error);
  }
}

function exportUserData(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const limit = exportLimit(req);
    const cursor = decodeExportCursor(req.query.cursor);
    const asOf = cursor.as_of || nowIso();

    audit(req, 'ADMIN_EXPORTED_USER_DATA', 'user', req.params.id, null, {
      export_started: true,
      limit,
      cursor: { ...cursor, as_of: asOf },
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="user-${req.params.id}-export.json"`);

    res.write('{');
    writeJsonValue(res, 'exported_at', nowIso(), '');
    writeJsonValue(res, 'exported_by', req.user.id);
    writeJsonValue(res, 'export_as_of', asOf);
    writeJsonValue(res, 'export_limit', limit);
    writeJsonValue(res, 'cursor', { ...cursor, as_of: asOf });
    writeJsonValue(res, 'user', sanitizeUser(user));

    const accountsPage = streamJsonArray(
      res,
      'accounts',
      db.prepare('SELECT * FROM accounts WHERE user_id = ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'),
      [req.params.id, asOf],
      limit,
      cursor.accounts
    );
    const transactionsPage = streamJsonArray(
      res,
      'transactions',
      db.prepare(`
        SELECT t.*, c.name AS category_name, a.name AS account_name
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
        WHERE t.user_id = ? AND t.created_at <= ?
        ORDER BY t.date DESC, t.created_at DESC, t.id DESC
        LIMIT ? OFFSET ?
      `),
      [req.params.id, asOf],
      limit,
      cursor.transactions
    );
    const budgetsPage = streamJsonArray(
      res,
      'budgets',
      db.prepare('SELECT * FROM budgets WHERE user_id = ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'),
      [req.params.id, asOf],
      limit,
      cursor.budgets
    );
    const auditLogsPage = streamJsonArray(
      res,
      'audit_logs',
      db.prepare('SELECT * FROM audit_logs WHERE (user_id = ? OR entity_id = ?) AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'),
      [req.params.id, req.params.id, asOf],
      limit,
      cursor.audit_logs
    );

    const nextOffsets = {
      accounts: cursor.accounts + accountsPage.count,
      transactions: cursor.transactions + transactionsPage.count,
      budgets: cursor.budgets + budgetsPage.count,
      audit_logs: cursor.audit_logs + auditLogsPage.count,
      as_of: asOf,
    };
    const nextCursor = accountsPage.hasMore || transactionsPage.hasMore || budgetsPage.hasMore || auditLogsPage.hasMore
      ? encodeExportCursor(nextOffsets)
      : null;
    writeJsonValue(res, 'next_cursor', nextCursor);
    res.end('}');
    return undefined;
  } catch (error) {
    return next(error);
  }
}

function getSystemHealth(req, res, next) {
  try {
    const logStats = getLogStats();
    const activeSessions = db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE revoked = 0 AND expires_at > ?').get(nowIso()).count;
    const heapStats = v8.getHeapStatistics();

    return res.json({
      db_size_mb: getDbSizeMb(),
      log_count: logStats.log_count,
      log_size_mb: logStats.log_size_mb,
      active_sessions: activeSessions,
      uptime_seconds: Math.floor(process.uptime()),
      heap_used_mb: mb1(process.memoryUsage().heapUsed),
      heap_limit_mb: mb1(heapStats.heap_size_limit),
    });
  } catch (error) {
    return next(error);
  }
}

function getAllTransactions(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req, 50);
    const where = [];
    const params = [];
    const filters = [
      ['user_id', 't.user_id'],
      ['account_id', 't.account_id'],
      ['category_id', 't.category_id'],
      ['type', 't.type'],
    ];
    for (const [key, column] of filters) {
      const value = cleanQueryValue(req.query[key]);
      if (value) {
        where.push(`${column} = ?`);
        params.push(value);
      }
    }
    if (req.query.include_deleted !== 'true') where.push('t.admin_deleted_at IS NULL');
    if (req.query.start_date) { where.push('t.date >= ?'); params.push(rangeStartIso(req.query.start_date)); }
    if (req.query.end_date) { where.push('t.date <= ?'); params.push(rangeEndIso(req.query.end_date)); }
    if (req.query.min_amount) { where.push('t.amount >= ?'); params.push(Number(req.query.min_amount)); }
    if (req.query.max_amount) { where.push('t.amount <= ?'); params.push(Number(req.query.max_amount)); }
    if (req.query.search) {
      const search = `%${String(req.query.search).toLowerCase()}%`;
      where.push('(LOWER(COALESCE(t.description, \'\')) LIKE ? OR LOWER(COALESCE(t.note, \'\')) LIKE ? OR LOWER(COALESCE(u.email, \'\')) LIKE ? OR LOWER(COALESCE(u.full_name, \'\')) LIKE ?)');
      params.push(search, search, search, search);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t LEFT JOIN users u ON u.id = t.user_id ${whereSql}`).get(...params).count;
    const transactions = db.prepare(`
      SELECT t.*, c.name AS category_name, a.name AS account_name, u.email AS user_email, u.full_name AS user_full_name
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      ${whereSql}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    audit(req, 'ADMIN_VIEWED_GLOBAL_TRANSACTIONS', 'transaction', null, null, { filters: req.query, result_count: transactions.length });
    return res.json({ data: transactions, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function getAdminTransaction(req, res, next) {
  try {
    const transaction = db.prepare(`
      SELECT t.*, c.name AS category_name, a.name AS account_name, u.email AS user_email, u.full_name AS user_full_name
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ?
    `).get(req.params.id);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    audit(req, 'ADMIN_VIEWED_TRANSACTION_DETAIL', 'transaction', req.params.id, null, { user_id: transaction.user_id });
    return res.json(transaction);
  } catch (error) {
    return next(error);
  }
}

function adminSoftDeleteTransaction(req, res, next) {
  try {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND admin_deleted_at IS NULL').get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'A deletion reason of at least 5 characters is required' });
    let related = [tx];
    if (tx.type === 'transfer' && tx.transfer_group_id) {
      related = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND transfer_group_id = ? AND admin_deleted_at IS NULL').all(tx.user_id, tx.transfer_group_id);
    }
    const deletedAt = nowIso();
    db.transaction(() => {
      for (const item of related) {
        updateStoredBalance(item.account_id, item.user_id, -transactionDelta(item));
        db.prepare(`
          UPDATE transactions
          SET admin_deleted_at = ?, admin_deleted_by = ?, admin_delete_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(deletedAt, req.user.id, reason, deletedAt, item.id);
      }
      audit(req, 'ADMIN_SOFT_DELETED_TRANSACTION', 'transaction', req.params.id, related, { reason, deleted_at: deletedAt, related_count: related.length });
    })();
    return res.json({ success: true, deleted: related.length, reason });
  } catch (error) {
    return next(error);
  }
}

function getUserAccounts(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const accounts = db.prepare(`
      SELECT a.*,
        COALESCE((SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id AND t.admin_deleted_at IS NULL), 0) AS transaction_count
      FROM accounts a
      WHERE a.user_id = ?
      ORDER BY a.is_active DESC, a.created_at DESC
    `).all(req.params.id);
    audit(req, 'ADMIN_VIEWED_USER_DATA', 'user', req.params.id, null, { data_type: 'accounts', result_count: accounts.length });
    return res.json({ data: accounts });
  } catch (error) {
    return next(error);
  }
}

function updateUserAccountStatus(req, res, next) {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.accountId, req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const isActive = req.body.is_active ? 1 : 0;
    const updatedAt = nowIso();
    db.transaction(() => {
      db.prepare('UPDATE accounts SET is_active = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(isActive, updatedAt, req.params.accountId, req.params.id);
      audit(req, 'ADMIN_UPDATED_USER_ACCOUNT_STATUS', 'account', req.params.accountId, account, { ...account, is_active: isActive, reason: req.body.reason || null });
    })();
    return res.json(db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.accountId, req.params.id));
  } catch (error) {
    return next(error);
  }
}

function deleteUserAccount(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.accountId, req.params.id);
    if (!account) return res.status(404).json({ error: 'Active account not found' });

    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'A deletion reason of at least 5 characters is required' });

    const transactionAction = req.body.transaction_action || 'cash';
    if (!['cash', 'delete'].includes(transactionAction)) {
      return res.status(400).json({ error: 'transaction_action must be cash or delete' });
    }

    const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.accountId, req.params.id).count;
    let transactionResult = { action: 'none', deleted: 0, moved: 0, cash_account_id: null };
    const deletedAt = nowIso();

    db.transaction(() => {
      if (transactionCount > 0 && transactionAction === 'delete') {
        transactionResult = { action: 'delete', deleted: deleteAccountTransactions(req.params.accountId, req.params.id), moved: 0, cash_account_id: null };
      } else if (transactionCount > 0) {
        const result = moveAccountTransactionsToCash(req.params.accountId, req.params.id);
        transactionResult = { action: 'cash', deleted: 0, moved: result.moved, cash_account_id: result.cashAccountId };
      }

      db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(deletedAt, req.params.accountId, req.params.id);
      audit(req, 'ADMIN_DELETED_USER_ACCOUNT', 'account', req.params.accountId, account, {
        ...account,
        is_active: 0,
        deleted_at: deletedAt,
        target_user_id: req.params.id,
        target_user_email: user.email,
        reason,
        transaction_result: transactionResult,
      });
    })();

    return res.json({ success: true, account_id: req.params.accountId, reason, transactions: transactionResult });
  } catch (error) {
    return next(error);
  }
}

function createAccountBalanceCorrection(req, res, next) {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.accountId, req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const targetBalance = Number(req.body.target_balance);
    if (!Number.isFinite(targetBalance)) return res.status(400).json({ error: 'target_balance must be a number' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'A correction reason of at least 5 characters is required' });
    const delta = targetBalance - Number(account.balance || 0);
    if (Math.abs(delta) < 0.01) return res.status(400).json({ error: 'Account balance already matches target_balance' });
    const now = nowIso();
    const correction = {
      id: crypto.randomUUID(),
      user_id: req.params.id,
      account_id: account.id,
      category_id: null,
      type: delta >= 0 ? 'income' : 'expense',
      amount: Math.abs(delta),
      description: 'Admin balance correction',
      note: reason,
      date: now,
      recurring: 0,
      recurring_interval: null,
      receipt_path: null,
      tags: JSON.stringify(['admin-correction']),
      transfer_group_id: null,
      transfer_direction: null,
      to_account_id: null,
      from_account_id: null,
      created_at: now,
      updated_at: null,
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO transactions (
          id, user_id, account_id, category_id, type, amount, description, note, date,
          recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction,
          to_account_id, from_account_id, created_at, updated_at
        )
        VALUES (
          @id, @user_id, @account_id, @category_id, @type, @amount, @description, @note, @date,
          @recurring, @recurring_interval, @receipt_path, @tags, @transfer_group_id, @transfer_direction,
          @to_account_id, @from_account_id, @created_at, @updated_at
        )
      `).run(correction);
      updateStoredBalance(account.id, req.params.id, delta);
      audit(req, 'ADMIN_CREATED_BALANCE_CORRECTION', 'account', account.id, { balance: account.balance }, { target_balance: targetBalance, delta, reason, transaction_id: correction.id });
    })();
    return res.status(201).json({ transaction: correction, account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id) });
  } catch (error) {
    return next(error);
  }
}

function listDefaultCategories(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id IS NULL').get().count;
    const rows = db.prepare('SELECT * FROM categories WHERE user_id IS NULL ORDER BY type ASC, sort_order ASC, name ASC LIMIT ? OFFSET ?').all(limit, offset);
    return res.json({ data: rows, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function createDefaultCategory(req, res, next) {
  try {
    const now = nowIso();
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM categories WHERE user_id IS NULL AND type = ?').get(req.body.type).max_order;
    const category = {
      id: crypto.randomUUID(),
      user_id: null,
      name: String(req.body.name).trim(),
      icon: req.body.icon || null,
      color: req.body.color || null,
      type: req.body.type,
      is_default: req.body.is_default === false ? 0 : 1,
      is_system: req.body.is_system ? 1 : 0,
      is_active: 1,
      sort_order: Number(req.body.sort_order || maxOrder + 10),
      created_at: now,
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO categories (id, user_id, name, icon, color, type, is_default, is_system, is_active, sort_order, created_at)
        VALUES (@id, @user_id, @name, @icon, @color, @type, @is_default, @is_system, @is_active, @sort_order, @created_at)
      `).run(category);
      audit(req, 'ADMIN_CREATED_DEFAULT_CATEGORY', 'category', category.id, null, category);
    })();
    return res.status(201).json(category);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Default category already exists' });
    return next(error);
  }
}

function updateDefaultCategory(req, res, next) {
  try {
    const oldCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id IS NULL').get(req.params.id);
    if (!oldCategory) return res.status(404).json({ error: 'Default category not found' });
    const allowed = ['name', 'icon', 'color', 'type', 'is_default', 'is_system', 'is_active', 'sort_order'];
    const updates = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = ['is_default', 'is_system', 'is_active'].includes(field) ? (req.body[field] ? 1 : 0) : req.body[field];
      }
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    db.transaction(() => {
      db.prepare(`UPDATE categories SET ${setSql} WHERE id = @id AND user_id IS NULL`).run({ ...updates, id: req.params.id });
      const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
      audit(req, 'ADMIN_UPDATED_DEFAULT_CATEGORY', 'category', req.params.id, oldCategory, updated);
    })();
    return res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Default category already exists' });
    return next(error);
  }
}

function deleteDefaultCategory(req, res, next) {
  try {
    const oldCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id IS NULL').get(req.params.id);
    if (!oldCategory) return res.status(404).json({ error: 'Default category not found' });
    const deletedAt = nowIso();
    let clearedTransactionRefs = 0;
    let clearedBudgetRefs = 0;
    db.transaction(() => {
      clearedTransactionRefs = db.prepare('UPDATE transactions SET category_id = NULL, updated_at = ? WHERE category_id = ?')
        .run(deletedAt, req.params.id).changes;
      clearedBudgetRefs = db.prepare('UPDATE budgets SET category_id = NULL, updated_at = ? WHERE category_id = ?')
        .run(deletedAt, req.params.id).changes;
      db.prepare('DELETE FROM categories WHERE id = ? AND user_id IS NULL').run(req.params.id);
      audit(req, 'ADMIN_DELETED_DEFAULT_CATEGORY', 'category', req.params.id, oldCategory, {
        deleted: true,
        transaction_category_refs_cleared: clearedTransactionRefs,
        budget_category_refs_cleared: clearedBudgetRefs,
      });
    })();
    return res.json({
      success: true,
      id: req.params.id,
      deleted: true,
      transaction_category_refs_cleared: clearedTransactionRefs,
      budget_category_refs_cleared: clearedBudgetRefs,
    });
  } catch (error) {
    return next(error);
  }
}

function pushDefaultCategories(req, res, next) {
  try {
    const categories = db.prepare('SELECT * FROM categories WHERE user_id IS NULL AND is_active = 1 AND is_default = 1').all();
    const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all();
    let inserted = 0;
    let skipped = 0;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO categories (id, user_id, name, icon, color, type, is_default, is_system, is_active, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
    `);
    const existingVisible = db.prepare(`
      SELECT id
      FROM categories
      WHERE (user_id IS NULL OR user_id = ?)
        AND is_active = 1
        AND name = ? COLLATE NOCASE
        AND type = ?
      LIMIT 1
    `);
    const now = nowIso();
    db.transaction(() => {
      for (const user of users) {
        for (const category of categories) {
          if (existingVisible.get(user.id, category.name, category.type)) {
            skipped += 1;
            continue;
          }
          const result = insert.run(crypto.randomUUID(), user.id, category.name, category.icon, category.color, category.type, category.sort_order, now);
          inserted += result.changes;
        }
      }
      audit(req, 'ADMIN_PUSHED_DEFAULT_CATEGORIES', 'category', null, null, { users: users.length, categories: categories.length, inserted, skipped });
    })();
    return res.json({ success: true, users: users.length, categories: categories.length, inserted, skipped });
  } catch (error) {
    return next(error);
  }
}

function bulkUpdateUsers(req, res, next) {
  try {
    const ids = Array.from(new Set(req.body.user_ids || [])).filter((id) => id !== req.user.id);
    if (!ids.length) return res.status(400).json({ error: 'user_ids must include at least one user other than yourself' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'A reason of at least 5 characters is required' });
    const action = req.body.action;
    if (!['activate', 'deactivate', 'force_password_reset'].includes(action)) {
      return res.status(400).json({ error: 'action must be activate, deactivate, or force_password_reset' });
    }
    const placeholders = ids.map(() => '?').join(', ');
    const users = db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).all(...ids);
    const now = nowIso();
    db.transaction(() => {
      if (action === 'activate' || action === 'deactivate') {
        const active = action === 'activate' ? 1 : 0;
        db.prepare(`UPDATE users SET is_active = ?, updated_at = ? WHERE id IN (${placeholders})`).run(active, now, ...ids);
        if (!active) db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id IN (${placeholders})`).run(...ids);
      } else if (action === 'force_password_reset') {
        db.prepare(`UPDATE users SET must_change_password = 1, security_stamp = lower(hex(randomblob(32))), updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
        db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id IN (${placeholders})`).run(...ids);
      }
      audit(req, 'ADMIN_BULK_USER_OPERATION', 'user', null, users.map(sanitizeUser), { action, reason, count: users.length });
    })();
    return res.json({ success: true, action, affected: users.length });
  } catch (error) {
    return next(error);
  }
}

function revokeUserSessions(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    let result;
    db.transaction(() => {
      db.prepare('UPDATE users SET security_stamp = ?, updated_at = ? WHERE id = ?').run(newSecurityStamp(), nowIso(), req.params.id);
      result = db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(req.params.id);
      audit(req, 'ADMIN_REVOKED_USER_SESSIONS', 'user', req.params.id, null, { revoked: result.changes, access_tokens_invalidated: true });
    })();
    return res.json({ success: true, revoked: result.changes });
  } catch (error) {
    return next(error);
  }
}

function getAuditRetention(req, res, next) {
  try {
    const oldest = db.prepare('SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest, COUNT(*) AS count FROM audit_logs').get();
    return res.json({
      ...oldest,
      log_size_mb: getLogStats().log_size_mb,
      retention_months: getSetting('runtime', defaultRuntimeSettings).audit_retention_months,
    });
  } catch (error) {
    return next(error);
  }
}

function purgeAuditLogs(req, res, next) {
  try {
    const before = new Date(req.body.before).toISOString();
    const count = db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE created_at < ?').get(before).count;
    db.transaction(() => {
      db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(before);
      audit(req, 'ADMIN_PURGED_AUDIT_LOGS', 'audit_log', null, { before, count }, { purged: count, backup_reminder: true });
    })();
    return res.json({ success: true, purged: count, before });
  } catch (error) {
    return next(error);
  }
}

function getSystemConfig(req, res, next) {
  try {
    return res.json(publicSystemConfig());
  } catch (error) {
    return next(error);
  }
}

function updateSystemConfig(req, res, next) {
  try {
    const current = getSetting('runtime', defaultRuntimeSettings);
    const allowed = Object.keys(defaultRuntimeSettings);
    const nextSettings = { ...current };
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) nextSettings[key] = req.body[key];
    }
    db.transaction(() => {
      setSetting(req, 'runtime', nextSettings);
      audit(req, 'ADMIN_UPDATED_SYSTEM_CONFIG', 'system_config', 'runtime', current, nextSettings);
    })();
    return res.json({ ...publicSystemConfig(), writable_settings: nextSettings });
  } catch (error) {
    return next(error);
  }
}

function runIntegrityCheck(req, res, next) {
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    audit(req, 'ADMIN_RAN_DB_INTEGRITY_CHECK', 'database', 'main', null, { rows });
    return res.json({ ok: rows.length === 1 && Object.values(rows[0])[0] === 'ok', results: rows });
  } catch (error) {
    return next(error);
  }
}

function vacuumDatabase(req, res, next) {
  try {
    const before = getDbSizeMb();
    db.exec('VACUUM');
    const after = getDbSizeMb();
    audit(req, 'ADMIN_VACUUMED_DATABASE', 'database', 'main', { db_size_mb: before }, { db_size_mb: after });
    return res.json({ success: true, before_mb: before, after_mb: after });
  } catch (error) {
    return next(error);
  }
}

function downloadDatabaseBackup(req, res, next) {
  try {
    audit(req, 'ADMIN_DOWNLOADED_DATABASE_BACKUP', 'database', 'main', null, { db_size_mb: getDbSizeMb() });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="financeapp-${Date.now()}.sqlite.gz"`);
    return fs.createReadStream(dbPath).pipe(zlib.createGzip()).pipe(res);
  } catch (error) {
    return next(error);
  }
}

function getReports(req, res, next) {
  try {
    const monthly = db.prepare(`
      SELECT substr(date, 1, 7) AS month,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense,
        COUNT(*) AS count
      FROM transactions
      WHERE admin_deleted_at IS NULL
      GROUP BY substr(date, 1, 7)
      ORDER BY month DESC
      LIMIT 36
    `).all().map((row) => ({ ...row, net: Number(row.income || 0) - Number(row.expense || 0) }));
    const cohorts = db.prepare(`
      SELECT substr(created_at, 1, 7) AS month,
        COUNT(*) AS signups,
        SUM(CASE WHEN last_login IS NOT NULL THEN 1 ELSE 0 END) AS ever_logged_in
      FROM users
      GROUP BY substr(created_at, 1, 7)
      ORDER BY month DESC
      LIMIT 36
    `).all();
    const categories = db.prepare(`
      SELECT COALESCE(c.name, 'Uncategorized') AS category_name, t.type, COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.admin_deleted_at IS NULL AND t.type != 'transfer'
      GROUP BY c.name, t.type
      ORDER BY total DESC
      LIMIT 100
    `).all();
    audit(req, 'ADMIN_VIEWED_ADVANCED_REPORTS', 'report', null, null, { monthly: monthly.length, cohorts: cohorts.length, categories: categories.length });
    return res.json({ monthly_financials: monthly, cohorts, categories });
  } catch (error) {
    return next(error);
  }
}

function exportReportCsv(req, res, next) {
  try {
    const type = req.query.type || 'monthly';
    const dataReq = { ...req, query: {} };
    const rows = type === 'categories'
      ? db.prepare(`
        SELECT COALESCE(c.name, 'Uncategorized') AS category_name, t.type, COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total
        FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.admin_deleted_at IS NULL AND t.type != 'transfer'
        GROUP BY c.name, t.type ORDER BY total DESC
      `).all()
      : db.prepare(`
        SELECT substr(date, 1, 7) AS month,
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense,
          COUNT(*) AS count
        FROM transactions WHERE admin_deleted_at IS NULL GROUP BY substr(date, 1, 7) ORDER BY month DESC
      `).all();
    void dataReq;
    const headers = Object.keys(rows[0] || { empty: '' });
    const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? '')).join(','))].join('\n');
    audit(req, 'ADMIN_EXPORTED_REPORT_CSV', 'report', String(type), null, { rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
    return res.send(csv);
  } catch (error) {
    return next(error);
  }
}

function listAnnouncements(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM announcements').get().count;
    const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    return res.json({ data: rows, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function createAnnouncement(req, res, next) {
  try {
    const row = {
      id: crypto.randomUUID(),
      title: req.body.title,
      body: req.body.body,
      is_active: req.body.is_active === false ? 0 : 1,
      starts_at: req.body.starts_at || null,
      ends_at: req.body.ends_at || null,
      created_at: nowIso(),
      updated_at: null,
      created_by: req.user.id,
    };
    db.prepare(`
      INSERT INTO announcements (id, title, body, is_active, starts_at, ends_at, created_at, updated_at, created_by)
      VALUES (@id, @title, @body, @is_active, @starts_at, @ends_at, @created_at, @updated_at, @created_by)
    `).run(row);
    audit(req, 'ADMIN_CREATED_ANNOUNCEMENT', 'announcement', row.id, null, row);
    const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all();
    users.forEach((user) => {
      void sendPushNotification(user.id, row.title, row.body, { type: 'admin_announcement', announcementId: row.id })
        .catch((pushError) => logger.warn('Announcement push failed', { userId: user.id, error: pushError.message }));
    });
    return res.status(201).json(row);
  } catch (error) {
    return next(error);
  }
}

function updateAnnouncement(req, res, next) {
  try {
    const old = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Announcement not found' });
    const updates = {};
    for (const field of ['title', 'body', 'starts_at', 'ends_at', 'is_active']) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = field === 'is_active' ? (req.body[field] ? 1 : 0) : req.body[field];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    db.prepare(`UPDATE announcements SET ${setSql} WHERE id = @id`).run({ ...updates, id: req.params.id });
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
    audit(req, 'ADMIN_UPDATED_ANNOUNCEMENT', 'announcement', req.params.id, old, row);
    return res.json(row);
  } catch (error) {
    return next(error);
  }
}

function deleteAnnouncement(req, res, next) {
  try {
    const old = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Announcement not found' });
    let dismissedCount = 0;
    db.transaction(() => {
      dismissedCount = db.prepare('DELETE FROM announcement_dismissals WHERE announcement_id = ?').run(req.params.id).changes;
      db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
      audit(req, 'ADMIN_DELETED_ANNOUNCEMENT', 'announcement', req.params.id, old, { deleted: true, dismissals_deleted: dismissedCount });
    })();
    return res.json({ success: true, id: req.params.id, deleted: true, dismissals_deleted: dismissedCount });
  } catch (error) {
    return next(error);
  }
}

function listApiTokens(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM admin_api_tokens').get().count;
    const rows = db.prepare('SELECT id, name, scopes, is_active, last_used_at, created_at, revoked_at, created_by FROM admin_api_tokens ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    return res.json({ data: rows.map((row) => ({ ...row, scopes: JSON.parse(row.scopes || '[]') })), pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function createApiToken(req, res, next) {
  try {
    const rawToken = `fa_${crypto.randomBytes(32).toString('hex')}`;
    const row = {
      id: crypto.randomUUID(),
      name: req.body.name,
      token_hash: hashToken(rawToken),
      scopes: JSON.stringify(req.body.scopes || ['read:users']),
      is_active: 1,
      created_at: nowIso(),
      created_by: req.user.id,
    };
    db.prepare(`
      INSERT INTO admin_api_tokens (id, name, token_hash, scopes, is_active, created_at, created_by)
      VALUES (@id, @name, @token_hash, @scopes, @is_active, @created_at, @created_by)
    `).run(row);
    audit(req, 'ADMIN_CREATED_API_TOKEN', 'api_token', row.id, null, { name: row.name, scopes: JSON.parse(row.scopes) });
    return res.status(201).json({ id: row.id, name: row.name, scopes: JSON.parse(row.scopes), token: rawToken });
  } catch (error) {
    return next(error);
  }
}

function getTokenScopes(req, res) {
  return res.json({ scopes: AVAILABLE_TOKEN_SCOPES });
}

function revokeApiToken(req, res, next) {
  try {
    const token = db.prepare('SELECT * FROM admin_api_tokens WHERE id = ?').get(req.params.id);
    if (!token) return res.status(404).json({ error: 'API token not found' });
    db.prepare('UPDATE admin_api_tokens SET is_active = 0, revoked_at = ? WHERE id = ?').run(nowIso(), req.params.id);
    audit(req, 'ADMIN_REVOKED_API_TOKEN', 'api_token', req.params.id, { name: token.name }, { revoked: true });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
}

function listWebhooks(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM webhooks').get().count;
    const rows = db.prepare(`
      SELECT w.*, (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS delivery_count
      FROM webhooks w ORDER BY w.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    return res.json({ data: rows.map((row) => ({ ...row, secret: row.secret ? '[configured]' : null })), pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function createWebhook(req, res, next) {
  try {
    const row = {
      id: crypto.randomUUID(),
      name: req.body.name,
      url: assertSafeWebhookUrl(req.body.url),
      event: req.body.event,
      is_active: req.body.is_active === false ? 0 : 1,
      secret: encryptSecret(req.body.secret || crypto.randomBytes(16).toString('hex')),
      created_at: nowIso(),
      updated_at: null,
      created_by: req.user.id,
    };
    db.prepare(`
      INSERT INTO webhooks (id, name, url, event, is_active, secret, created_at, updated_at, created_by)
      VALUES (@id, @name, @url, @event, @is_active, @secret, @created_at, @updated_at, @created_by)
    `).run(row);
    audit(req, 'ADMIN_CREATED_WEBHOOK', 'webhook', row.id, null, { ...row, secret: '[redacted]' });
    return res.status(201).json({ ...row, secret: '[configured]' });
  } catch (error) {
    return next(error);
  }
}

function updateWebhook(req, res, next) {
  try {
    const old = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Webhook not found' });
    const updates = {};
    for (const field of ['name', 'url', 'event', 'is_active', 'secret']) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = field === 'is_active' ? (req.body[field] ? 1 : 0) : req.body[field];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });
    if (Object.prototype.hasOwnProperty.call(updates, 'url')) {
      updates.url = assertSafeWebhookUrl(updates.url);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'secret')) {
      updates.secret = updates.secret ? encryptSecret(updates.secret) : null;
    }
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    db.prepare(`UPDATE webhooks SET ${setSql} WHERE id = @id`).run({ ...updates, id: req.params.id });
    const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
    audit(req, 'ADMIN_UPDATED_WEBHOOK', 'webhook', req.params.id, { ...old, secret: '[redacted]' }, { ...row, secret: '[redacted]' });
    return res.json({ ...row, secret: row.secret ? '[configured]' : null });
  } catch (error) {
    return next(error);
  }
}

function listWebhookDeliveries(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM webhook_deliveries WHERE webhook_id = ?').get(req.params.id).count;
    const rows = db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.params.id, limit, offset);
    return res.json({ data: rows, pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function getSecurityBlocks(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const blocks = listSecurityBlocks();
    return res.json({ data: blocks.slice(offset, offset + limit), pagination: paginationMeta(page, limit, blocks.length) });
  } catch (error) {
    return next(error);
  }
}

function blockSecurityAddress(req, res, next) {
  try {
    const durationMs = Math.max(Number(req.body.duration_minutes || 10), 1) * 60 * 1000;
    const block = blockSecurityIp(req.body.ip, durationMs);
    audit(req, 'ADMIN_BLOCKED_SECURITY_IP', 'security_ip', req.body.ip, null, block);
    return res.status(201).json(block);
  } catch (error) {
    return next(error);
  }
}

function clearSecurityAddress(req, res, next) {
  try {
    const cleared = clearSecurityIp(req.params.ip);
    audit(req, 'ADMIN_CLEARED_SECURITY_IP', 'security_ip', req.params.ip, null, { cleared });
    return res.json({ success: true, cleared });
  } catch (error) {
    return next(error);
  }
}

function impersonateUser(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user || !user.is_active) return res.status(404).json({ error: 'Active user not found' });
    const warning = 'Support impersonation is sensitive. All use must be justified and audited.';
    const token = generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      security_stamp: user.security_stamp,
      must_change_password: Boolean(user.must_change_password),
      impersonated_by: req.user.id,
      impersonation_reason: req.body.reason,
    });
    audit(req, 'ADMIN_STARTED_IMPERSONATION', 'user', user.id, null, { reason: req.body.reason, expires_in: '15m' });
    return res.json({ accessToken: token, user: sanitizeUser(user), expires_in: '15m', warning });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getDashboardStats,
  getUsers,
  getUser,
  getDeletedUsers,
  getDeletedUser,
  updateUserStatus,
  updateUserRole,
  resetUserPassword,
  deleteUser,
  getAuditLogs,
  getUserTransactions,
  getUserSpendingByCategory,
  getUserLoginHistory,
  getUserBudgetPerformance,
  exportUserData,
  getSystemHealth,
  getAllTransactions,
  getAdminTransaction,
  adminSoftDeleteTransaction,
  getUserAccounts,
  updateUserAccountStatus,
  deleteUserAccount,
  createAccountBalanceCorrection,
  listDefaultCategories,
  createDefaultCategory,
  updateDefaultCategory,
  deleteDefaultCategory,
  pushDefaultCategories,
  bulkUpdateUsers,
  revokeUserSessions,
  getAuditRetention,
  purgeAuditLogs,
  getSystemConfig,
  updateSystemConfig,
  runIntegrityCheck,
  vacuumDatabase,
  downloadDatabaseBackup,
  getReports,
  exportReportCsv,
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  listApiTokens,
  createApiToken,
  getTokenScopes,
  revokeApiToken,
  listWebhooks,
  createWebhook,
  updateWebhook,
  listWebhookDeliveries,
  getSecurityBlocks,
  blockSecurityAddress,
  clearSecurityAddress,
  impersonateUser,
};
