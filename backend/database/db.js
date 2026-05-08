const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const { encryptSecret, isEncryptedSecret } = require('../src/utils/security');

const backendRoot = path.resolve(__dirname, '..');
const backendEnvPath = path.join(backendRoot, '.env');
const projectEnvPath = path.join(backendRoot, '..', '.env');

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else {
  dotenv.config({ path: projectEnvPath });
}

const resolvedDbPath = process.env.DB_PATH
  ? path.resolve(backendRoot, process.env.DB_PATH)
  : path.resolve(__dirname, 'finance.db');

function normalizePathForBoundaryCheck(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

const normalizedBackendRoot = normalizePathForBoundaryCheck(backendRoot);
const normalizedDbPath = normalizePathForBoundaryCheck(resolvedDbPath);
const safeRoot = normalizedBackendRoot.endsWith(path.sep)
  ? normalizedBackendRoot
  : `${normalizedBackendRoot}${path.sep}`;
const relativeDbPath = path.relative(normalizedBackendRoot, normalizedDbPath);

if (
  normalizedDbPath !== normalizedBackendRoot
  && !normalizedDbPath.startsWith(safeRoot)
  && (relativeDbPath.startsWith('..') || path.isAbsolute(relativeDbPath))
) {
  throw new Error(`DB_PATH "${process.env.DB_PATH}" resolves outside the project directory.`);
}

const dbPath = resolvedDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');

function timestampNow() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function decodeStoredHtmlEntities(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&#x2F;|&#47;/g, '/')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const defaultCashAccount = {
  name: 'Cash',
  type: 'cash',
  balance: 0,
  currency: 'USD',
  color: '#27AE60',
  icon: 'dollar-sign',
};

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#0F3460',
      role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      last_login TEXT,
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      must_change_password INTEGER DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      email_verified_at TEXT,
      currency TEXT DEFAULT 'USD',
      has_completed_onboarding INTEGER DEFAULT 0 CHECK (has_completed_onboarding IN (0, 1)),
      security_stamp TEXT NOT NULL DEFAULT (lower(hex(randomblob(32))))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      type TEXT CHECK (type IN ('income', 'expense')),
      is_default INTEGER DEFAULT 0 CHECK (is_default IN (0, 1)),
      is_system INTEGER DEFAULT 0 CHECK (is_system IN (0, 1)),
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name, type)
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT CHECK (type IN ('checking', 'savings', 'credit', 'investment', 'cash')),
      balance INTEGER DEFAULT 0,
      overdraft_limit INTEGER,
      currency TEXT DEFAULT 'USD',
      color TEXT,
      icon TEXT,
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT,
      category_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
      amount INTEGER NOT NULL CHECK (amount >= 0),
      description TEXT,
      note TEXT,
      date TEXT NOT NULL,
      recurring INTEGER DEFAULT 0 CHECK (recurring IN (0, 1)),
      recurring_interval TEXT CHECK (recurring_interval IS NULL OR recurring_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
      receipt_path TEXT,
      tags TEXT,
      transfer_group_id TEXT,
      transfer_direction TEXT CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination')),
      to_account_id TEXT,
      from_account_id TEXT,
      admin_deleted_at TEXT,
      admin_deleted_by TEXT,
      admin_delete_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (admin_deleted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      category_id TEXT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      description TEXT,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
      next_due_date TEXT NOT NULL,
      last_processed_date TEXT,
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data_json TEXT,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, token),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category_id TEXT,
      amount INTEGER NOT NULL CHECK (amount >= 0),
      period TEXT CHECK (period IN ('monthly', 'weekly', 'yearly')),
      start_date TEXT,
      end_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      user_agent TEXT,
      revoked INTEGER DEFAULT 0 CHECK (revoked IN (0, 1)),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS access_token_blocklist (
      jti TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deleted_users (
      id TEXT PRIMARY KEY,
      original_user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT,
      was_active INTEGER,
      created_at TEXT,
      last_login TEXT,
      deleted_at TEXT NOT NULL,
      deleted_by TEXT,
      account_count INTEGER DEFAULT 0,
      transaction_count INTEGER DEFAULT 0,
      budget_count INTEGER DEFAULT 0,
      total_account_balance INTEGER DEFAULT 0,
      transaction_total INTEGER DEFAULT 0,
      details_json TEXT,
      FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      created_by TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS announcement_dismissals (
      announcement_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      dismissed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (announcement_id, user_id),
      FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      revoked_at TEXT,
      created_by TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      event TEXT NOT NULL,
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      secret TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      created_by TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS security_ip_blocks (
      ip TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      first_seen TEXT NOT NULL,
      blocked_until TEXT,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
    CREATE INDEX IF NOT EXISTS idx_users_security_stamp ON users(security_stamp);
    CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_txn_budget_lookup ON transactions(user_id, category_id, type, admin_deleted_at, date);
    CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON budgets(user_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_category_id ON budgets(category_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_overlap ON budgets(user_id, category_id, start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens(user_id, revoked, expires_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash ON email_verification_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_access_token_blocklist_expires ON access_token_blocklist(expires_at);
    CREATE INDEX IF NOT EXISTS idx_deleted_users_deleted_at ON deleted_users(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user ON announcement_dismissals(user_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
    CREATE INDEX IF NOT EXISTS idx_security_ip_blocks_blocked_until ON security_ip_blocks(blocked_until);
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_due ON recurring_transactions(is_active, next_due_date);
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_user_id ON recurring_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_account_id ON recurring_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_category_id ON recurring_transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
  `);
}

function ensureSchemaUpdates() {
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0 CHECK (must_change_password IN (0, 1))');
  }
  if (!userColumns.includes('security_stamp')) {
    db.exec('ALTER TABLE users ADD COLUMN security_stamp TEXT');
    const users = db.prepare('SELECT id FROM users WHERE security_stamp IS NULL OR security_stamp = \'\'').all();
    const updateStamp = db.prepare('UPDATE users SET security_stamp = ? WHERE id = ?');
    for (const user of users) updateStamp.run(crypto.randomBytes(32).toString('hex'), user.id);
  }
  if (!userColumns.includes('avatar_color')) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT '#0F3460'");
  }
  if (!userColumns.includes('email_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
    db.prepare('UPDATE users SET email_verified_at = COALESCE(created_at, ?) WHERE email_verified_at IS NULL').run(timestampNow());
  }
  if (!userColumns.includes('currency')) {
    db.exec("ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'USD'");
  }
  if (!userColumns.includes('has_completed_onboarding')) {
    db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER DEFAULT 0 CHECK (has_completed_onboarding IN (0, 1))');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash ON email_verification_tokens(token_hash);
  `);

  const accountColumns = db.prepare('PRAGMA table_info(accounts)').all().map((column) => column.name);
  if (!accountColumns.includes('overdraft_limit')) {
    db.exec('ALTER TABLE accounts ADD COLUMN overdraft_limit INTEGER');
  }

  const previouslySoftDeletedUsers = db.prepare(`
    SELECT id, email, full_name
    FROM users
    WHERE email LIKE 'deleted-user-%@deleted.local'
       OR full_name LIKE 'Deleted User %'
  `).all();
  const removeDeletedUserAudit = db.prepare(`
    DELETE FROM audit_logs
    WHERE user_id = @id
      OR entity_id = @id
      OR old_value LIKE @email
      OR new_value LIKE @email
      OR old_value LIKE @full_name
      OR new_value LIKE @full_name
  `);
  const removeDeletedUser = db.prepare('DELETE FROM users WHERE id = ?');
  for (const user of previouslySoftDeletedUsers) {
    removeDeletedUserAudit.run({
      id: user.id,
      email: `%${user.email}%`,
      full_name: `%${user.full_name}%`,
    });
    removeDeletedUser.run(user.id);
  }

  const refreshTokenColumns = db.prepare('PRAGMA table_info(refresh_tokens)').all().map((column) => column.name);
  if (!refreshTokenColumns.includes('family_id')) {
    db.exec('ALTER TABLE refresh_tokens ADD COLUMN family_id TEXT');
    db.prepare('UPDATE refresh_tokens SET family_id = id WHERE family_id IS NULL').run();
  }
  if (!refreshTokenColumns.includes('last_used_at')) {
    db.exec('ALTER TABLE refresh_tokens ADD COLUMN last_used_at TEXT');
  }
  if (!refreshTokenColumns.includes('user_agent')) {
    db.exec('ALTER TABLE refresh_tokens ADD COLUMN user_agent TEXT');
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens(user_id, revoked, expires_at);
  `);

  const categoryColumns = db.prepare('PRAGMA table_info(categories)').all().map((column) => column.name);
  if (!categoryColumns.includes('sort_order')) {
    db.exec('ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0');
  }
  if (!categoryColumns.includes('is_system')) {
    db.exec('ALTER TABLE categories ADD COLUMN is_system INTEGER DEFAULT 0 CHECK (is_system IN (0, 1))');
    db.prepare('UPDATE categories SET is_system = 1 WHERE user_id IS NULL AND is_default = 1').run();
  }
  if (!categoryColumns.includes('is_active')) {
    db.exec('ALTER TABLE categories ADD COLUMN is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1))');
  }

  const transactionColumns = db.prepare('PRAGMA table_info(transactions)').all();
  const accountIdColumn = transactionColumns.find((column) => column.name === 'account_id');
  if (accountIdColumn?.notnull) {
    db.exec(`
      CREATE TABLE transactions_next (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_id TEXT,
        category_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        description TEXT,
        note TEXT,
        date TEXT NOT NULL,
        recurring INTEGER DEFAULT 0 CHECK (recurring IN (0, 1)),
        recurring_interval TEXT CHECK (recurring_interval IS NULL OR recurring_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
        receipt_path TEXT,
        tags TEXT,
        transfer_group_id TEXT,
        transfer_direction TEXT CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination')),
        to_account_id TEXT,
        from_account_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      INSERT INTO transactions_next (
        id, user_id, account_id, category_id, type, amount, description, note, date,
        recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction,
        to_account_id, from_account_id, created_at, updated_at
      )
      SELECT
        id, user_id, account_id, category_id, type, amount, description, note, date,
        recurring, recurring_interval, receipt_path, tags, NULL, NULL, NULL, NULL, created_at, updated_at
      FROM transactions;

      DROP TABLE transactions;
      ALTER TABLE transactions_next RENAME TO transactions;

      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group_id ON transactions(transfer_group_id);
    `);
  }

  const updatedTransactionColumns = db.prepare('PRAGMA table_info(transactions)').all().map((column) => column.name);
  if (!updatedTransactionColumns.includes('transfer_group_id')) {
    db.exec('ALTER TABLE transactions ADD COLUMN transfer_group_id TEXT');
  }
  if (!updatedTransactionColumns.includes('transfer_direction')) {
    db.exec("ALTER TABLE transactions ADD COLUMN transfer_direction TEXT CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination'))");
  }
  if (!updatedTransactionColumns.includes('to_account_id')) {
    db.exec('ALTER TABLE transactions ADD COLUMN to_account_id TEXT');
  }
  if (!updatedTransactionColumns.includes('from_account_id')) {
    db.exec('ALTER TABLE transactions ADD COLUMN from_account_id TEXT');
  }
  if (!updatedTransactionColumns.includes('admin_deleted_at')) {
    db.exec('ALTER TABLE transactions ADD COLUMN admin_deleted_at TEXT');
  }
  if (!updatedTransactionColumns.includes('admin_deleted_by')) {
    db.exec('ALTER TABLE transactions ADD COLUMN admin_deleted_by TEXT');
  }
  if (!updatedTransactionColumns.includes('admin_delete_reason')) {
    db.exec('ALTER TABLE transactions ADD COLUMN admin_delete_reason TEXT');
  }

  const encodedTextRows = db.prepare(`
    SELECT id, description, note
    FROM transactions
    WHERE description LIKE '%&%' OR note LIKE '%&%'
  `).all();
  const updateTransactionText = db.prepare('UPDATE transactions SET description = ?, note = ? WHERE id = ?');
  for (const row of encodedTextRows) {
    const description = decodeStoredHtmlEntities(row.description);
    const note = decodeStoredHtmlEntities(row.note);
    if (description !== row.description || note !== row.note) {
      updateTransactionText.run(description, note, row.id);
    }
  }

  const transferRows = db.prepare(`
    SELECT id, tags
    FROM transactions
    WHERE type = 'transfer'
      AND tags IS NOT NULL
      AND (transfer_group_id IS NULL OR transfer_direction IS NULL OR to_account_id IS NULL OR from_account_id IS NULL)
  `).all();
  const updateTransferMetadata = db.prepare(`
    UPDATE transactions
    SET transfer_group_id = COALESCE(transfer_group_id, @transfer_group_id),
        transfer_direction = COALESCE(transfer_direction, @transfer_direction),
        to_account_id = COALESCE(to_account_id, @to_account_id),
        from_account_id = COALESCE(from_account_id, @from_account_id),
        tags = @tags
    WHERE id = @id
  `);
  for (const row of transferRows) {
    let metadata = {};
    let tags = row.tags;
    try {
      metadata = JSON.parse(row.tags || '{}') || {};
      tags = JSON.stringify(Array.isArray(metadata.values) ? metadata.values : Array.isArray(metadata) ? metadata : []);
    } catch {
      metadata = {};
    }
    updateTransferMetadata.run({
      id: row.id,
      transfer_group_id: metadata.transfer_group_id || null,
      transfer_direction: metadata.transfer_direction || null,
      to_account_id: metadata.to_account_id || null,
      from_account_id: metadata.from_account_id || null,
      tags,
    });
  }
  const duplicateCategories = db.prepare(`
    SELECT user_id, LOWER(name) AS normalized_name, type, GROUP_CONCAT(id) AS ids
    FROM categories
    WHERE user_id IS NOT NULL
    GROUP BY user_id, LOWER(name), type
    HAVING COUNT(*) > 1
  `).all();
  const updateCategoryTransactions = db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?');
  const updateCategoryBudgets = db.prepare('UPDATE budgets SET category_id = ? WHERE category_id = ?');
  const deleteDuplicateCategory = db.prepare('DELETE FROM categories WHERE id = ?');
  for (const group of duplicateCategories) {
    const ids = String(group.ids).split(',');
    const keepId = ids[0];
    for (const duplicateId of ids.slice(1)) {
      updateCategoryTransactions.run(keepId, duplicateId);
      updateCategoryBudgets.run(keepId, duplicateId);
      deleteDuplicateCategory.run(duplicateId);
    }
  }

  const duplicateActiveAccounts = db.prepare(`
    SELECT user_id, type, name
    FROM accounts
    WHERE is_active = 1
    GROUP BY user_id, type, name
    HAVING COUNT(*) > 1
  `).all();
  const deactivateDuplicateAccount = db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?');
  for (const group of duplicateActiveAccounts) {
    const accounts = db.prepare(`
      SELECT id
      FROM accounts
      WHERE user_id = ? AND type = ? AND name = ? AND is_active = 1
      ORDER BY created_at ASC, id ASC
    `).all(group.user_id, group.type, group.name);
    for (const account of accounts.slice(1)) {
      deactivateDuplicateAccount.run(timestampNow(), account.id);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group_id ON transactions(transfer_group_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_transfer_direction ON transactions(transfer_direction);
    CREATE INDEX IF NOT EXISTS idx_transactions_admin_deleted ON transactions(admin_deleted_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_txn_budget_lookup ON transactions(user_id, category_id, type, admin_deleted_at, date);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
    CREATE INDEX IF NOT EXISTS idx_users_security_stamp ON users(security_stamp);
    CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_category_id ON budgets(category_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_overlap ON budgets(user_id, category_id, start_date, end_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_active_user_type_name
      ON accounts(user_id, type, name)
      WHERE is_active = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_type_nocase
      ON categories(user_id, name COLLATE NOCASE, type)
      WHERE user_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS security_ip_blocks (
      ip TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      first_seen TEXT NOT NULL,
      blocked_until TEXT,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_security_ip_blocks_blocked_until ON security_ip_blocks(blocked_until);

    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      category_id TEXT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      description TEXT,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
      next_due_date TEXT NOT NULL,
      last_processed_date TEXT,
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_due ON recurring_transactions(is_active, next_due_date);
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_user_id ON recurring_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_account_id ON recurring_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_category_id ON recurring_transactions(category_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data_json TEXT,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

    CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, token),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  migrateMoneyColumnsToCents();

  const webhookRows = db.prepare('SELECT id, secret FROM webhooks WHERE secret IS NOT NULL AND secret != \'\'').all();
  const updateWebhookSecret = db.prepare('UPDATE webhooks SET secret = ?, updated_at = COALESCE(updated_at, ?) WHERE id = ?');
  for (const row of webhookRows) {
    if (!isEncryptedSecret(row.secret)) {
      updateWebhookSecret.run(encryptSecret(row.secret), timestampNow(), row.id);
    }
  }
}

function deletedUserArchiveDays() {
  const days = Number(process.env.DELETED_USER_ARCHIVE_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 90;
}

function purgeDeletedUserArchives(days = deletedUserArchiveDays()) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM deleted_users WHERE deleted_at < ?').run(cutoff);
}

function seedDefaultCashAccounts() {
  const usersWithoutAccounts = db.prepare(`
    SELECT u.id
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.is_active = 1
    )
  `).all();

  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
    VALUES (@id, @user_id, @name, @type, @balance, NULL, @currency, @color, @icon, 1, @created_at, NULL)
  `);
  const createdAt = timestampNow();

  for (const user of usersWithoutAccounts) {
    insertAccount.run({
      id: uuid(),
      user_id: user.id,
      created_at: createdAt,
      ...defaultCashAccount,
    });
  }
}

function seedDefaultCategories() {
  const categories = [
    { name: 'Food', icon: 'coffee', color: '#F97316', type: 'expense', sort_order: 10 },
    { name: 'Transport', icon: 'truck', color: '#3B82F6', type: 'expense', sort_order: 20 },
    { name: 'Housing', icon: 'home', color: '#8B5CF6', type: 'expense', sort_order: 30 },
    { name: 'Entertainment', icon: 'film', color: '#EC4899', type: 'expense', sort_order: 40 },
    { name: 'Health', icon: 'activity', color: '#EF4444', type: 'expense', sort_order: 50 },
    { name: 'Shopping', icon: 'shopping-cart', color: '#14B8A6', type: 'expense', sort_order: 60 },
    { name: 'Salary', icon: 'briefcase', color: '#22C55E', type: 'income', sort_order: 10 },
    { name: 'Investment', icon: 'trending-up', color: '#10B981', type: 'income', sort_order: 20 },
    { name: 'Utilities', icon: 'zap', color: '#F59E0B', type: 'expense', sort_order: 70 },
    { name: 'Other', icon: 'more-horizontal', color: '#64748B', type: 'expense', sort_order: 80 },
  ];

  const existing = db.prepare('SELECT COUNT(*) as count FROM categories WHERE is_default = 1').get();
  if (existing.count > 0) {
    const updateCategory = db.prepare(`
      UPDATE categories
      SET icon = @icon, color = @color, sort_order = @sort_order
      WHERE is_default = 1 AND user_id IS NULL AND name = @name AND type = @type
    `);
    for (const category of categories) updateCategory.run(category);

    const rows = db.prepare(`
      SELECT id, name, type
      FROM categories
      WHERE is_default = 1 AND user_id IS NULL
      ORDER BY created_at ASC, id ASC
    `).all();
    const keepByKey = new Map();
    const updateTransactions = db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?');
    const updateBudgets = db.prepare('UPDATE budgets SET category_id = ? WHERE category_id = ?');
    const deleteCategory = db.prepare('DELETE FROM categories WHERE id = ?');

    for (const row of rows) {
      const key = `${row.name}:${row.type}`;
      const keepId = keepByKey.get(key);
      if (!keepId) {
        keepByKey.set(key, row.id);
        continue;
      }

      updateTransactions.run(keepId, row.id);
      updateBudgets.run(keepId, row.id);
      deleteCategory.run(row.id);
    }
    return;
  }

  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (id, user_id, name, icon, color, type, is_default, sort_order, created_at)
    VALUES (@id, NULL, @name, @icon, @color, @type, 1, @sort_order, @created_at)
  `);

  const now = timestampNow();

  for (const category of categories) {
    insertCategory.run({
      id: uuid(),
      created_at: now,
      ...category,
    });
  }
}

function columnType(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().find((item) => item.name === column)?.type?.toUpperCase() || '';
}

function isIntegerMoneyTable(table, column = 'amount') {
  return columnType(table, column).includes('INT');
}

function migrateMoneyColumnsToCents() {
  db.transaction(() => {
    if (!isIntegerMoneyTable('accounts', 'balance')) {
      db.exec(`
        CREATE TABLE accounts_money_next (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT CHECK (type IN ('checking', 'savings', 'credit', 'investment', 'cash')),
          balance INTEGER DEFAULT 0,
          overdraft_limit INTEGER,
          currency TEXT DEFAULT 'USD',
          color TEXT,
          icon TEXT,
          is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO accounts_money_next
        SELECT id, user_id, name, type, ROUND(COALESCE(balance, 0) * 100),
               CASE WHEN overdraft_limit IS NULL THEN NULL ELSE ROUND(overdraft_limit * 100) END,
               currency, color, icon, is_active, created_at, updated_at
        FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_money_next RENAME TO accounts;
      `);
    }

    if (!isIntegerMoneyTable('transactions')) {
      db.exec(`
        CREATE TABLE transactions_money_next (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id TEXT,
          category_id TEXT,
          type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
          amount INTEGER NOT NULL CHECK (amount >= 0),
          description TEXT,
          note TEXT,
          date TEXT NOT NULL,
          recurring INTEGER DEFAULT 0 CHECK (recurring IN (0, 1)),
          recurring_interval TEXT CHECK (recurring_interval IS NULL OR recurring_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
          receipt_path TEXT,
          tags TEXT,
          transfer_group_id TEXT,
          transfer_direction TEXT CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination')),
          to_account_id TEXT,
          from_account_id TEXT,
          admin_deleted_at TEXT,
          admin_deleted_by TEXT,
          admin_delete_reason TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
          FOREIGN KEY (admin_deleted_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO transactions_money_next
        SELECT id, user_id, account_id, category_id, type, ROUND(COALESCE(amount, 0) * 100),
               description, note, date, recurring, recurring_interval, receipt_path, tags,
               transfer_group_id, transfer_direction, to_account_id, from_account_id,
               admin_deleted_at, admin_deleted_by, admin_delete_reason, created_at, updated_at
        FROM transactions;
        DROP TABLE transactions;
        ALTER TABLE transactions_money_next RENAME TO transactions;
      `);
    }

    if (!isIntegerMoneyTable('recurring_transactions')) {
      db.exec(`
        CREATE TABLE recurring_transactions_money_next (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          category_id TEXT,
          amount INTEGER NOT NULL CHECK (amount > 0),
          description TEXT,
          frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
          next_due_date TEXT NOT NULL,
          last_processed_date TEXT,
          is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        );
        INSERT INTO recurring_transactions_money_next
        SELECT id, user_id, account_id, category_id, ROUND(COALESCE(amount, 0) * 100),
               description, frequency, next_due_date, last_processed_date, is_active, created_at
        FROM recurring_transactions;
        DROP TABLE recurring_transactions;
        ALTER TABLE recurring_transactions_money_next RENAME TO recurring_transactions;
      `);
    }

    if (!isIntegerMoneyTable('budgets')) {
      db.exec(`
        CREATE TABLE budgets_money_next (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          category_id TEXT,
          amount INTEGER NOT NULL CHECK (amount >= 0),
          period TEXT CHECK (period IN ('monthly', 'weekly', 'yearly')),
          start_date TEXT,
          end_date TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        );
        INSERT INTO budgets_money_next
        SELECT id, user_id, category_id, ROUND(COALESCE(amount, 0) * 100),
               period, start_date, end_date, created_at, updated_at
        FROM budgets;
        DROP TABLE budgets;
        ALTER TABLE budgets_money_next RENAME TO budgets;
      `);
    }

    if (!isIntegerMoneyTable('deleted_users', 'total_account_balance')) {
      db.exec(`
        CREATE TABLE deleted_users_money_next (
          id TEXT PRIMARY KEY,
          original_user_id TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT,
          was_active INTEGER,
          created_at TEXT,
          last_login TEXT,
          deleted_at TEXT NOT NULL,
          deleted_by TEXT,
          account_count INTEGER DEFAULT 0,
          transaction_count INTEGER DEFAULT 0,
          budget_count INTEGER DEFAULT 0,
          total_account_balance INTEGER DEFAULT 0,
          transaction_total INTEGER DEFAULT 0,
          details_json TEXT,
          FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO deleted_users_money_next
        SELECT id, original_user_id, email, full_name, role, was_active, created_at, last_login,
               deleted_at, deleted_by, account_count, transaction_count, budget_count,
               ROUND(COALESCE(total_account_balance, 0) * 100), ROUND(COALESCE(transaction_total, 0) * 100),
               details_json
        FROM deleted_users;
        DROP TABLE deleted_users;
        ALTER TABLE deleted_users_money_next RENAME TO deleted_users;
      `);
    }
  })();
}

function seedAdminAccount() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminPasswordHash) {
    return;
  }

  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail.toLowerCase());

  if (existingAdmin) {
    return;
  }

  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, email_verified_at, security_stamp)
    VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)
  `).run(uuid(), adminEmail.toLowerCase(), adminPasswordHash, 'FinanceApp Admin', timestampNow(), timestampNow(), crypto.randomBytes(32).toString('hex'));
}

function recordSchemaVersion(version) {
  db.prepare(`
    INSERT INTO schema_version (id, version, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at
  `).run(version, timestampNow());
}

function migrate() {
  createTables();
  ensureSchemaUpdates();
  seedDefaultCategories();
  seedAdminAccount();
  seedDefaultCashAccounts();
  purgeDeletedUserArchives();
  recordSchemaVersion(1);
}

migrate();

module.exports = {
  db,
  dbPath,
  migrateMoneyColumnsToCents,
  migrate,
  purgeDeletedUserArchives,
};

