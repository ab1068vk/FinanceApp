# Database Schema Technical Reference

Audit date: 2026-05-08  
Schema source of truth: `backend/database/db.js` initializes SQLite through `better-sqlite3`, enables `PRAGMA foreign_keys = ON`, and runs startup migrations/seeds.

```js
// backend/database/db.js:38-42
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
```

## 1. Every Table

### `schema_version`

Source: `backend/database/db.js:86`

Columns:

| Column | Type | Constraints / defaults |
| --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` |
| `version` | `INTEGER` | `NOT NULL` |
| `updated_at` | `TEXT` | `NOT NULL` |

Indexes: primary key only.

```sql
-- backend/database/db.js:86-90
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `users`

Source: `backend/database/db.js:92`

Columns:

| Column | Type | Constraints / defaults |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` |
| `email` | `TEXT` | `UNIQUE NOT NULL` |
| `password_hash` | `TEXT` | `NOT NULL` |
| `full_name` | `TEXT` | `NOT NULL` |
| `avatar_color` | `TEXT` | `DEFAULT '#0F3460'` |
| `role` | `TEXT` | `DEFAULT 'user'`, `CHECK (role IN ('user', 'admin'))` |
| `is_active` | `INTEGER` | `DEFAULT 1`, `CHECK (is_active IN (0, 1))` |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| `updated_at` | `TEXT` | nullable |
| `last_login` | `TEXT` | nullable |
| `failed_login_attempts` | `INTEGER` | `DEFAULT 0` |
| `locked_until` | `TEXT` | nullable |
| `must_change_password` | `INTEGER` | `DEFAULT 0`, `CHECK (must_change_password IN (0, 1))` |
| `email_verified_at` | `TEXT` | nullable |
| `currency` | `TEXT` | `DEFAULT 'USD'` |
| `has_completed_onboarding` | `INTEGER` | `DEFAULT 0`, `CHECK (has_completed_onboarding IN (0, 1))` |
| `security_stamp` | `TEXT` | `NOT NULL DEFAULT (lower(hex(randomblob(32))))` |

Indexes: `PRIMARY KEY(id)`, autoindex for `UNIQUE(email)`, `idx_users_role(role)` at `backend/database/db.js:386`, `idx_users_is_active(is_active)` at `backend/database/db.js:387`, `idx_users_security_stamp(security_stamp)` at `backend/database/db.js:388`.

```sql
-- backend/database/db.js:92-110
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
```

### `categories`

Source: `backend/database/db.js:112`

Columns:

| Column | Type | Constraints / defaults |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` |
| `user_id` | `TEXT` | nullable FK to `users(id)` |
| `name` | `TEXT` | `NOT NULL` |
| `icon` | `TEXT` | nullable |
| `color` | `TEXT` | nullable |
| `type` | `TEXT` | `CHECK (type IN ('income', 'expense'))` |
| `is_default` | `INTEGER` | `DEFAULT 0`, `CHECK (is_default IN (0, 1))` |
| `is_system` | `INTEGER` | `DEFAULT 0`, `CHECK (is_system IN (0, 1))` |
| `is_active` | `INTEGER` | `DEFAULT 1`, `CHECK (is_active IN (0, 1))` |
| `sort_order` | `INTEGER` | `DEFAULT 0` |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`; unique `(user_id, name, type)`.

Indexes: `PRIMARY KEY(id)`, autoindex for `UNIQUE(user_id, name, type)`, `idx_categories_user_id(user_id)` at `backend/database/db.js:389`, partial unique `idx_categories_user_name_type_nocase(user_id, name COLLATE NOCASE, type) WHERE user_id IS NOT NULL` at `backend/database/db.js:701`.

```sql
-- backend/database/db.js:112-126
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
```

### `accounts`

Source: `backend/database/db.js:128`

Columns:

| Column | Type | Constraints / defaults |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` |
| `user_id` | `TEXT` | `NOT NULL`, FK to `users(id)` |
| `name` | `TEXT` | `NOT NULL` |
| `type` | `TEXT` | `CHECK (type IN ('checking', 'savings', 'credit', 'investment', 'cash'))` |
| `balance` | `INTEGER` | `DEFAULT 0`; stored in cents |
| `overdraft_limit` | `INTEGER` | nullable; stored in cents |
| `currency` | `TEXT` | `DEFAULT 'USD'` |
| `color` | `TEXT` | nullable |
| `icon` | `TEXT` | nullable |
| `is_active` | `INTEGER` | `DEFAULT 1`, `CHECK (is_active IN (0, 1))` |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| `updated_at` | `TEXT` | nullable |

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`.

Indexes: `PRIMARY KEY(id)`, `idx_accounts_user_id(user_id)` at `backend/database/db.js:385`, partial unique `idx_accounts_active_user_type_name(user_id, type, name) WHERE is_active = 1` at `backend/database/db.js:698`.

```sql
-- backend/database/db.js:128-142
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
```

### `transactions`

Source: `backend/database/db.js:144`

Columns:

| Column | Type | Constraints / defaults |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` |
| `user_id` | `TEXT` | `NOT NULL`, FK to `users(id)` |
| `account_id` | `TEXT` | nullable FK to `accounts(id)` |
| `category_id` | `TEXT` | nullable FK to `categories(id)` |
| `type` | `TEXT` | `NOT NULL`, `CHECK (type IN ('income', 'expense', 'transfer'))` |
| `amount` | `INTEGER` | `NOT NULL`, `CHECK (amount >= 0)`; stored in cents |
| `description` | `TEXT` | nullable |
| `note` | `TEXT` | nullable |
| `date` | `TEXT` | `NOT NULL`; ISO timestamp string |
| `recurring` | `INTEGER` | `DEFAULT 0`, `CHECK (recurring IN (0, 1))` |
| `recurring_interval` | `TEXT` | nullable, `CHECK (recurring_interval IS NULL OR recurring_interval IN ('daily', 'weekly', 'monthly', 'yearly'))` |
| `receipt_path` | `TEXT` | nullable |
| `tags` | `TEXT` | nullable JSON array string |
| `transfer_group_id` | `TEXT` | nullable; no FK |
| `transfer_direction` | `TEXT` | nullable, `CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination'))` |
| `to_account_id` | `TEXT` | nullable; no FK |
| `from_account_id` | `TEXT` | nullable; no FK |
| `admin_deleted_at` | `TEXT` | nullable soft-delete timestamp |
| `admin_deleted_by` | `TEXT` | nullable FK to `users(id)` |
| `admin_delete_reason` | `TEXT` | nullable |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| `updated_at` | `TEXT` | nullable |

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`; `account_id -> accounts(id) ON DELETE SET NULL`; `category_id -> categories(id) ON DELETE SET NULL`; `admin_deleted_by -> users(id) ON DELETE SET NULL`.

Indexes: `PRIMARY KEY(id)`, `idx_transactions_user_id(user_id)`, `idx_transactions_account_id(account_id)`, `idx_transactions_category_id(category_id)`, `idx_transactions_date(date)`, `idx_transactions_created_at(created_at)`, `idx_txn_budget_lookup(user_id, category_id, type, admin_deleted_at, date)`, `idx_transactions_transfer_group_id(transfer_group_id)`, `idx_transactions_transfer_direction(transfer_direction)`, `idx_transactions_admin_deleted(admin_deleted_at)` at `backend/database/db.js:390-395` and `backend/database/db.js:686-691`.

```sql
-- backend/database/db.js:144-171
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
```

### `recurring_transactions`

Source: `backend/database/db.js:173`

Columns:

| Column | Type | Constraints / defaults |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` |
| `user_id` | `TEXT` | `NOT NULL`, FK to `users(id)` |
| `account_id` | `TEXT` | `NOT NULL`, FK to `accounts(id)` |
| `category_id` | `TEXT` | nullable FK to `categories(id)` |
| `amount` | `INTEGER` | `NOT NULL`, `CHECK (amount > 0)`; stored in cents |
| `description` | `TEXT` | nullable |
| `frequency` | `TEXT` | `NOT NULL`, `CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly'))` |
| `next_due_date` | `TEXT` | `NOT NULL` |
| `last_processed_date` | `TEXT` | nullable |
| `is_active` | `INTEGER` | `DEFAULT 1`, `CHECK (is_active IN (0, 1))` |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`; `account_id -> accounts(id) ON DELETE CASCADE`; `category_id -> categories(id) ON DELETE SET NULL`.

Indexes: `idx_recurring_transactions_due(is_active, next_due_date)`, `idx_recurring_transactions_user_id(user_id)`, `idx_recurring_transactions_account_id(account_id)`, `idx_recurring_transactions_category_id(category_id)` at `backend/database/db.js:416-419`.

```sql
-- backend/database/db.js:173-188
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
```

### `notifications`

Source: `backend/database/db.js:190`

Columns:

| Column | Type | Constraints / defaults |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` |
| `user_id` | `TEXT` | `NOT NULL`, FK to `users(id)` |
| `type` | `TEXT` | `NOT NULL` |
| `title` | `TEXT` | `NOT NULL` |
| `body` | `TEXT` | `NOT NULL` |
| `data_json` | `TEXT` | nullable JSON string |
| `read_at` | `TEXT` | nullable read marker |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`.

Indexes: `idx_notifications_user_id(user_id)` and `idx_notifications_created_at(created_at)` at `backend/database/db.js:420-421`.

```sql
-- backend/database/db.js:190-200
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
```

### `push_tokens`

Source: `backend/database/db.js:202`

Columns: `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `token TEXT NOT NULL`, `platform TEXT NOT NULL`, `created_at TEXT DEFAULT (datetime('now'))`.

Constraints: `UNIQUE(user_id, token)`; FK `user_id -> users(id) ON DELETE CASCADE`.

Indexes: PK, unique autoindex, `idx_push_tokens_user_id(user_id)` at `backend/database/db.js:422`.

```sql
-- backend/database/db.js:202-210
CREATE TABLE IF NOT EXISTS push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### `notification_preferences`

Source: `backend/database/db.js:212`

Columns: `user_id TEXT NOT NULL`, `type TEXT NOT NULL`, `enabled INTEGER DEFAULT 1 CHECK (enabled IN (0, 1))`, `updated_at TEXT NOT NULL`.

Constraints/indexes: composite PK `(user_id, type)`; FK `user_id -> users(id) ON DELETE CASCADE`.

```sql
-- backend/database/db.js:212-219
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### `budgets`

Source: `backend/database/db.js:221`

Columns: `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `category_id TEXT`, `amount INTEGER NOT NULL CHECK (amount >= 0)`, `period TEXT CHECK (period IN ('monthly', 'weekly', 'yearly'))`, `start_date TEXT`, `end_date TEXT`, `created_at TEXT DEFAULT (datetime('now'))`, `updated_at TEXT`.

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`; `category_id -> categories(id) ON DELETE SET NULL`.

Indexes: `idx_budgets_user_id(user_id)`, `idx_budgets_category_id(category_id)`, `idx_budgets_overlap(user_id, category_id, start_date, end_date)` at `backend/database/db.js:396-398`.

```sql
-- backend/database/db.js:221-233
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
```

### `refresh_tokens`

Source: `backend/database/db.js:235`

Columns: `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `family_id TEXT`, `token_hash TEXT NOT NULL`, `expires_at TEXT NOT NULL`, `created_at TEXT DEFAULT (datetime('now'))`, `last_used_at TEXT`, `user_agent TEXT`, `revoked INTEGER DEFAULT 0 CHECK (revoked IN (0, 1))`.

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`. `family_id` is not a FK.

Indexes: `idx_refresh_tokens_user_id(user_id)`, `idx_refresh_tokens_token_hash(token_hash)`, `idx_refresh_tokens_expires_at(expires_at)`, `idx_refresh_tokens_active(user_id, revoked, expires_at)`, `idx_refresh_tokens_family_id(family_id)` at `backend/database/db.js:399-402` and `backend/database/db.js:508`.

```sql
-- backend/database/db.js:235-246
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
```

### `password_reset_tokens`

Source: `backend/database/db.js:248`

Columns: `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `token_hash TEXT NOT NULL UNIQUE`, `expires_at TEXT NOT NULL`, `used_at TEXT`, `created_at TEXT DEFAULT (datetime('now'))`.

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`.

Indexes: PK, unique autoindex on `token_hash`, `idx_password_reset_tokens_user_id(user_id)`, `idx_password_reset_tokens_hash(token_hash)` at `backend/database/db.js:403-404`.

### `email_verification_tokens`

Source: `backend/database/db.js:258`

Columns: `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `token_hash TEXT NOT NULL UNIQUE`, `expires_at TEXT NOT NULL`, `used_at TEXT`, `created_at TEXT DEFAULT (datetime('now'))`.

Constraints: FK `user_id -> users(id) ON DELETE CASCADE`.

Indexes: PK, unique autoindex on `token_hash`, `idx_email_verification_tokens_user_id(user_id)`, `idx_email_verification_tokens_hash(token_hash)` at `backend/database/db.js:405-406`.

```sql
-- backend/database/db.js:248-266
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
```

### `audit_logs`

Source: `backend/database/db.js:268`

Columns: `id TEXT PRIMARY KEY`, `user_id TEXT`, `action TEXT NOT NULL`, `entity_type TEXT`, `entity_id TEXT`, `old_value TEXT`, `new_value TEXT`, `ip_address TEXT`, `user_agent TEXT`, `created_at TEXT DEFAULT (datetime('now'))`.

Constraints: FK `user_id -> users(id) ON DELETE SET NULL`; `entity_id` is polymorphic and unconstrained.

Indexes: `idx_audit_logs_user_id(user_id)`, `idx_audit_logs_created_at(created_at)`, `idx_audit_logs_action(action)` at `backend/database/db.js:407-409`.

### `access_token_blocklist`

Source: `backend/database/db.js:282`

Columns: `jti TEXT PRIMARY KEY`, `expires_at TEXT NOT NULL`, `created_at TEXT DEFAULT (datetime('now'))`.

Indexes: PK, `idx_access_token_blocklist_expires(expires_at)` at `backend/database/db.js:410`.

### `deleted_users`

Source: `backend/database/db.js:288`

Columns: `id TEXT PRIMARY KEY`, `original_user_id TEXT NOT NULL UNIQUE`, `email TEXT NOT NULL`, `full_name TEXT NOT NULL`, `role TEXT`, `was_active INTEGER`, `created_at TEXT`, `last_login TEXT`, `deleted_at TEXT NOT NULL`, `deleted_by TEXT`, `account_count INTEGER DEFAULT 0`, `transaction_count INTEGER DEFAULT 0`, `budget_count INTEGER DEFAULT 0`, `total_account_balance INTEGER DEFAULT 0`, `transaction_total INTEGER DEFAULT 0`, `details_json TEXT`.

Constraints: FK `deleted_by -> users(id) ON DELETE SET NULL`; `original_user_id` intentionally does not reference `users(id)` because the original row may be hard-deleted.

Indexes: PK, unique autoindex on `original_user_id`, `idx_deleted_users_deleted_at(deleted_at)` at `backend/database/db.js:411`.

### `app_settings`

Source: `backend/database/db.js:308`

Columns: `key TEXT PRIMARY KEY`, `value TEXT NOT NULL`, `updated_at TEXT NOT NULL`, `updated_by TEXT`.

Constraints: FK `updated_by -> users(id) ON DELETE SET NULL`.

Indexes: PK only.

### `announcements`

Source: `backend/database/db.js:316`

Columns: `id TEXT PRIMARY KEY`, `title TEXT NOT NULL`, `body TEXT NOT NULL`, `is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1))`, `starts_at TEXT`, `ends_at TEXT`, `created_at TEXT DEFAULT (datetime('now'))`, `updated_at TEXT`, `created_by TEXT`.

Constraints: FK `created_by -> users(id) ON DELETE SET NULL`.

Indexes: `idx_announcements_active(is_active, starts_at, ends_at)` at `backend/database/db.js:412`.

### `announcement_dismissals`

Source: `backend/database/db.js:329`

Columns: `announcement_id TEXT NOT NULL`, `user_id TEXT NOT NULL`, `dismissed_at TEXT DEFAULT (datetime('now'))`.

Constraints/indexes: composite PK `(announcement_id, user_id)`; FK `announcement_id -> announcements(id) ON DELETE CASCADE`; FK `user_id -> users(id) ON DELETE CASCADE`; `idx_announcement_dismissals_user(user_id)` at `backend/database/db.js:413`.

### `admin_api_tokens`

Source: `backend/database/db.js:338`

Columns: `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `token_hash TEXT NOT NULL UNIQUE`, `scopes TEXT NOT NULL`, `is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1))`, `last_used_at TEXT`, `created_at TEXT DEFAULT (datetime('now'))`, `revoked_at TEXT`, `created_by TEXT`.

Constraints: FK `created_by -> users(id) ON DELETE SET NULL`.

Indexes: PK and unique autoindex on `token_hash`.

### `webhooks`

Source: `backend/database/db.js:351`

Columns: `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `url TEXT NOT NULL`, `event TEXT NOT NULL`, `is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1))`, `secret TEXT`, `created_at TEXT DEFAULT (datetime('now'))`, `updated_at TEXT`, `created_by TEXT`.

Constraints: FK `created_by -> users(id) ON DELETE SET NULL`.

Indexes: PK only.

### `webhook_deliveries`

Source: `backend/database/db.js:364`

Columns: `id TEXT PRIMARY KEY`, `webhook_id TEXT NOT NULL`, `event TEXT NOT NULL`, `status TEXT NOT NULL`, `status_code INTEGER`, `error TEXT`, `created_at TEXT DEFAULT (datetime('now'))`.

Constraints: FK `webhook_id -> webhooks(id) ON DELETE CASCADE`.

Indexes: PK, `idx_webhook_deliveries_webhook_id(webhook_id)` at `backend/database/db.js:414`.

### `security_ip_blocks`

Source: `backend/database/db.js:375`

Columns: `ip TEXT PRIMARY KEY`, `count INTEGER DEFAULT 0`, `first_seen TEXT NOT NULL`, `blocked_until TEXT`, `reason TEXT`, `created_at TEXT DEFAULT (datetime('now'))`, `updated_at TEXT`.

Indexes: PK, `idx_security_ip_blocks_blocked_until(blocked_until)` at `backend/database/db.js:415`.

## 2. Every Foreign Key Relationship

Declared database FKs:

| Child table.column | Parent table.column | Delete behavior | Source |
| --- | --- | --- | --- |
| `categories.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:124` |
| `accounts.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:141` |
| `transactions.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:167` |
| `transactions.account_id` | `accounts.id` | `ON DELETE SET NULL` | `backend/database/db.js:168` |
| `transactions.category_id` | `categories.id` | `ON DELETE SET NULL` | `backend/database/db.js:169` |
| `transactions.admin_deleted_by` | `users.id` | `ON DELETE SET NULL` | `backend/database/db.js:170` |
| `recurring_transactions.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:185` |
| `recurring_transactions.account_id` | `accounts.id` | `ON DELETE CASCADE` | `backend/database/db.js:186` |
| `recurring_transactions.category_id` | `categories.id` | `ON DELETE SET NULL` | `backend/database/db.js:187` |
| `notifications.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:199` |
| `push_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:209` |
| `notification_preferences.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:218` |
| `budgets.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:231` |
| `budgets.category_id` | `categories.id` | `ON DELETE SET NULL` | `backend/database/db.js:232` |
| `refresh_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:245` |
| `password_reset_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:255` |
| `email_verification_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:265` |
| `audit_logs.user_id` | `users.id` | `ON DELETE SET NULL` | `backend/database/db.js:279` |
| `deleted_users.deleted_by` | `users.id` | `ON DELETE SET NULL` | `backend/database/db.js:305` |
| `app_settings.updated_by` | `users.id` | `ON DELETE SET NULL` | `backend/database/db.js:313` |
| `announcements.created_by` | `users.id` | `ON DELETE SET NULL` | `backend/database/db.js:326` |
| `announcement_dismissals.announcement_id` | `announcements.id` | `ON DELETE CASCADE` | `backend/database/db.js:334` |
| `announcement_dismissals.user_id` | `users.id` | `ON DELETE CASCADE` | `backend/database/db.js:335` |
| `admin_api_tokens.created_by` | `users.id` | `ON DELETE SET NULL` | `backend/database/db.js:348` |
| `webhooks.created_by` | `users.id` | `ON DELETE SET NULL` | `backend/database/db.js:361` |
| `webhook_deliveries.webhook_id` | `webhooks.id` | `ON DELETE CASCADE` | `backend/database/db.js:372` |

Not declared as DB FKs but relational in meaning: `transactions.to_account_id`, `transactions.from_account_id`, `transactions.transfer_group_id`, `refresh_tokens.family_id`, `audit_logs.entity_id`, `deleted_users.original_user_id`.

## 3. Relationships Enforced In Code Instead Of By DB Constraint

User/account ownership is enforced manually because `transactions.account_id -> accounts.id` does not prove same user or active account.

```js
// backend/src/controllers/transactionController.js:51-56
function getOwnedAccount(id, userId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(id, userId);
}
function getAllowedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId);
}
```

Budget/category ownership is also manual and accepts global categories.

```js
// backend/src/controllers/budgetController.js:18-20
function allowedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId);
}
```

Transfer relationships are two transaction rows tied by `transfer_group_id`; `to_account_id` and `from_account_id` are not FKs. Creation validates both owned accounts and creates paired rows.

```js
// backend/src/controllers/transactionController.js:195-216
if (base.type === 'transfer') {
  const toAccount = getOwnedAccount(req.body.to_account_id, req.user.id);
  if (!toAccount) throw Object.assign(new Error('to_account_id must belong to the authenticated user'), { statusCode: 400 });
  if (toAccount.id === account.id) throw Object.assign(new Error('to_account_id must be different from account_id'), { statusCode: 400 });
  const groupId = crypto.randomUUID();
  const sourceTx = { ...base, transfer_group_id: groupId, transfer_direction: 'source', to_account_id: toAccount.id };
  const destTx = { ...base, id: crypto.randomUUID(), account_id: toAccount.id, transfer_group_id: groupId, transfer_direction: 'destination', from_account_id: account.id };
  insertTransaction(sourceTx); insertTransaction(destTx);
}
```

Transfer cascade behavior is manual on user deletes and account deletes. Deleting one transfer transaction expands to every row in the group.

```js
// backend/src/controllers/transactionController.js:373-394
const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
let related = [tx];
if (tx.type === 'transfer' && getTransferGroupId(tx)) {
  related = getRelatedTransferTransactions(req.user.id, getTransferGroupId(tx));
}
for (const item of related) {
  if (item.account_id) updateBalance(item.account_id, req.user.id, -computeBalanceDelta(item));
  db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(item.id, req.user.id);
}
```

Account deletion is not pure FK behavior. The app either hard-deletes related transactions, moves them to Cash, then soft-deletes the account.

```js
// backend/src/controllers/accountController.js:56-86
function deleteAccountTransactions(accountId, userId) {
  const transactions = transactionsForAccountDelete(accountId, userId);
  for (const transaction of transactions) {
    updateStoredBalance(transaction.account_id, userId, -computeBalanceDelta(transaction));
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(transaction.id, userId);
  }
}
db.prepare('UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ?')
  .run(cashAccount.id, updatedAt, accountId, userId);
db.prepare('UPDATE transactions SET from_account_id = ?, updated_at = ? WHERE from_account_id = ? AND user_id = ?')
  .run(cashAccount.id, updatedAt, accountId, userId);
db.prepare('UPDATE transactions SET to_account_id = ?, updated_at = ? WHERE to_account_id = ? AND user_id = ?')
  .run(cashAccount.id, updatedAt, accountId, userId);
```

Admin account hard-delete duplicates the same manual relationship handling before deleting `accounts`.

```js
// backend/src/controllers/adminController.js:1285-1330
const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.accountId, req.params.id);
const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.accountId, req.params.id).count;
const transactionAction = req.query.transaction_action;
db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.accountId, req.params.id);
```

Default category deletion manually clears references before deleting, even though the FK would also set `transactions.category_id` and `budgets.category_id` to null.

```js
// backend/src/controllers/adminController.js:1467-1471
clearedTransactionRefs = db.prepare('UPDATE transactions SET category_id = NULL, updated_at = ? WHERE category_id = ?')
  .run(deletedAt, req.params.id).changes;
clearedBudgetRefs = db.prepare('UPDATE budgets SET category_id = NULL, updated_at = ? WHERE category_id = ?')
  .run(deletedAt, req.params.id).changes;
db.prepare('DELETE FROM categories WHERE id = ? AND user_id IS NULL').run(req.params.id);
```

Budget overlap is enforced in code, not by a unique or exclusion constraint.

```js
// backend/src/controllers/budgetController.js:74-84
return db.prepare(`
  SELECT id
  FROM budgets
  WHERE user_id = @user_id
    AND category_id = @category_id
    AND (@exclude_id IS NULL OR id != @exclude_id)
    AND datetime(start_date) <= datetime(@end_date)
    AND datetime(COALESCE(end_date, '9999-12-31T23:59:59.999Z')) >= datetime(@start_date)
  LIMIT 1
`).get(params);
```

Refresh-token families are logical relationships only. `family_id` has an index but no FK.

```js
// backend/src/controllers/authController.js:430
db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? OR family_id = ?').run(rootId, rootId);
```

Audit-log `entity_id` is polymorphic and cleaned manually for hard-deleted users.

```js
// backend/src/controllers/adminController.js:821-837
db.prepare(`
  DELETE FROM audit_logs
  WHERE user_id = ?
    OR entity_id = ?
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
```

Announcement dismissals have a DB cascade but are also manually deleted before announcement deletion.

```js
// backend/src/controllers/adminController.js:1798-1799
dismissedCount = db.prepare('DELETE FROM announcement_dismissals WHERE announcement_id = ?').run(req.params.id).changes;
db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
```

## 4. Soft-Delete Patterns

### `users.is_active`

Pattern: active users are `is_active = 1`; deactivation keeps the row. Admin status update also revokes refresh tokens.

```js
// backend/src/controllers/adminController.js:640-642
db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive, nowIso(), req.params.id);
if (!isActive) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(req.params.id);
```

Correct filters: auth middleware (`backend/src/middleware/auth.js:76`), login (`backend/src/controllers/authController.js:308`), refresh token user status (`backend/src/controllers/authController.js:414-439`), password reset/verification token use (`backend/src/controllers/authController.js:564` and `backend/src/controllers/authController.js:617`), recurring processor (`backend/src/utils/recurringProcessor.js:69`), admin push announcements (`backend/src/controllers/adminController.js:1761`).

Misses/surprises:

- API-token auth joins the creator user but does not require `u.is_active = 1`; a deactivated admin's still-active API token can authenticate.

```js
// backend/src/middleware/auth.js:17-24
SELECT t.id AS token_id, t.scopes, u.*
FROM admin_api_tokens t
JOIN users u ON u.id = t.created_by
WHERE t.token_hash = ?
  AND t.is_active = 1
  AND t.revoked_at IS NULL
```

- Startup default cash-account seeding considers all users, not active users.

```js
// backend/database/db.js:794-799
SELECT u.id
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.is_active = 1
)
```

### `accounts.is_active`

Pattern: normal account deletion sets `is_active = 0`.

```js
// backend/src/controllers/accountController.js:223
db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
```

Correct filters: user account list/get/update/delete (`backend/src/controllers/accountController.js:147-201`), transaction account validation (`backend/src/controllers/transactionController.js:51-52`), default cash account lookup (`backend/src/utils/defaultAccount.js:52-56`), recurring processor account join (`backend/src/utils/recurringProcessor.js:70`).

Misses/surprises:

- Admin user-account list deliberately returns active and inactive accounts, sorted by active status (`backend/src/controllers/adminController.js:1250-1256`).
- Moving transactions to Cash only computes balance impact from non-admin-deleted rows, but updates every row matching the account, including admin-deleted rows.

```js
// backend/src/controllers/accountController.js:77-85
const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
db.prepare('UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ?')
  .run(cashAccount.id, updatedAt, accountId, userId);
```

### `categories.is_active`

Pattern: categories are hidden by setting `is_active = 0`, mainly for default/system category administration.

Correct filters: category list (`backend/src/controllers/categoryController.js:39-41`), pushing default categories (`backend/src/controllers/adminController.js:1492-1505`).

Misses/surprises:

- Transaction and budget validation allow inactive categories because the helper checks ownership/global status only.

```js
// backend/src/controllers/transactionController.js:54-56
function getAllowedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId);
}
```

- User category update/delete selects owned categories without `is_active = 1` (`backend/src/controllers/categoryController.js:88` and `backend/src/controllers/categoryController.js:125`).
- Transaction and budget joins do not filter category activity, so inactive categories still label historical rows (`backend/src/controllers/transactionController.js:116`, `backend/src/controllers/budgetController.js:123`).

### `transactions.admin_deleted_at`

Pattern: only admin deletion is soft deletion; user deletion hard-deletes rows.

```js
// backend/src/controllers/adminController.js:1232-1236
UPDATE transactions
SET admin_deleted_at = ?, admin_deleted_by = ?, admin_delete_reason = ?, updated_at = ?
WHERE id = ?
```

Correct filters: user transaction list/detail/update/delete/summary/bulk (`backend/src/controllers/transactionController.js:251`, `283`, `296`, `373`, `405`, `465`, `517`, `522`), budgets (`backend/src/controllers/budgetController.js:127`, `150`, `156`), account current balance (`backend/src/utils/accountBalance.js:21-23`), admin transaction listing defaults to excluding deleted unless explicitly included (`backend/src/controllers/adminController.js:1166-1168`), admin analytics (`backend/src/controllers/adminController.js:1669`, `1687`, `1715`).

Misses/surprises:

- Admin user detail summary counts and sums all transactions for the user, including admin-deleted transactions.

```js
// backend/src/controllers/adminController.js:586-587
transaction_count: db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(req.params.id).count,
transaction_total: db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ?').get(req.params.id).total,
```

- User data export includes all transactions, including admin-deleted rows.

```js
// backend/src/controllers/authController.js:961-962
accounts: db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(userId),
transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(userId),
```

- Admin dashboard counts new transactions by `created_at` without excluding admin-deleted rows (`backend/src/controllers/adminController.js:455`).

### `announcements.is_active`

Pattern: active, date-valid, undismissed announcements appear to users.

```js
// backend/src/controllers/announcementController.js:21-30
SELECT a.id, a.title, a.body, a.starts_at, a.ends_at, a.created_at, a.updated_at
FROM announcements a
LEFT JOIN announcement_dismissals d
  ON d.announcement_id = a.id
 AND d.user_id = ?
WHERE a.is_active = 1
  AND d.announcement_id IS NULL
  AND (a.starts_at IS NULL OR a.starts_at <= ?)
  AND (a.ends_at IS NULL OR a.ends_at >= ?)
```

Miss: dismissing an announcement checks only existence, not `is_active` or date window.

```js
// backend/src/controllers/announcementController.js:41-46
const announcement = db.prepare('SELECT id FROM announcements WHERE id = ?').get(req.params.id);
db.prepare(`
  INSERT OR REPLACE INTO announcement_dismissals (announcement_id, user_id, dismissed_at)
  VALUES (?, ?, ?)
`).run(req.params.id, req.user.id, new Date().toISOString());
```

### Other soft/lifecycle flags

- `recurring_transactions.is_active`: processor filters `rt.is_active = 1` and active user/account (`backend/src/utils/recurringProcessor.js:68-72`).
- `admin_api_tokens.is_active` plus `revoked_at`: auth filters both (`backend/src/middleware/auth.js:17-24`); admin list intentionally returns all (`backend/src/controllers/adminController.js:1811-1812`).
- `webhooks.is_active`: CRUD stores and updates it (`backend/src/controllers/adminController.js:1891`, `1913-1925`); no webhook dispatcher was present in this codebase to audit runtime filtering.
- `refresh_tokens.revoked`: active sessions filter `revoked = 0 AND expires_at > ?` (`backend/src/controllers/adminController.js:613-620`); prune hard-deletes revoked/expired rows (`backend/src/controllers/authController.js:187-188`).
- `password_reset_tokens.used_at` and `email_verification_tokens.used_at`: both use `used_at IS NULL` when consuming tokens (`backend/src/controllers/authController.js:559-564`, `612-617`).

## 5. Stored Values That Can Drift From Derived Values

`accounts.balance` is denormalized. The derived value is computed from non-admin-deleted transactions. Drift is logged, not repaired automatically.

```js
// backend/src/utils/accountBalance.js:12-24
function accountCurrentBalanceExpr(accountAlias = 'accounts') {
  return `COALESCE((
  SELECT SUM(CASE
    WHEN t.type = 'income' THEN t.amount
    WHEN t.type = 'expense' THEN -t.amount
    WHEN t.type = 'transfer' AND ${transferDestinationPredicate('t')} THEN t.amount
    ELSE -t.amount
  END)
  FROM transactions t
  WHERE t.account_id = ${accountAlias}.id
    AND t.user_id = ${accountAlias}.user_id
    AND t.admin_deleted_at IS NULL
), 0)`;
}
```

Balance updates are hand-maintained in transaction/account/admin paths.

```js
// backend/src/controllers/transactionController.js:95-99
if (!db.inTransaction) {
  logger.warn('Account balance updated outside transaction', { accountId, userId, delta });
}
db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
```

Opening balance is stored twice: as `accounts.balance` and an "Opening balance" transaction. They can diverge if any manual DB write touches one side.

```js
// backend/src/controllers/accountController.js:97-130
const initialBalance = amountToCents(req.body.balance || 0);
const account = {
  id: crypto.randomUUID(),
  user_id: req.user.id,
  name: req.body.name.trim(),
  type: req.body.type,
  balance: initialBalance,
  overdraft_limit: overdraftLimit,
};
db.prepare(`INSERT INTO transactions (id, user_id, account_id, category_id, type, amount, description, note, date, recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction, created_at, updated_at)
  VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, NULL, NULL, ?, NULL)`).run(
  crypto.randomUUID(), req.user.id, account.id, initialBalance >= 0 ? 'income' : 'expense', Math.abs(initialBalance), 'Opening balance', createdAt, JSON.stringify(['opening-balance']), createdAt
);
```

Admin balance correction computes against stored `accounts.balance`, not the derived current balance.

```js
// backend/src/controllers/adminController.js:1344-1353
const targetBalance = amountToCents(req.body.target_balance);
const delta = targetBalance - Number(account.balance || 0);
const correction = {
  type: delta >= 0 ? 'income' : 'expense',
  amount: Math.abs(delta),
  description: 'Admin balance correction',
};
```

`deleted_users.*_count` and money totals are snapshots of user state at deletion time. They do not recalculate later.

```js
// backend/src/controllers/adminController.js:650-661
const archive = {
  summary: {
    account_count: accountStats.count,
    transaction_count: transactionStats.count,
    budget_count: budgetStats.count,
    total_account_balance: accountStats.balance,
    transaction_total: transactionStats.total,
  },
};
```

`recurring_transactions.last_processed_date` / `next_due_date` are stored state derived from processing. They can get out of sync with actual generated transactions after manual DB edits or partial external changes; normal processing updates them in the same transaction as the generated transaction.

```js
// backend/src/utils/recurringProcessor.js:123-142
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
`).run(transaction);
db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
  .run(balanceDelta(rule), processedAt, rule.account_id, rule.user_id);
db.prepare(`
  UPDATE recurring_transactions
  SET last_processed_date = ?, next_due_date = ?
  WHERE id = ?
`).run(today, nextDueDate, rule.id);
```

`admin_api_tokens.last_used_at` is intentionally approximate because writes are debounced for one minute.

```js
// backend/src/middleware/auth.js:8-14
// Process-local debounce for the audit timestamp write; last_used_at is tracked
// with one-minute granularity, not exact per-request precision.
const apiTokenLastUsedWritten = new Map();
const API_TOKEN_WRITE_DEBOUNCE_MS = 60_000;
```

## 6. Missing Indexes For Heavy WHERE/JOIN Clauses

Likely missing `audit_logs(entity_id)` or composite `(entity_id, created_at)`. `entity_id` is repeatedly filtered but only `user_id`, `created_at`, and `action` are indexed.

```js
// backend/src/controllers/adminController.js:591-596
SELECT * FROM audit_logs
WHERE user_id = ? OR entity_id = ?
ORDER BY created_at DESC
LIMIT 10
```

```js
// backend/src/controllers/adminController.js:1103-1105
db.prepare('SELECT * FROM audit_logs WHERE (user_id = ? OR entity_id = ?) AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
```

Likely missing `deleted_users(email, deleted_at)`. Re-registration/lookup checks by email, but only `deleted_at` and `original_user_id` are indexed.

```js
// backend/src/controllers/authController.js:95-97
function getDeletedUserByEmail(email) {
  return db.prepare('SELECT id FROM deleted_users WHERE email = ? ORDER BY deleted_at DESC LIMIT 1').get(email.toLowerCase());
}
```

Likely missing composite `notifications(user_id, created_at DESC)`. Current indexes are separate, but the query filters by user and orders by created time.

```js
// backend/src/controllers/authController.js:819-824
SELECT id, user_id, type, title, body, data_json, read_at, created_at
FROM notifications
WHERE user_id = ?
ORDER BY created_at DESC
LIMIT ?
```

Likely missing composite `transactions(account_id, user_id, admin_deleted_at, date, created_at)` or `transactions(user_id, account_id, admin_deleted_at, date, created_at)`. Account detail and account-delete workflows filter by account/user/deleted and sort or scan.

```js
// backend/src/controllers/accountController.js:161-162
SELECT * FROM transactions
WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 5
```

Likely missing composite `transactions(user_id, transfer_group_id, admin_deleted_at)`. Transfer expansion is central to delete/update behavior; only single-column `transfer_group_id` exists.

```js
// backend/src/controllers/transactionController.js:161-167
SELECT * FROM transactions
WHERE user_id = ? AND transfer_group_id = ?
  AND admin_deleted_at IS NULL
ORDER BY created_at ASC
```

Likely missing `webhooks(created_at)` and `admin_api_tokens(created_at)` if these admin lists grow large. Both list by `ORDER BY created_at DESC` without explicit indexes.

```js
// backend/src/controllers/adminController.js:1811-1812
SELECT id, name, scopes, is_active, last_used_at, created_at, revoked_at, created_by
FROM admin_api_tokens ORDER BY created_at DESC LIMIT ? OFFSET ?
```

```js
// backend/src/controllers/adminController.js:1875-1876
SELECT w.*, (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS delivery_count
FROM webhooks w ORDER BY w.created_at DESC LIMIT ? OFFSET ?
```

## 7. Columns Whose Unit Or Format Differs From The Name

Money columns named `amount`, `balance`, `overdraft_limit`, `total_account_balance`, and `transaction_total` are stored as integer cents, while API responses are serialized back to decimal currency amounts.

```js
// backend/src/utils/money.js:1-13
const MONEY_RESPONSE_KEYS = new Set([
  'amount',
  'balance',
  'overdraft_limit',
  'current_balance',
  'current_spending',
  'remaining',
  'total',
  'sum',
  'income',
  'expense',
]);
```

```js
// backend/src/utils/money.js:35-52
function amountToCents(value, { allowZero = true } = {}) {
  const raw = typeof value === 'string' ? value.trim() : value;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || (!allowZero && amount <= 0)) {
    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
  }
  if (!/^-?\d+(\.\d+)?$/.test(String(raw))) {
    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
  }
  const sign = amount < 0 ? -1 : 1;
  const [intPart, decPart = ''] = String(raw).replace('-', '').split('.');
  const centsDigits = decPart.padEnd(3, '0').slice(0, 3);
  const roundedCents = parseInt(centsDigits.slice(0, 2), 10) + (Number(centsDigits[2]) >= 5 ? 1 : 0);
  const abs = parseInt(intPart, 10) * 100 + roundedCents;
  return sign * abs;
}
function centsToAmount(value) {
  const cents = Number(value);
  return parseFloat((Math.round(cents) / 100).toFixed(2));
}
```

`transactions.date`, `budgets.start_date`, `budgets.end_date`, `announcements.starts_at`, `announcements.ends_at`, and most `*_at` fields are `TEXT` ISO timestamps, not native date/time columns.

```js
// backend/src/controllers/budgetController.js:53-63
return {
  start_date: startDate.toISOString(),
  end_date: endDate ? endDate.toISOString() : null,
};
```

`transactions.tags` is a JSON array string, despite the generic `TEXT` type and plural name.

```js
// backend/src/controllers/transactionController.js:188-190
tags: JSON.stringify(parseTags(req.body.tags)), transfer_group_id: null, transfer_direction: null,
to_account_id: null, from_account_id: null, created_at: createdAt, updated_at: null,
```

`admin_api_tokens.scopes`, `app_settings.value`, `notifications.data_json`, and `deleted_users.details_json` store JSON as text.

```js
// backend/src/controllers/adminController.js:410-414
INSERT INTO app_settings (key, value, updated_at, updated_by)
VALUES (?, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
```

`webhooks.secret` stores an encrypted secret string after migration, not the plaintext secret implied by the column name.

```js
// backend/database/db.js:774-778
const webhookRows = db.prepare('SELECT id, secret FROM webhooks WHERE secret IS NOT NULL AND secret != \'\'').all();
const updateWebhookSecret = db.prepare('UPDATE webhooks SET secret = ?, updated_at = COALESCE(updated_at, ?) WHERE id = ?');
if (!isEncryptedSecret(row.secret)) {
  updateWebhookSecret.run(encryptSecret(row.secret), timestampNow(), row.id);
}
```

## 8. NULL vs 0 vs Empty String Inconsistencies

Text fields `transactions.description` and `transactions.note` convert empty strings to `NULL`.

```js
// backend/src/controllers/transactionController.js:57-61
function sanitizeText(value) {
  if (typeof value !== 'string') return null;
  const sanitized = value.trim();
  return sanitized || null;
}
```

Search then treats `NULL` as empty text using `COALESCE`, so stored `NULL` and empty search values collapse together.

```js
// backend/src/controllers/transactionController.js:264
where.push('(LOWER(COALESCE(t.description, \'\')) LIKE ? OR LOWER(COALESCE(t.note, \'\')) LIKE ? OR LOWER(COALESCE(t.tags, \'\')) LIKE ?)');
```

`category_id` empty string is coerced to `NULL` on transaction creation, but non-transfer transactions then reject missing category.

```js
// backend/src/controllers/transactionController.js:176-178
const categoryId = req.body.category_id || null;
if (categoryId && !getAllowedCategory(categoryId, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
if (req.body.type !== 'transfer' && !categoryId) return res.status(400).json({ error: 'category_id is required' });
```

`overdraft_limit` treats `null`, empty string, and `false` as no limit, then clamps any provided number to nonnegative cents.

```js
// backend/src/controllers/accountController.js:26-29
function normalizeOverdraftLimit(value) {
  if (value === null || value === '' || value === false) return null;
  return Math.max(amountToCents(value), 0);
}
```

Opening account `balance` treats falsy input as zero before parsing. That means an empty string bypasses `amountToCents('')` validation and becomes `0`.

```js
// backend/src/controllers/accountController.js:95-98
function createAccount(req, res, next) {
  try {
    const initialBalance = amountToCents(req.body.balance || 0);
```

Boolean-like request fields are frequently converted with truthiness, so non-empty strings such as `"false"` would become `1` unless route validation has already normalized/rejected them.

```js
// backend/src/controllers/adminController.js:636-641
const isActive = req.body.is_active ? 1 : 0;
db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive, nowIso(), req.params.id);
```

Counters use `value || 0`, collapsing `NULL`, `0`, and empty string in runtime calculations.

```js
// backend/src/controllers/authController.js:347
const failedAttempts = (user.failed_login_attempts || 0) + 1;
```

`security.normalizeNullableString` treats empty string as `NULL`, but most schema columns are just `TEXT`, so behavior depends on the controller path.

```js
// backend/src/utils/security.js:65
if (value === null || value === undefined || value === '') return null;
```

## 9. Migrations Or Schema Changes With Potentially Breaking Existing-Data Effects

Money migration rewrites five tables and multiplies stored money values by 100 when a money column is not typed as integer. This is destructive if prior integer cents were stored in a non-integer-typed column.

```js
// backend/database/db.js:895-916
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
```

The same cents migration rebuilds `transactions`, `recurring_transactions`, `budgets`, and `deleted_users`.

```js
// backend/database/db.js:951-957
INSERT INTO transactions_money_next
SELECT id, user_id, account_id, category_id, type, ROUND(COALESCE(amount, 0) * 100),
       description, note, date, recurring, recurring_interval, receipt_path, tags,
       transfer_group_id, transfer_direction, to_account_id, from_account_id,
       admin_deleted_at, admin_deleted_by, admin_delete_reason, created_at, updated_at
FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_money_next RENAME TO transactions;

// backend/database/db.js:980-984
INSERT INTO recurring_transactions_money_next
SELECT id, user_id, account_id, category_id, ROUND(COALESCE(amount, 0) * 100),
       description, frequency, next_due_date, last_processed_date, is_active, created_at
FROM recurring_transactions;
DROP TABLE recurring_transactions;
ALTER TABLE recurring_transactions_money_next RENAME TO recurring_transactions;
```

Legacy `transactions.account_id NOT NULL` migration rebuilds transactions and drops the old table. Its replacement schema in that block does not include later admin-delete columns, so running it on an unexpected mixed schema could lose those columns.

```js
// backend/database/db.js:525-565
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
      updated_at TEXT
    );
    DROP TABLE transactions;
    ALTER TABLE transactions_next RENAME TO transactions;
  `);
}
```

Previously soft-deleted/anonymized users are purged on startup based on email/name patterns, with related audit logs deleted first.

```js
// backend/database/db.js:469-493
SELECT id, email, full_name
FROM users
WHERE email LIKE 'deleted-user-%@deleted.local'
   OR full_name LIKE 'Deleted User %'
DELETE FROM audit_logs
WHERE user_id = @id
  OR entity_id = @id
  OR old_value LIKE @email
  OR new_value LIKE @email
DELETE FROM users WHERE id = ?
```

Email verification backfill marks every existing user as verified by setting `email_verified_at = created_at` when adding the column.

```js
// backend/database/db.js:441-442
db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
db.prepare('UPDATE users SET email_verified_at = COALESCE(created_at, ?) WHERE email_verified_at IS NULL').run(timestampNow());
```

Transfer metadata migration reads old metadata from `transactions.tags`, moves transfer fields into columns, then rewrites `tags` to `metadata.values` or an empty array.

```js
// backend/database/db.js:611-642
SELECT id, tags
FROM transactions
WHERE type = 'transfer'
  AND tags IS NOT NULL
  AND (transfer_group_id IS NULL OR transfer_direction IS NULL OR to_account_id IS NULL OR from_account_id IS NULL)
tags = JSON.stringify(Array.isArray(metadata.values) ? metadata.values : Array.isArray(metadata) ? metadata : []);
```

Duplicate categories are merged by lowercased name/type, transaction and budget references are rewritten, and duplicate category rows are deleted.

```js
// backend/database/db.js:644-662
SELECT user_id, LOWER(name) AS normalized_name, type, GROUP_CONCAT(id) AS ids
FROM categories
WHERE user_id IS NOT NULL
GROUP BY user_id, LOWER(name), type
HAVING COUNT(*) > 1
UPDATE transactions SET category_id = ?
UPDATE budgets SET category_id = ?
DELETE FROM categories WHERE id = ?
```

Duplicate active accounts are silently deactivated, keeping the earliest active account for `(user_id, type, name)`.

```js
// backend/database/db.js:665-681
SELECT user_id, type, name
FROM accounts
WHERE is_active = 1
GROUP BY user_id, type, name
HAVING COUNT(*) > 1
UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?
```

Default category seeding deduplicates default global categories and rewrites references.

```js
// backend/database/db.js:827-858
SELECT id, name, type
FROM categories
WHERE is_default = 1 AND user_id IS NULL
UPDATE transactions SET category_id = ?
UPDATE budgets SET category_id = ?
DELETE FROM categories WHERE id = ?
```

Webhook secrets are encrypted in place on startup.

```js
// backend/database/db.js:774-778
if (!isEncryptedSecret(row.secret)) {
  updateWebhookSecret.run(encryptSecret(row.secret), timestampNow(), row.id);
}
```

## 10. Main Gotchas

Money is cents in SQLite but decimals in API responses. The schema names do not say cents; the conversion lives in `backend/src/utils/money.js:35-78`.

`accounts.balance` is not authoritative in a relational sense. It is denormalized and can diverge from the transaction-derived balance; the app logs mismatch warnings (`backend/src/utils/accountBalance.js:32-47`) but does not auto-reconcile.

Transfers are not a single row. A transfer is two `transactions` rows with one `transfer_group_id`; `to_account_id` and `from_account_id` look like FKs but are unconstrained text columns (`backend/database/db.js:156-160`).

Category ownership is only partly relational. `categories.user_id IS NULL` means global category, so code checks `(user_id = ? OR user_id IS NULL)` in several places. The DB cannot prevent a transaction from pointing at another user's category if written outside the controller.

Inactive categories can still be assigned to transactions and budgets because validation omits `is_active = 1` (`backend/src/controllers/transactionController.js:54-56`, `backend/src/controllers/budgetController.js:18-20`).

There are three deletion models: normal account delete is soft (`accounts.is_active = 0`), admin transaction delete is soft (`transactions.admin_deleted_at`), and many other deletes are hard deletes that rely on FK cascades or manual cleanup.

User self-delete anonymizes and deactivates the user row after deleting child financial data (`backend/src/controllers/authController.js:1039-1050`), while admin hard-delete archives to `deleted_users` and then deletes the `users` row (`backend/src/controllers/adminController.js:795-837`).

API tokens are tied to their creator with `created_by`, but authentication does not check that creator's `is_active` flag (`backend/src/middleware/auth.js:17-24`).

Admin user summary and export paths intentionally or accidentally include soft-deleted transaction/account data where normal user APIs exclude it (`backend/src/controllers/adminController.js:586-587`, `backend/src/controllers/authController.js:961-962`).

Startup migrations do real data cleanup and rewriting, not just schema changes: they purge legacy deleted users, merge duplicate categories, deactivate duplicate accounts, encrypt webhook secrets, and convert money values to cents.
