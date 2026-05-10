# FinanceApp Complete Deep Technical Audit

Generated on 2026-05-10 from `C:\Users\bemat\OneDrive\Desktop\FinanceApp`.
All paths below are real repository paths. Secret values from local `.env` files are intentionally not printed; environment-variable behavior is traced from code and `.env.example`.

## SECTION 1 - PROJECT MAP

### 1.1 Every top-level directory and responsibility

| Path | Responsibility | Evidence |
|---|---|---|
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\.github` | GitHub automation. One workflow exists: `.github\workflows\ci.yml`. | `rg --files .github` returned `.github\workflows\ci.yml`. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend` | Express API, SQLite database bootstrap/migrations, controllers, middleware, utilities, tests, package metadata. | Routes mounted in `backend\src\app.js:195-201`. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\docs` | Existing audit/reference documents plus this audit. | Existing files: `docs\CODEBASE_TECHNICAL_AUDIT.md`, `docs\CODEBASE_SUPPLEMENTAL_MISSED_ITEMS.md`. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\mobile` | Expo React Native frontend, Redux store, services, screens, navigation, assets. | `mobile\package.json:1-61`, `mobile\App.tsx`, `mobile\src\...`. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\shared` | Present but no files found by `rg --files`; no current shared contracts. | `rg --files shared` returned no files. |

Route mounting:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\app.js:195-201
195:app.use('/api/auth', authRoutes);
196:app.use('/api/accounts', accountRoutes);
197:app.use('/api/transactions', transactionRoutes);
198:app.use('/api/budgets', budgetRoutes);
199:app.use('/api/categories', categoryRoutes);
200:app.use('/api/announcements', announcementRoutes);
201:app.use('/api/admin', adminRoutes);
```

### 1.2 Every business-logic, calculation, or database-operation file

| Path | One-line description |
|---|---|
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js` | Opens SQLite, sets pragmas, creates/migrates all tables and indexes, seeds default categories/admin/cash accounts, migrates money columns to cents. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\app.js` | Express middleware, route mounting, health check, client-error endpoint, final error handler. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\server.js` | Environment validation, startup, cleanup jobs, recurring processing, backups. |
| `backend\src\controllers\authController.js` | Registration, login, refresh/logout, password reset, email verification, sessions, profile, data export/delete/account delete, push/notification settings. |
| `backend\src\controllers\accountController.js` | Account CRUD, opening-balance transaction creation, user account deletion with transaction delete/cash move paths. |
| `backend\src\controllers\transactionController.js` | Transaction CRUD, transfer pair creation/update/delete, stored balance deltas, summaries, bulk changes. |
| `backend\src\controllers\budgetController.js` | Budget CRUD, overlap/date validation, budget spending/remaining/percent calculations. |
| `backend\src\controllers\categoryController.js` | Category CRUD, reordering, duplicate-name checks. |
| `backend\src\controllers\announcementController.js` | Active announcements and user dismissals. |
| `backend\src\controllers\adminController.js` | Admin dashboard, users, audit logs, global/user transactions, admin soft-delete, account management, balance corrections, reports, announcements, API tokens, webhooks, security blocks. |
| `backend\src\middleware\auth.js` | JWT/admin API-token authentication, active-user check, security-stamp check, admin role/scope checks. |
| `backend\src\middleware\csrfProtection.js` | Double-submit CSRF token generation/validation. |
| `backend\src\middleware\securityMonitor.js` | Request scanning, security strike/block state, security audit logs. |
| `backend\src\utils\money.js` | Storage/display money conversion, balance delta, boolean/tag/money response serialization. |
| `backend\src\utils\accountBalance.js` | Derived account-balance SQL expression and mismatch logger. |
| `backend\src\utils\defaultAccount.js` | Creates/gets default cash account. |
| `backend\src\utils\security.js` | JWT creation, bcrypt password hashing, token hashing, webhook secret encryption, user sanitization. |
| `backend\src\utils\accessTokenBlocklist.js` | Access-token logout/blocklist persistence. |
| `backend\src\utils\recurringProcessor.js` | Processes due recurring rules into transactions and balance updates. |
| `backend\src\utils\pushNotifications.js` | Notification preference rows, Expo push delivery, invalid-token cleanup. |
| `backend\src\utils\passwordResetDelivery.js` | Email/webhook delivery for reset, verification, temporary-password flows. |
| `backend\src\utils\backup.js` | SQLite backup file creation/retention timestamp. |
| `backend\src\utils\audit.js` | Audit value redaction/serialization. |
| `backend\src\utils\clientIp.js` | Trusted proxy/client IP extraction. |
| `backend\src\utils\pagination.js` | Pagination input and response metadata. |
| `backend\src\utils\logger.js` | Winston logging and sanitization. |
| `backend\src\utils\urlSafety.js` | Webhook URL SSRF/private-host validation. |
| `mobile\src\services\api.ts` | Axios client, auth header injection, offline mutation rejection, retry and refresh-token queue. |
| `mobile\src\services\secureStorage.ts` | SecureStore token/user persistence. |
| `mobile\src\utils\offlineQueue.ts` | AsyncStorage mutation queue. |
| `mobile\src\store\slices\*.ts` | Redux state/thunks for auth, accounts, transactions, budgets, admin. |
| `mobile\src\screens\dashboard\DashboardScreen.tsx` | Fetches account/budget/summary/announcement data and computes net worth/monthly change locally. |
| `mobile\src\screens\dashboard\OverviewScreen.tsx` | Computes total assets, credit, net worth, savings rate, budget usage, cashflow averages locally. |
| `mobile\src\screens\reports\ReportsScreen.tsx` | Fetches transactions and recomputes income/expense/net/category/trend charts and exports locally. |
| `mobile\src\screens\budget\BudgetsScreen.tsx` | Budget list, budget aggregate totals, daily breakdown fetch, budget creation. |
| `mobile\src\screens\budget\BudgetDetailScreen.tsx` | Budget detail fetch and local fallback calculations. |
| `mobile\src\screens\transactions\*.tsx` | Transaction create/edit/detail/list UI validation and local display formatting. |
| `mobile\src\screens\accounts\*.tsx` | Account CRUD UI and balance display. |
| `mobile\src\screens\admin\*.tsx` | Admin dashboard/users/transactions/audit/deleted-user/system-health screens. |
| `mobile\src\utils\notifications.ts` | Local notification-card calculations for budgets, large transactions, recurring transactions. |
| `mobile\src\utils\formatters.ts` | Client-side currency/date/percent formatting. |
| `mobile\src\utils\numberInput.ts` | Client-side money input sanitization/parsing. |

### 1.3 External libraries used beyond basic utilities

Backend dependencies from `backend\package.json:15-35`:

```json
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\package.json:15-35
"bcryptjs": "^3.0.3",
"better-sqlite3": "^12.9.0",
"compression": "^1.8.1",
"cors": "^2.8.6",
"dotenv": "^17.4.2",
"express": "^4.22.1",
"express-mongo-sanitize": "^2.2.0",
"express-rate-limit": "^8.4.1",
"express-validator": "^7.3.2",
"helmet": "^8.1.0",
"hpp": "^0.2.3",
"jsonwebtoken": "^9.0.3",
"morgan": "^1.10.1",
"nodemailer": "^8.0.7",
"uuid": "^14.0.0",
"swagger-jsdoc": "^6.2.8",
"swagger-ui-express": "^5.0.1",
"winston": "^3.19.0",
"winston-daily-rotate-file": "^5.0.0"
```

Uses:

| Package | Use |
|---|---|
| `better-sqlite3` | Synchronous SQLite DB access and transactions. Evidence: `backend\database\db.js:4`, `db.prepare(...)` throughout controllers. |
| `bcryptjs` | Password hashing/verification. Evidence: `backend\src\utils\security.js:18-24`. |
| `jsonwebtoken` | Access-token sign/verify. Evidence: `backend\src\utils\security.js:26-42`, `backend\src\middleware\auth.js:73-79`. |
| `express-validator` | Route request validation. Evidence: route files, e.g. `backend\src\routes\transactionRoutes.js:18-84`. |
| `express-rate-limit` | Global/auth/admin/client-error rate limits. Evidence: `backend\src\app.js:61-88`, `backend\src\routes\authRoutes.js:10-53`, `backend\src\routes\adminRoutes.js:146-160`. |
| `helmet`, `cors`, `hpp`, `express-mongo-sanitize`, `compression`, `morgan` | HTTP security headers, CORS, parameter pollution protection, input key sanitization, response compression, request logging. Evidence: `backend\src\app.js:134-171`. |
| `nodemailer` | SMTP delivery. Evidence: `backend\src\utils\passwordResetDelivery.js:83-108`. |
| `winston`, `winston-daily-rotate-file` | Logs. Evidence: `backend\src\utils\logger.js`. |
| `swagger-jsdoc`, `swagger-ui-express` | Dev-only API docs. Evidence: `backend\src\app.js:203-217`. |

Mobile dependencies from `mobile\package.json:15-47` include:

| Package | Use |
|---|---|
| `axios` | API calls and refresh retry queue. Evidence: `mobile\src\services\api.ts:43-148`. |
| `@reduxjs/toolkit`, `react-redux` | App state/thunks. Evidence: `mobile\src\store\slices\*.ts`. |
| `expo-secure-store`, `react-native-keychain`, `expo-local-authentication` | Token/settings storage and biometric UI gate. Evidence: `mobile\src\services\secureStorage.ts`, `mobile\src\services\biometrics.ts`. |
| `@react-native-async-storage/async-storage` | Offline mutation queue. Evidence: `mobile\src\utils\offlineQueue.ts:1-61`. |
| `@react-navigation/*` | Navigation/deep links. Evidence: `mobile\src\navigation\index.tsx`, `mobile\src\navigation\deepLinks.ts`. |
| `date-fns` | Formatting/date range helpers. Evidence: `mobile\src\utils\formatters.ts:1`, `mobile\src\screens\reports\ReportsScreen.tsx`. |
| `expo-notifications` | Push notification registration. Evidence: `mobile\src\services\pushNotifications.ts`. |
| `expo-file-system`, `expo-print`, `expo-sharing` | CSV/PDF export/share. Evidence: `mobile\src\screens\reports\ReportsScreen.tsx`, `mobile\src\screens\profile\SettingsScreen.tsx`. |
| `react-native-chart-kit`, `react-native-svg` | Charts. Evidence: `mobile\src\components\charts\*.tsx`. |
| `yup`, `react-hook-form`, `@hookform/resolvers` | Form validation in auth/profile screens. |

### 1.4 Environment variables and failure modes

Primary example file:

```env
# C:\Users\bemat\OneDrive\Desktop\FinanceApp\.env.example:1-31
JWT_SECRET=replace-with-at-least-32-bytes-of-random-secret
DB_PATH=./backend/database/financeapp.db
PORT=3000
TRUST_PROXY_HOPS=1
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=replace-with-password-hash
SMTP_HOST=smtp.example.com
...
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
EXPO_PUBLIC_API_CERT_HASH=sha256/replace-with-pinned-cert-hash
```

Backend env handling:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\server.js:10-18
10:  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
11:  process.env.PORT = process.env.PORT || (process.env.NODE_ENV === 'test' ? '0' : '3000');
12:  process.env.REQUIRE_CSRF = process.env.REQUIRE_CSRF || 'true';
13:  process.env.DELETED_USER_ARCHIVE_DAYS = process.env.DELETED_USER_ARCHIVE_DAYS || '90';
14:  process.env.BACKUP_HOUR = process.env.BACKUP_HOUR || '3';
15:  process.env.BACKUP_RETAIN_DAYS = process.env.BACKUP_RETAIN_DAYS || '7';
17:  if (process.env.NODE_ENV === 'test') {
18:    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
```

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\server.js:24-39
24:    if (!process.env[name]) errors.push(`${name} is required`);
27:  if (process.env.JWT_SECRET) {
29:      assertJwtSecret(process.env.JWT_SECRET);
35:  if (process.env.JWT_REFRESH_SECRET && Buffer.byteLength(process.env.JWT_REFRESH_SECRET, 'utf8') < 32) {
39:  if (!['development', 'test', 'production'].includes(process.env.NODE_ENV)) {
```

| Variable | Code path | What breaks if missing/wrong |
|---|---|---|
| `JWT_SECRET` | `backend\src\server.js:24-31`, `backend\src\utils\security.js:9-16`, `backend\src\middleware\auth.js:77` | Startup validation fails if absent/weak in server startup; JWT signing/verifying fails if wrong. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | `backend\src\utils\security.js:38-39`, `backend\src\middleware\auth.js:74-75` | Tokens signed with issuer/audience are rejected if verification env differs. |
| `JWT_REFRESH_SECRET` | `backend\src\server.js:18,35` | Only length-validated; refresh tokens are random opaque values hashed with `hashToken`, not JWT refresh tokens. |
| `DB_PATH` | `backend\database\db.js:18-44` | Defaults to `backend\database\finance.db`; if path resolves outside backend root, module throws. |
| `PORT` | `backend\src\server.js:43-47,90` | Invalid/non-positive port fails validation or server binds wrong port. |
| `NODE_ENV` | Many files | Controls test skips, production HTTPS warning, Swagger availability, token-in-response behavior. Invalid value fails validation. |
| `TRUST_PROXY_HOPS` | `backend\src\app.js:90-103` | Missing in production throws; invalid value throws; wrong value affects `req.ip` and security/rate limiting. |
| `REQUIRE_CSRF`, `CSRF_SECRET` | `backend\src\server.js:48-51`, `backend\src\middleware\csrfProtection.js:38-98` | Invalid `REQUIRE_CSRF` fails validation; wrong secret invalidates CSRF tokens. |
| `MOBILE_APP_ORIGIN` | `backend\src\app.js:37-53`, `backend\src\server.js:58-64` | Wrong/missing origin blocks browser CORS except same/no-origin and test localhost. |
| `REQUIRE_HTTPS` | `backend\src\app.js:117-130` | Only affects production HTTPS warning detection; it does not enforce HTTPS. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` | `backend\database\db.js:1067-1085` | Missing means no seeded admin; wrong hash means seeded admin cannot log in with expected password. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_TLS_REJECT_UNAUTHORIZED`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `SMTP_FROM` | `backend\src\server.js:66-77`, `backend\src\utils\passwordResetDelivery.js:80-111` | Missing SMTP host disables SMTP delivery; partial credentials fail validation; bad SMTP causes reset/verification/temp-password delivery failures. |
| `PASSWORD_RESET_URL`, `EMAIL_VERIFICATION_URL`, `APP_WEB_FALLBACK_URL` | `backend\src\utils\passwordResetDelivery.js:37-76`, `backend\src\controllers\adminController.js:438` | Missing URLs fall back to app/web default; insecure non-local HTTP rejected outside development/test by `assertSecureDeliveryUrl`. |
| `PASSWORD_RESET_WEBHOOK_URL`, `EMAIL_VERIFICATION_WEBHOOK_URL` | `backend\src\utils\passwordResetDelivery.js:214-266` | If set, token delivery can go to webhook; unsafe URL fails URL-safety checks. |
| `ALLOW_RESET_TOKEN_IN_RESPONSE`, `ALLOW_VERIFICATION_TOKEN_IN_RESPONSE` | `backend\src\controllers\authController.js:124-151` | In development/test only, controls raw token inclusion in API responses. |
| `REQUIRE_EMAIL_VERIFICATION` | `backend\src\controllers\authController.js:157-160` | In non-test defaults to required unless explicitly `false`; blocks login until verified. |
| `DELETED_USER_ARCHIVE_DAYS` | `backend\database\db.js:802-810`, `backend\src\server.js:53-56` | Invalid uses 90 in DB helper but server validation rejects non-positive/non-numeric. |
| `BACKUP_HOUR`, `BACKUP_DIR`, `BACKUP_RETAIN_DAYS` | `backend\src\server.js:148`, `backend\src\utils\backup.js:8-17` | Controls scheduled backup time, directory, retention; bad directory can make backups fail. |
| `GLOBAL_RATE_LIMIT_WINDOW_MS`, `GLOBAL_RATE_LIMIT_MAX` | `backend\src\app.js:61-68` | Invalid/non-number silently falls back through `Number(...) || default`. |
| `LOGIN_LOCK_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | `backend\src\controllers\adminController.js:434-435` | Exposed in system config response; actual login constants are code constants in auth controller. |
| `LARGE_TRANSACTION_AMOUNT` | `backend\src\controllers\transactionController.js:244` | Converted by `amountToCents`; invalid value makes transaction creation fail while sending large-transaction notification threshold. |
| `SECURITY_STRIKE_WINDOW_MS`, `SECURITY_STRIKE_LIMIT`, `SECURITY_BLOCK_MS`, `TRUSTED_PROXIES` | `backend\src\middleware\securityMonitor.js:15-17`, `backend\src\utils\clientIp.js:10` | Controls security blocking and client IP trust; invalid numeric values fall back with `||`. |
| `LOG_LEVEL` | `backend\src\utils\logger.js:73` | Controls Winston log level. |
| `WEBHOOK_SECRET_KEY` | `backend\src\utils\security.js:52-59` | Missing falls back to `JWT_SECRET`; changing it prevents decrypting previously encrypted webhook secrets. |
| `MIN_APP_VERSION` | `backend\src\app.js:238-239` | Health endpoint reports min supported version. |
| `EXPO_PUBLIC_API_BASE_URL` | `mobile\src\constants\index.ts:16` | Missing uses platform default; wrong URL breaks all mobile API calls. |
| `EXPO_PUBLIC_API_CERT_HASH` | `mobile\src\services\api.ts:51-61` | Missing disables pinning; production only warns if pinning module/config is absent. |
| `EXPO_PUBLIC_SUPPORT_EMAIL`, `EXPO_PUBLIC_APP_STORE_URL`, `EXPO_PUBLIC_PLAY_STORE_URL` | `mobile\src\constants\index.ts:17`, `mobile\App.tsx:170-171,335` | Missing support/store links are blank/no-op. |

### 1.5 Configuration files and controls

| Path | Controls |
|---|---|
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\.env.example` | Documented backend/mobile env variables. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\.env` | Local backend env; values not printed. Loaded by `backend\database\db.js:8-16` and `backend\src\app.js:26-30`. |
| `C:\Users\bemat\OneDrive\Desktop\FinanceApp\mobile\.env` | Local Expo env; values not printed. |
| `backend\package.json` | Backend scripts/dependencies. |
| `backend\package-lock.json` | Locked backend dependency tree. |
| `mobile\package.json` | Mobile scripts/dependencies. |
| `mobile\package-lock.json` | Locked mobile dependency tree. |
| `mobile\app.json` | Expo app metadata/assets. |
| `mobile\eas.json` | EAS build profiles. |
| `mobile\tsconfig.json` | TypeScript compiler settings. |
| `.github\workflows\ci.yml` | CI behavior. |
| `.gitignore`, `mobile\.gitignore` | Git exclusion rules. |

## SECTION 2 - DATABASE SCHEMA & RELATIONSHIPS

### 2.1 Every table, columns, constraints, defaults, indexes

SQLite opens with foreign keys on:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:48-54
48:const db = new Database(dbPath);
49:db.pragma('journal_mode = WAL');
50:db.pragma('foreign_keys = ON');
51:db.pragma('busy_timeout = 5000');
52:db.pragma('synchronous = NORMAL');
53:db.pragma('cache_size = -64000');
54:db.pragma('temp_store = MEMORY');
```

Full schema definitions:

```sql
-- C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:87-111
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
```

```sql
-- C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:113-172
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
```

```sql
-- C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:174-234
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
```

```sql
-- C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:236-315
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
```

```sql
-- C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:317-384
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
```

Indexes:

```sql
-- C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:386-428
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
CREATE INDEX IF NOT EXISTS idx_transactions_account_user_deleted_date ON transactions(account_id, user_id, admin_deleted_at, date, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user_transfer_group ON transactions(user_id, transfer_group_id, admin_deleted_at);
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_access_token_blocklist_expires ON access_token_blocklist(expires_at);
CREATE INDEX IF NOT EXISTS idx_deleted_users_deleted_at ON deleted_users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_deleted_users_email ON deleted_users(email);
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
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
```

Extra unique/late indexes:

```sql
-- C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:698-721
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group_id ON transactions(transfer_group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_direction ON transactions(transfer_direction);
CREATE INDEX IF NOT EXISTS idx_transactions_admin_deleted ON transactions(admin_deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_active_user_type_name
  ON accounts(user_id, type, name)
  WHERE is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_type_nocase
  ON categories(user_id, name COLLATE NOCASE, type)
  WHERE user_id IS NOT NULL;
```

### 2.2 Every foreign key relationship

Enforced by SQLite because `PRAGMA foreign_keys = ON` is executed at `backend\database\db.js:50`.

| Table.column | References | Action | Enforced |
|---|---|---|---|
| `categories.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `accounts.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `transactions.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `transactions.account_id` | `accounts.id` | `ON DELETE SET NULL` | DB |
| `transactions.category_id` | `categories.id` | `ON DELETE SET NULL` | DB |
| `transactions.admin_deleted_by` | `users.id` | `ON DELETE SET NULL` | DB |
| `recurring_transactions.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `recurring_transactions.account_id` | `accounts.id` | `ON DELETE CASCADE` | DB |
| `recurring_transactions.category_id` | `categories.id` | `ON DELETE SET NULL` | DB |
| `notifications.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `push_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `notification_preferences.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `budgets.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `budgets.category_id` | `categories.id` | `ON DELETE SET NULL` | DB |
| `refresh_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `password_reset_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `email_verification_tokens.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `audit_logs.user_id` | `users.id` | `ON DELETE SET NULL` | DB |
| `deleted_users.deleted_by` | `users.id` | `ON DELETE SET NULL` | DB |
| `app_settings.updated_by` | `users.id` | `ON DELETE SET NULL` | DB |
| `announcements.created_by` | `users.id` | `ON DELETE SET NULL` | DB |
| `announcement_dismissals.announcement_id` | `announcements.id` | `ON DELETE CASCADE` | DB |
| `announcement_dismissals.user_id` | `users.id` | `ON DELETE CASCADE` | DB |
| `admin_api_tokens.created_by` | `users.id` | `ON DELETE SET NULL` | DB |
| `webhooks.created_by` | `users.id` | `ON DELETE SET NULL` | DB |
| `webhook_deliveries.webhook_id` | `webhooks.id` | `ON DELETE CASCADE` | DB |

Code-only relationships:

| Relationship | Evidence |
|---|---|
| Transfer pair via `transactions.transfer_group_id` and `transfer_direction`; no FK/unique constraint enforces exactly two sides. | Created at `transactionController.js:211-227`; update/delete require two rows at `transactionController.js:336-340` and `393-398`. |
| `transactions.to_account_id` and `from_account_id` point to accounts but have no FK. | Columns declared without FK at `db.js:161-162`; updated as account IDs at `accountController.js:84-87`. |
| Global/default categories have `categories.user_id IS NULL`; user categories use `user_id`. | `db.js:113-127`; allowed by `getAllowedCategory` at `transactionController.js:62-64`. |

### 2.3 Soft-delete patterns and query coverage

Soft-delete columns:

| Table | Column | Meaning |
|---|---|---|
| `transactions` | `admin_deleted_at` plus `admin_deleted_by`, `admin_delete_reason` | Admin deletion hides transaction while retaining row. |
| `accounts` | `is_active` | User account delete deactivates; admin account delete hard-deletes. |
| `categories` | `is_active` | Default/user category visibility flag. User delete hard-deletes currently. |
| `users` | `is_active` and anonymized email/full name | User/admin delete deactivates/anonymizes or archives; not a simple deleted_at soft delete. |
| `refresh_tokens` | `revoked` | Revoked session/token rows remain until cleanup. |
| `announcements`, `admin_api_tokens`, `webhooks`, `recurring_transactions`, `security_ip_blocks.blocked_until` | Status/active/revoked flags | Not financial soft-delete but visibility/state flags. |

Queries correctly filtering `transactions.admin_deleted_at IS NULL`:

```js
// transactionController.js
128:WHERE t.id = ? AND t.user_id = ? AND t.admin_deleted_at IS NULL
262:const where = ['t.user_id = ?', 't.admin_deleted_at IS NULL'];
294:WHERE t.id = ? AND t.user_id = ? AND t.admin_deleted_at IS NULL
307:SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL
384:SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL
416:const where = ['t.user_id = ?', 't.admin_deleted_at IS NULL'];
476:SELECT * FROM transactions WHERE user_id = ? AND admin_deleted_at IS NULL AND id IN (...)
528:SELECT id, category_id FROM transactions WHERE user_id = ? AND admin_deleted_at IS NULL AND id IN (...)
```

```js
// accountController.js
40:SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL
48:AND admin_deleted_at IS NULL
77:SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL
82:UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL
163:WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL ORDER BY date DESC
210:SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL
```

```js
// budgetController.js
139:AND t.admin_deleted_at IS NULL
162:AND admin_deleted_at IS NULL
168:AND admin_deleted_at IS NULL
```

```js
// accountBalance.js
23:    AND t.admin_deleted_at IS NULL
```

Queries missing or intentionally not filtering `transactions.admin_deleted_at`:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\controllers\authController.js:967
967:      transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(userId),
```

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\controllers\adminController.js:463-477
463:    const transactionTotals = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS sum FROM transactions WHERE admin_deleted_at IS NULL').get();
468:    const newTransactionsThisMonth = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE created_at >= ?').get(monthStart).count;
469:    const topCategories = db.prepare(`
473:      WHERE t.type = 'expense'
```

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\controllers\adminController.js:499-504
499:    const rows = db.prepare(`
500:      SELECT substr(date, 1, 10) AS date, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
501:      FROM transactions
502:      WHERE date >= ?
503:      GROUP BY substr(date, 1, 10)
```

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\controllers\adminController.js:920-953
920:    const where = ['t.user_id = ?'];
953:    const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${whereSql}`).get(...params).count;
```

Admin global transactions apply optional filters:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\controllers\adminController.js:1188-1190
1188:    if (req.query.admin_deleted === 'true') where.push('t.admin_deleted_at IS NOT NULL');
1189:    else if (req.query.admin_deleted === 'false') where.push('t.admin_deleted_at IS NULL');
1190:    else if (req.query.include_deleted !== 'true') where.push('t.admin_deleted_at IS NULL');
```

### 2.4 Stored columns that can become out of sync with derived values

`accounts.balance` is a stored integer-cents balance, but current balance is derivable from `transactions`.

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\utils\accountBalance.js:12-24
12:function accountCurrentBalanceExpr(accountAlias = 'accounts') {
13:  return `COALESCE((
14:  SELECT SUM(CASE
15:    WHEN t.type = 'income' THEN t.amount
16:    WHEN t.type = 'expense' THEN -t.amount
17:    WHEN t.type = 'transfer' AND ${transferDestinationPredicate('t')} THEN t.amount
18:    ELSE -t.amount
19:  END)
20:  FROM transactions t
21:  WHERE t.account_id = ${accountAlias}.id
22:    AND t.user_id = ${accountAlias}.user_id
23:    AND t.admin_deleted_at IS NULL
24:), 0)`;
```

Mismatch logger:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\utils\accountBalance.js:32-49
32:function warnIfAccountBalanceMismatch(account, context = {}) {
35:  const balance = Number(account.balance);
36:  const currentBalance = Number(account.current_balance);
39:  const difference = balance - currentBalance;
40:  if (Math.abs(difference) > 0) {
41:    logger.warn('Account balance mismatch', {
```

Stored balance is updated separately from transaction rows:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\controllers\transactionController.js:104-109
104:function updateBalance(accountId, userId, delta) {
108:  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
```

Other denormalized columns:

| Column | Derived from | Stored/derived mismatch path |
|---|---|---|
| `deleted_users.account_count`, `transaction_count`, `budget_count`, `total_account_balance`, `transaction_total`, `details_json` | User data at deletion time | Snapshot rows are not kept in sync after deletion. Schema at `db.js:289-307`; money migration at `db.js:1033-1062`. |
| `notifications.data_json` | Event payload | Stored JSON does not track changed source entity. Schema at `db.js:191-201`. |
| `admin_api_tokens.last_used_at` | API-token usage | Written with process-local 60s debounce, so not exact. `auth.js:11-39`. |

### 2.5 NULL, 0, and empty-string columns and consistency

| Column | NULL | 0 | Empty string | Observed treatment |
|---|---|---|---|---|
| `transactions.category_id` | Allowed for transfer/opening-balance/admin correction. | Not used. | Request empty treated missing. | Create requires category unless transfer at `transactionRoutes.js:68-74` and `transactionController.js:186-188`; account opening uses `NULL` at `accountController.js:126-127`; admin correction uses null at `adminController.js:1378`. |
| `transactions.account_id` | Allowed by schema; create defaults to cash if missing. | Not used. | Request empty falls through to default cash. | `transactionRoutes.js:66`; `transactionController.js:182-184`. |
| `transactions.recurring` | Schema default 0. | False. | `parseBoolField` maps falsy to 0. | `money.js:35-39`. |
| `accounts.overdraft_limit` | `null` means no limit. | Zero means no overdraft below 0. | Empty string normalized to null. | `accountController.js:26-29`; `assertBalanceAllowed` treats null as no limit at `transactionController.js:94-101`. |
| `accounts.balance` | Defaults 0, not nullable by code assumptions though schema has no NOT NULL. | Valid balance. | Not used. | `createAccount` stores cents at `accountController.js:98-123`. |
| `budgets.end_date` | Null means open-ended. | Not used. | Request empty converted to null by optional validation and normalization. | `budgetRoutes.js:30,38`; `budgetController.js:52-70`. |
| `users.email_verified_at` | Null means unverified. | Not used. | Migration fills missing historical values. | `authController.js:318-331`; `db.js:446-449`. |
| `refresh_tokens.revoked` | Defaults 0. | Active. | Not used. | Active sessions filter `revoked = 0` at `authController.js:868-872`. |

### 2.6 WHERE/JOIN columns without supporting indexes

Confirmed missing or weak indexes based on schema indexes in `db.js:386-428,698-721` and query sites:

| Table.column used in WHERE/JOIN | Query evidence | Index status |
|---|---|---|
| `transactions.created_at` filtered with `admin_deleted_at` absent in index order | `adminController.js:468` | `idx_transactions_created_at` exists, but query also needs deleted filter and does not apply it. |
| `transactions.type` alone | `adminController.js:473`, `reports.js` equivalents | Covered only in composite `idx_txn_budget_lookup(user_id, category_id, type, admin_deleted_at, date)` when leading columns used; no standalone type index. |
| `transactions.description`, `note`, `tags` LIKE search | `transactionController.js:273-276`, `adminController.js:1197-1200` | No text index/full-text index. |
| `categories.is_default`, `categories.user_id IS NULL`, `name`, `type` | `db.js:853-867`, admin default category paths | Unique partial index excludes `user_id IS NULL`; only `idx_categories_user_id`. |
| `refresh_tokens.family_id` | Migration adds `idx_refresh_tokens_family_id` at `db.js:509-513`; not in initial index block. | Present after `ensureSchemaUpdates`. |
| `admin_api_tokens.created_by`, `is_active`, `revoked_at` | `auth.js:18-27`; admin token listing | No index except unique `token_hash`. |
| `webhooks.event`, `webhooks.is_active` | Delivery/listing paths in `adminController.js` and delivery utility | No index. |
| `notifications.read_at` | Notification listing likely orders by created/user; no index on unread. | No `read_at` index. |

### 2.7 Column names whose units/formats are misleading

| Column | Stored value | Why surprising |
|---|---|---|
| `accounts.balance` | Integer cents | API returns dollars through `serializeMoney`; name does not say cents. |
| `accounts.overdraft_limit` | Integer cents or NULL | API returns dollars. |
| `transactions.amount` | Absolute integer cents, not signed | Sign comes from `type` and `transfer_direction`; API returns positive dollars. |
| `budgets.amount`, `current_spending`, `remaining` | Integer cents in SQL; API dollars after serialization | Names do not say cents. |
| `deleted_users.total_account_balance`, `transaction_total` | Integer cents | Snapshot aggregate values are serialized as money if returned. |
| All `*_at`, `date`, `start_date`, `end_date` | ISO strings/text | SQLite `TEXT`, not real date type. |
| `tags`, `data_json`, `old_value`, `new_value`, `details_json`, `scopes` | JSON encoded text | No JSON type/constraint. |

Money serialization keys:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\utils\money.js:1-22
1:const MONEY_RESPONSE_KEYS = new Set([
2:  'amount',
3:  'balance',
4:  'overdraft_limit',
5:  'current_balance',
6:  'current_spending',
7:  'remaining',
8:  'total',
9:  'sum',
10:  'income',
11:  'expense',
12:  'net',
...
20:  'total_account_balance',
21:  'transaction_total',
```

### 2.8 Tables missing expected audit timestamps

| Table | Missing | Evidence |
|---|---|---|
| `categories` | `updated_at` absent | Schema `db.js:113-127`; controller updates category without updated_at at `categoryController.js:88-103`. |
| `recurring_transactions` | `updated_at` absent | Schema `db.js:174-189`. |
| `notifications` | `updated_at` absent | Schema `db.js:191-201`; read changes set `read_at`, not updated_at. |
| `push_tokens` | `updated_at`, `last_used_at` absent | Schema `db.js:203-211`. |
| `access_token_blocklist` | `updated_at` absent | Schema `db.js:283-287`. |
| `announcement_dismissals` | `updated_at` absent | Schema `db.js:330-337`. |
| `webhook_deliveries` | `updated_at`, response body snapshot absent | Schema `db.js:365-374`. |
| `security_ip_blocks` | Has `created_at`, `updated_at` | Correct. |

### 2.9 Schema gotchas

1. `transactions.to_account_id` and `from_account_id` are not foreign keys, so account deletion/move code must keep them coherent (`accountController.js:84-87`, `adminController.js:396-399`).
2. Transfer integrity is code-only: no constraint enforces two rows, opposite directions, or same amount.
3. Money storage is cents, but API response is dollars for matching key names only; a money value under an unlisted key remains cents.
4. `accounts.balance` and derived `current_balance` can diverge; code logs mismatch but does not repair automatically.
5. `categories` has both `UNIQUE(user_id, name, type)` and later case-insensitive partial unique index for non-null user IDs; default categories with `user_id IS NULL` are handled separately.
6. `users` has no `deleted_at`; account deletion anonymizes and deactivates, while `deleted_users` archives hard-deleted/admin-deleted records.

## SECTION 3 - MONEY, CALCULATIONS & DATA FLOW

### 3.1 How money is stored

Money columns are integer cents:

| Table.column | Type | Unit |
|---|---|---|
| `accounts.balance` | `INTEGER DEFAULT 0` | cents |
| `accounts.overdraft_limit` | `INTEGER` | cents |
| `transactions.amount` | `INTEGER NOT NULL CHECK (amount >= 0)` | absolute cents |
| `recurring_transactions.amount` | `INTEGER NOT NULL CHECK (amount > 0)` | cents |
| `budgets.amount` | `INTEGER NOT NULL CHECK (amount >= 0)` | cents |
| `deleted_users.total_account_balance` | `INTEGER DEFAULT 0` | cents |
| `deleted_users.transaction_total` | `INTEGER DEFAULT 0` | cents |

Migration evidence:

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\database\db.js:912-1064
912:function migrateMoneyColumnsToCents() {
914:    if (!isIntegerMoneyTable('accounts', 'balance')) {
932:        SELECT id, user_id, name, type, ROUND(COALESCE(balance, 0) * 100),
941:    if (!isIntegerMoneyTable('transactions')) {
972:        SELECT id, user_id, account_id, category_id, type, ROUND(COALESCE(amount, 0) * 100),
1009:    if (!isIntegerMoneyTable('budgets')) {
1025:        SELECT id, user_id, category_id, ROUND(COALESCE(amount, 0) * 100),
```

### 3.2 Every conversion function between storage and display

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\utils\money.js:41-78
41:function amountToCents(value, { allowZero = true, allowNegative = false } = {}) {
42:  const raw = typeof value === 'string' ? value.trim() : value;
43:  const amount = Number(raw);
44:  if (!Number.isFinite(amount)) {
45:    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
46:  }
47:  if (!/^-?\d+(\.\d+)?$/.test(String(raw))) {
48:    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
49:  }
50:  const sign = amount < 0 ? -1 : 1;
51:  const [intPart, decPart = ''] = String(raw).replace('-', '').split('.');
52:  const centsDigits = decPart.padEnd(3, '0').slice(0, 3);
53:  const roundedCents = parseInt(centsDigits.slice(0, 2), 10) + (Number(centsDigits[2]) >= 5 ? 1 : 0);
54:  const MAX_CENTS = 999_999_999_999_99;
55:  const absCents = BigInt(intPart || '0') * 100n + BigInt(roundedCents);
56:  if (absCents > BigInt(MAX_CENTS)) {
57:    throw Object.assign(new Error('Amount exceeds maximum allowed value'), { statusCode: 400 });
58:  }
59:  const abs = Number(absCents);
60:  if (!allowNegative && sign < 0) {
61:    throw Object.assign(new Error('amount must be a positive number'), { statusCode: 400 });
62:  }
63:  if (abs === 0 && amount !== 0) {
64:    throw Object.assign(new Error('amount is too small to represent in cents'), { statusCode: 400 });
65:  }
66:  if (!allowZero && abs === 0) {
67:    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
68:  }
69:  return sign * abs;
70:}
71:
72:function centsToAmount(value) {
73:  if (value === null || value === undefined) return value;
74:  const cents = Number(value);
75:  if (!Number.isFinite(cents)) return value;
76:  return parseFloat((Math.round(cents) / 100).toFixed(2));
77:}
```

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\utils\money.js:94-113
94:function serializeMoney(value, key = '') {
95:  if (Array.isArray(value)) return value.map((item) => serializeMoney(item, key));
96:  if (!value || typeof value !== 'object') return value;
97:  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => {
98:    if (MONEY_RESPONSE_KEYS.has(childKey) && typeof childValue === 'number') {
99:      return [childKey, centsToAmount(childValue)];
100:    }
101:    if (BOOLEAN_RESPONSE_KEYS.has(childKey)) {
102:      if (childValue === 1) return [childKey, true];
103:      if (childValue === 0) return [childKey, false];
104:    }
105:    if (childKey === 'tags' && typeof childValue === 'string') {
106:      try {
107:        return [childKey, JSON.parse(childValue)];
108:      } catch {
109:        return [childKey, []];
110:      }
111:    }
112:    return [childKey, serializeMoney(childValue, childKey)];
113:  }));
```

Mobile conversion/formatting:

```ts
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\mobile\src\utils\numberInput.ts:1-18
1:export function sanitizeDecimalInput(value: string, maxDecimals = 2): string {
2:  const cleaned = value.replace(/[^\d.]/g, '');
3:  const [integer = '', ...decimalParts] = cleaned.split('.');
4:  const decimal = decimalParts.join('').slice(0, maxDecimals);
5:  const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
6:  return decimalParts.length ? `${normalizedInteger || '0'}.${decimal}` : normalizedInteger;
9:export function parsePositiveMoney(value: string): number | null {
10:  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
11:  const parsed = Number(value);
12:  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
15:export function parseNonNegativeMoney(value: string): number | null {
16:  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
17:  const parsed = Number(value);
18:  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
```

```ts
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\mobile\src\utils\formatters.ts:3-24
3:export function formatCurrency(amount = 0, currencyCode = 'USD', locale = 'en-US') {
4:  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(Number(amount) || 0);
20:export function formatPercent(value = 0, total = 0) {
21:  const n = Number(value);
22:  const t = Number(total);
23:  if (!Number.isFinite(n) || !Number.isFinite(t) || t === 0) return '0.0%';
24:  return `${((n / t) * 100).toFixed(1)}%`;
```

### 3.3 Every place a balance is read, written, or modified

Balance write/update sites:

```js
// transactionController.js:104-108
104:function updateBalance(accountId, userId, delta) {
108:  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
```

```js
// accountController.js:31-36
31:function updateStoredBalance(accountId, userId, delta) {
35:  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
36:    .run(delta, nowIso(), accountId, userId);
```

```js
// adminController.js:350-352
350:function updateStoredBalance(accountId, userId, delta) {
351:  if (!accountId) return;
352:  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
```

```js
// adminController.js:1408
1408:      db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(targetBalance, now, account.id, req.params.id);
```

Balance read/derived sites:

```js
// accountController.js:150-151
150:    const accounts = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
151:      FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
```

```js
// accountController.js:159-164
159:    const account = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
160:      FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1`).get(req.params.id, req.user.id);
163:    account.recent_transactions = db.prepare(`SELECT * FROM transactions
164:      WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 5`).all(req.params.id, req.user.id);
```

```js
// adminController.js:81-85
81:function derivedAccountBalance(accountId, userId) {
82:  const row = db.prepare(`SELECT ${accountCurrentBalanceExpr('a')} AS balance
83:    FROM accounts a WHERE a.id = ? AND a.user_id = ?`).get(accountId, userId);
84:  return Number(row?.balance || 0);
85:}
```

Mobile balance reads:

```ts
// AccountCard.tsx:44-59
44:  const accent = account.color || theme.colors.accent;
45:  const balance = account.current_balance ?? account.balance ?? 0;
46:  const isNegative = Number(balance) < 0;
59:        <Text style={[styles.balance, isNegative && styles.negativeBalance]} numberOfLines={1}>{formatCurrency(balance, account.currency)}</Text>
```

```ts
// DashboardScreen.tsx:80-82
80:  const netWorth = useMemo(
81:    () => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0),
82:    [accounts]
```

```ts
// OverviewScreen.tsx:77-84
77:function amountValue(value: unknown) {
78:  const amount = Number(value || 0);
79:  return Number.isFinite(amount) ? amount : 0;
82:function accountBalance(account: Account) {
83:  return amountValue(account.current_balance ?? account.balance);
```

### 3.4 Every formula used anywhere in the app

Account balance derived formula:

```js
// accountBalance.js:14-24
14:  SELECT SUM(CASE
15:    WHEN t.type = 'income' THEN t.amount
16:    WHEN t.type = 'expense' THEN -t.amount
17:    WHEN t.type = 'transfer' AND ${transferDestinationPredicate('t')} THEN t.amount
18:    ELSE -t.amount
19:  END)
20:  FROM transactions t
21:  WHERE t.account_id = ${accountAlias}.id
22:    AND t.user_id = ${accountAlias}.user_id
23:    AND t.admin_deleted_at IS NULL
```

Balance delta:

```js
// money.js:80-91
80:function computeBalanceDelta(transaction) {
81:  const amount = Number(transaction.amount || 0);
85:  if (transaction.type === 'income') return amount;
86:  if (transaction.type === 'expense') return -amount;
87:  if (transaction.type === 'transfer') {
88:    const dir = transaction.transfer_direction ?? null;
89:    return dir === 'destination' ? amount : -amount;
90:  }
91:  return 0;
```

Net worth:

```ts
// DashboardScreen.tsx:80-82
80:  const netWorth = useMemo(
81:    () => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0),
```

```ts
// OverviewScreen.tsx:157-164
157:    const totalAssets = data.accounts
158:      .filter((account) => account.type !== 'credit')
159:      .reduce((sum, account) => sum + accountBalance(account), 0);
160:    const totalCredit = data.accounts
161:      .filter((account) => account.type === 'credit')
162:      .reduce((sum, account) => sum + Math.abs(accountBalance(account)), 0);
163:    const netWorth = data.accounts.reduce((sum, account) => sum + accountBalance(account), 0);
164:    const savingsRate = data.summary.total_income > 0 ? (data.summary.net / data.summary.total_income) * 100 : 0;
```

Income/expense/net summary:

```js
// transactionController.js:424-447
424:    const totals = db.prepare(`
426:        COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount ELSE 0 END), 0) AS total_income,
427:        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS total_expense
428:      FROM transactions t WHERE ${whereSql}
443:    return res.json(serializeMoney({
444:      total_income: totals.total_income,
445:      total_expense: totals.total_expense,
446:      net: totals.total_income - totals.total_expense,
```

Admin reports:

```js
// adminController.js:1700-1710
1700:    const monthly = db.prepare(`
1702:        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
1703:        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense,
1706:      WHERE admin_deleted_at IS NULL
1710:    `).all().map((row) => ({ ...row, net: Number(row.income || 0) - Number(row.expense || 0) }));
```

Mobile report recomputation:

```ts
// ReportsScreen.tsx:269-272
269:  const totalSpending = categoryTotals.reduce((sum, item) => sum + item.value, 0);
270:  const totalIncome = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
271:  const totalExpense = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
272:  const net = totalIncome - totalExpense;
```

Transfer delta:

```js
// transactionController.js:226-227
226:        insertTransaction(sourceTx); insertTransaction(destTx);
227:        updateBalance(account.id, req.user.id, -amount); updateBalance(toAccount.id, req.user.id, amount);
```

Budget current spending/remaining/percent:

```js
// budgetController.js:132-150
132:    const budgets = db.prepare(`SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
133:      COALESCE(SUM(t.amount), 0) AS current_spending
136:      LEFT JOIN transactions t ON t.user_id = b.user_id
138:        AND t.type = 'expense'
139:        AND t.admin_deleted_at IS NULL
145:    const data = budgets.map((budget) => ({
147:      remaining: Number(budget.amount) - Number(budget.current_spending),
148:      percent_used: budgetPercentUsed(budget.amount, budget.current_spending),
```

```js
// budgetController.js:99-106
99:function budgetPercentUsed(amountValue, currentValue) {
100:  const amount = Number(amountValue || 0);
101:  const currentSpending = Number(currentValue || 0);
102:  if (!Number.isFinite(currentSpending) || !Number.isFinite(amount) || amount === 0) {
103:    return 0;
104:  }
105:  if (amount === 0) return currentSpending > 0 ? 100 : 0;
106:  return Math.round((currentSpending / amount) * 10000) / 100;
```

Mobile budget formulas:

```ts
// BudgetProgressCard.tsx:17-23
17:  const spent = Number(budget.current_spending || 0);
18:  const amount = Number(budget.amount || 0);
19:  const ratio = amount > 0 ? spent / amount : 0;
20:  const progress = Math.min(ratio, 1);
21:  const isOver = ratio > 1;
22:  const overage = Math.max(spent - amount, 0);
23:  const color = isOver ? theme.colors.danger : ratio > 0.82 ? theme.colors.warning : theme.colors.success;
```

Savings rate:

```ts
// OverviewScreen.tsx:164
164:    const savingsRate = data.summary.total_income > 0 ? (data.summary.net / data.summary.total_income) * 100 : 0;
```

Admin totals/aggregates:

```js
// adminController.js:456-468
456:    const userCounts = db.prepare(`
458:        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
459:        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive,
460:        COUNT(*) AS total
463:    const transactionTotals = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS sum FROM transactions WHERE admin_deleted_at IS NULL').get();
464:    const totalAccounts = db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count;
467:    const newUsersThisMonth = db.prepare('SELECT COUNT(*) AS count FROM users WHERE created_at >= ?').get(monthStart).count;
468:    const newTransactionsThisMonth = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE created_at >= ?').get(monthStart).count;
```

Monthly change:

```ts
// DashboardScreen.tsx:84-88
84:  const monthlyChange = (() => {
85:    if (netWorth === 0 || monthlySummary.net === 0) return 0;
86:    const raw = (monthlySummary.net / Math.abs(netWorth)) * 100;
87:    return Math.max(-100, Math.min(100, raw));
88:  })();
```

### 3.5 Transaction CREATE flow

User create route and validators:

```js
// transactionRoutes.js:65-109
65:const createRules = [
66:  body('account_id').optional({ nullable: true, checkFalsy: true }).isUUID()
67:  body('to_account_id').if(body('type').equals('transfer')).isUUID()
68:  body('category_id').custom((value, { req }) => {
75:  body('type').isIn(types)
76:  positiveMoney(body('amount'), 'amount'),
77:  body('date').custom(isIsoDate)
109:router.post('/', createRules, validate, controller.createTransaction);
```

Step-by-step:

1. Resolve account: provided account must be active/user-owned, else default cash account is created/fetched.

```js
// transactionController.js:180-188
180:function createTransaction(req, res, next) {
182:    const account = req.body.account_id
183:      ? getOwnedAccount(req.body.account_id, req.user.id)
184:      : getOrCreateDefaultCashAccount(req.user.id);
185:    if (!account) return res.status(400).json({ error: 'account_id must belong to the authenticated user' });
186:    const categoryId = req.body.category_id || null;
187:    if (categoryId && !getAllowedCategory(categoryId, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
188:    if (req.body.type !== 'transfer' && !categoryId) return res.status(400).json({ error: 'category_id is required' });
```

2. Convert dollars to integer cents and build base row.

```js
// transactionController.js:190-202
190:    assertTransactionAmount(Number(req.body.amount));
191:    const amount = amountToCents(req.body.amount, { allowZero: false });
192:    const transactionDate = validateTransactionDate(req.body.date);
194:    const base = {
195:      id: crypto.randomUUID(), user_id: req.user.id, account_id: account.id, category_id: categoryId,
196:      type: req.body.type, amount, description: sanitizeText(req.body.description), note: sanitizeText(req.body.note),
197:      date: transactionDate, recurring: parseBoolField(req.body.recurring),
199:      recurring_interval: req.body.recurring_interval || null, receipt_path: req.body.receipt_path || null,
200:      tags: JSON.stringify(parseTags(req.body.tags)), transfer_group_id: null, transfer_direction: null,
201:      to_account_id: null, from_account_id: null, created_at: createdAt, updated_at: null,
```

3. Transfer path creates two rows and two balance updates in one DB transaction.

```js
// transactionController.js:204-231
204:    const created = [];
205:    db.transaction(() => {
206:      if (base.type === 'transfer') {
207:        const toAccount = getOwnedAccount(req.body.to_account_id, req.user.id);
210:        assertBalanceAllowed(account, -amount);
211:        const groupId = crypto.randomUUID();
212:        const sourceTx = {
214:          transfer_group_id: groupId,
215:          transfer_direction: 'source',
216:          to_account_id: toAccount.id,
218:        const destTx = {
220:          id: crypto.randomUUID(),
221:          account_id: toAccount.id,
222:          transfer_group_id: groupId,
223:          transfer_direction: 'destination',
224:          from_account_id: account.id,
226:        insertTransaction(sourceTx); insertTransaction(destTx);
227:        updateBalance(account.id, req.user.id, -amount); updateBalance(toAccount.id, req.user.id, amount);
230:        audit(req, 'TRANSACTION_CREATED', 'transaction', sourceTx.id, null, { source: sourceTx, destination: destTx });
```

4. Income/expense path inserts one row and applies `computeBalanceDelta`.

```js
// transactionController.js:232-238
232:      } else {
233:        assertBalanceAllowed(account, computeBalanceDelta(base));
234:        insertTransaction(base);
235:        updateBalance(account.id, req.user.id, computeBalanceDelta(base));
237:        audit(req, 'TRANSACTION_CREATED', 'transaction', base.id, null, base);
238:        created.push(base);
```

5. Response hydrates and serializes money; budget/large-transaction pushes are fire-and-forget.

```js
// transactionController.js:242-253
242:    const hydrated = getTransactionsWithDetails(created.map((transaction) => transaction.id), req.user.id);
243:    created.forEach((transaction) => notifyBudgetOverspendIfNeeded(req.user.id, transaction));
244:    const largeTransactionThreshold = amountToCents(process.env.LARGE_TRANSACTION_AMOUNT || 1000, { allowZero: false });
246:      void sendPushNotification(
253:    return res.status(201).json(serializeMoney({ transactions: hydrated }));
```

### 3.6 Transaction EDIT flow

1. Type cannot be changed.

```js
// transactionController.js:300-308
302:    if (Object.prototype.hasOwnProperty.call(req.body, 'type')) {
304:      audit(req, 'TRANSACTION_IMMUTABLE_UPDATE_ATTEMPTED', 'transaction', req.params.id, null, { type: req.body.type });
305:      return res.status(400).json({ error: 'type cannot be changed after creation' });
307:    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
```

2. Amount changed: transfer updates both rows and both balances; non-transfer updates one row/balance.

```js
// transactionController.js:330-370
330:    db.transaction(() => {
331:      if (amountChanged) {
332:        if (oldTx.type === 'transfer') {
336:          const related = getRelatedTransferTransactions(req.user.id, groupId);
337:          if (related.length !== 2) {
345:            const delta = computeBalanceDelta({ ...item, amount: nextAmount }) - computeBalanceDelta(item);
346:            assertBalanceAllowed(account, delta);
349:          for (const item of related) {
350:            const delta = computeBalanceDelta({ ...item, amount: nextAmount }) - computeBalanceDelta(item);
351:            updateBalance(item.account_id, req.user.id, delta);
354:          db.prepare('UPDATE transactions SET amount = ?, updated_at = ? WHERE user_id = ? AND transfer_group_id = ? AND admin_deleted_at IS NULL')
355:            .run(nextAmount, updates.updated_at, req.user.id, groupId);
358:          const account = getOwnedAccount(oldTx.account_id, req.user.id);
360:          const delta = computeBalanceDelta({ ...oldTx, amount: nextAmount }) - computeBalanceDelta(oldTx);
362:          updateBalance(oldTx.account_id, req.user.id, delta);
363:          updates.amount = nextAmount;
368:      if (Object.keys(updates).length) {
370:        db.prepare(`UPDATE transactions SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
```

3. Audit and response.

```js
// transactionController.js:376-378
376:    const newTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
377:    audit(req, 'TRANSACTION_UPDATED', 'transaction', req.params.id, oldTx, newTx);
378:    return res.json(serializeMoney(newTx));
```

### 3.7 Transaction DELETE by user

```js
// transactionController.js:382-410
384:    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
388:    if (tx.type === 'transfer') {
393:        related = getRelatedTransferTransactions(req.user.id, groupId);
395:      if (related.length !== 2) {
397:        return res.status(409).json({ error: 'Transfer group is incomplete; both sides must be present before deletion.' });
401:    const affectedAccountIds = Array.from(new Set(related.map((item) => item.account_id).filter(Boolean)));
402:    db.transaction(() => {
403:      for (const item of related) {
404:        if (item.account_id) updateBalance(item.account_id, req.user.id, -computeBalanceDelta(item));
405:        db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(item.id, req.user.id);
408:      audit(req, 'TRANSACTION_DELETED', 'transaction', req.params.id, related, null);
410:    return res.json({ success: true, deleted: related.length });
```

User delete hard-deletes transaction rows and reverses stored balance.

### 3.8 Transaction DELETE by admin

```js
// adminController.js:1240-1262
1240:function adminSoftDeleteTransaction(req, res, next) {
1242:    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND admin_deleted_at IS NULL').get(req.params.id);
1246:    let related = [tx];
1247:    if (tx.type === 'transfer' && tx.transfer_group_id) {
1248:      related = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND transfer_group_id = ? AND admin_deleted_at IS NULL').all(tx.user_id, tx.transfer_group_id);
1251:    db.transaction(() => {
1252:      for (const item of related) {
1253:        updateStoredBalance(item.account_id, item.user_id, -computeBalanceDelta(item));
1254:        db.prepare(`
1255:          UPDATE transactions
1256:          SET admin_deleted_at = ?, admin_deleted_by = ?, admin_delete_reason = ?, updated_at = ?
1258:        `).run(deletedAt, req.user.id, reason, deletedAt, item.id);
1260:      audit(req, 'ADMIN_SOFT_DELETED_TRANSACTION', 'transaction', req.params.id, related, { reason, deleted_at: deletedAt, related_count: related.length });
1262:    return res.json({ success: true, deleted: related.length, reason });
```

Differences from user delete:

| Behavior | User delete | Admin delete |
|---|---|---|
| Row removal | Hard delete `DELETE FROM transactions` | Soft delete `UPDATE transactions SET admin_deleted_at...` |
| Transfer validation | Requires exactly 2 related rows or returns 409 | If group exists, deletes whatever rows query returns; no `related.length === 2` check |
| User ownership | `id AND user_id` | Global transaction by ID |
| Reason | No reason | Reason required by route/controller |

### 3.9 Account CREATE

```js
// accountController.js:96-143
98:    const initialBalance = amountToCents(req.body.balance || 0, { allowNegative: true });
100:    const hasOverdraftLimit = Object.prototype.hasOwnProperty.call(req.body, 'overdraft_limit');
101:    const overdraftLimit = hasOverdraftLimit ? normalizeOverdraftLimit(req.body.overdraft_limit) : null;
106:    const account = {
111:      balance: initialBalance,
112:      overdraft_limit: overdraftLimit,
121:    db.transaction(() => {
122:      db.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
123:        VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)`).run(account);
125:      if (initialBalance !== 0) {
126:        db.prepare(`INSERT INTO transactions (id, user_id, account_id, category_id, type, amount, description, note, date, recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction, created_at, updated_at)
127:          VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, NULL, NULL, ?, NULL)`).run(
131:          initialBalance >= 0 ? 'income' : 'expense',
132:          Math.abs(initialBalance),
133:          'Opening balance',
140:      audit(req, 'ACCOUNT_CREATED', 'account', account.id, null, account);
142:    return res.status(201).json(serializeMoney(account));
```

Opening balance creates both a stored balance and a derived transaction; no additional `UPDATE accounts` is done because inserted account balance already equals initial balance.

### 3.10 Account DELETE by user, delete transactions and move to cash

Route:

```js
// accountRoutes.js:56-69
56:const deleteRules = [
58:  query('transaction_action')
60:    .isIn(['delete', 'cash'])
69:router.delete('/:id', deleteRules, validate, controller.deleteAccount);
```

Controller:

```js
// accountController.js:204-232
206:    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.id, req.user.id);
209:    const transactionAction = req.query.transaction_action;
210:    const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id).count;
211:    if (transactionCount > 0 && !transactionAction) {
212:      return res.status(400).json({
213:        error: 'Choose whether to delete this account transactions or move them to Cash',
219:    let transactionResult = { action: 'none', deleted: 0, moved: 0, cash_account_id: null };
220:    db.transaction(() => {
221:      if (transactionAction === 'delete') {
222:        transactionResult = { action: 'delete', deleted: deleteAccountTransactions(req.params.id, req.user.id), moved: 0, cash_account_id: null };
223:      } else if (transactionAction === 'cash') {
224:        const result = moveAccountTransactionsToCash(req.params.id, req.user.id);
228:      db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
229:      audit(req, 'ACCOUNT_DELETED', 'account', req.params.id, account, { ...account, is_active: 0, transaction_result: transactionResult });
232:    return res.json({ success: true, transactions: transactionResult });
```

Delete transactions path:

```js
// accountController.js:56-64
56:function deleteAccountTransactions(accountId, userId) {
57:  return db.transaction(() => {
58:    const transactions = transactionsForAccountDelete(accountId, userId);
59:    for (const transaction of transactions) {
60:      updateStoredBalance(transaction.account_id, userId, -computeBalanceDelta(transaction));
61:      db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(transaction.id, userId);
62:    }
63:    return transactions.length;
64:  })();
```

Move to cash path:

```js
// accountController.js:67-93
67:function moveAccountTransactionsToCash(accountId, userId) {
68:  return db.transaction(() => {
69:    const cashAccount = getOrCreateDefaultCashAccount(userId);
77:    const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
78:    const movedDelta = direct.reduce((sum, transaction) => sum + computeBalanceDelta(transaction), 0);
82:    db.prepare('UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
84:    db.prepare('UPDATE transactions SET from_account_id = ?, updated_at = ? WHERE from_account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
86:    db.prepare('UPDATE transactions SET to_account_id = ?, updated_at = ? WHERE to_account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
89:    updateStoredBalance(accountId, userId, -movedDelta);
90:    updateStoredBalance(cashAccount.id, userId, movedDelta);
92:    return { moved: direct.length, cashAccountId: cashAccount.id };
```

### 3.11 Account DELETE by admin

```js
// adminController.js:1303-1356
1303:function deleteUserAccount(req, res, next) {
1308:    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.accountId, req.params.id);
1314:    const transactionAction = req.body.transaction_action || 'cash';
1319:    const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.accountId, req.params.id).count;
1323:    db.transaction(() => {
1324:      if (transactionCount > 0 && transactionAction === 'delete') {
1325:        transactionResult = { action: 'delete', deleted: deleteAccountTransactions(req.params.accountId, req.params.id), moved: 0, cash_account_id: null };
1326:      } else if (transactionCount > 0) {
1327:        const result = moveAccountTransactionsToCash(req.params.accountId, req.params.id);
1331:      audit(req, 'ADMIN_DELETED_USER_ACCOUNT', 'account', req.params.accountId, account, {
1340:      createUserNotification(
1353:      db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.accountId, req.params.id);
1356:    return res.json({ success: true, account_id: req.params.accountId, reason, transactions: transactionResult });
```

Differences from user account delete:

| Behavior | User delete | Admin delete |
|---|---|---|
| Account row | `UPDATE accounts SET is_active = 0` | `DELETE FROM accounts` hard delete |
| Default transaction action | If transactions exist and query param absent: 400 with choices | Defaults to `cash` |
| Reason | No reason | Requires reason |
| Notification | No user notification | Creates notification row |
| Request location | Query `transaction_action` | Body `transaction_action` |

### 3.12 Budget CREATED, EVALUATED, DELETED

Create:

```js
// budgetController.js:109-125
111:    if (!allowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
112:    const dates = normalizeBudgetDates(req.body.period, req.body.start_date, req.body.end_date);
114:      id: crypto.randomUUID(), user_id: req.user.id, category_id: req.body.category_id, amount: amountToCents(req.body.amount, { allowZero: false }),
118:    db.transaction(() => {
119:      assertNoBudgetOverlap(req.user.id, req.body.category_id, dates.start_date, dates.end_date);
120:      db.prepare(`INSERT INTO budgets (id, user_id, category_id, amount, period, start_date, end_date, created_at, updated_at)
121:        VALUES (@id, @user_id, @category_id, @amount, @period, @start_date, @end_date, @created_at, @updated_at)`).run(budget);
122:      audit(req, 'BUDGET_CREATED', 'budget', budget.id, null, budget);
124:    return res.status(201).json(serializeMoney(budget));
```

Evaluate list/detail:

```js
// budgetController.js:132-150
132:    const budgets = db.prepare(`SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
133:      COALESCE(SUM(t.amount), 0) AS current_spending
138:        AND t.type = 'expense'
139:        AND t.admin_deleted_at IS NULL
140:        AND datetime(t.date) >= datetime(b.start_date)
141:        AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date, '+1 day', '-1 second'))
147:      remaining: Number(budget.amount) - Number(budget.current_spending),
148:      percent_used: budgetPercentUsed(budget.amount, budget.current_spending),
```

Delete:

```js
// budgetController.js:219-227
221:    const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
223:    db.transaction(() => {
224:      db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
225:      audit(req, 'BUDGET_DELETED', 'budget', req.params.id, budget, null);
227:    return res.json({ success: true });
```

### 3.13 Interacting operations that can conflict

| Interaction | Evidence | Broken/fragile state |
|---|---|---|
| Transaction hard delete/user vs admin soft delete | User hard-deletes at `transactionController.js:405`; admin soft-deletes at `adminController.js:1254-1258` | Export and admin-user transaction routes can include admin-deleted rows while user UI excludes them. |
| Account delete/move-to-cash with transfers | `accountController.js:82-87` rewrites `account_id`, `from_account_id`, `to_account_id` | Transfer pair may end up with both sides pointing at cash or semantic source/destination metadata no longer matching original transfer. |
| Opening-balance account creation | `accountController.js:111-137` stores account balance and creates transaction | If insert transaction fails transaction rolls back; if later transaction is deleted, stored balance is reversed by transaction delete only if user deletes that transaction path. |
| Admin balance correction | `adminController.js:1369-1408` computes from derived balance, inserts correction, then sets stored balance | If correction transaction remains but stored balance is set directly, future derived-vs-stored depends on correction staying active. |
| Offline mobile optimistic queue | `transactionsSlice.ts:180-190`, `accountsSlice.ts:95-105`, `budgetsSlice.ts:82-85` | Local state can show temporary rows/balances not yet accepted by backend. |

### 3.14 Calculations with context-dependent results

| Calculation | Context difference |
|---|---|
| Account balance | Stored `accounts.balance` vs derived `current_balance`; mobile often uses `current_balance ?? balance`. |
| Transaction summary | User summary excludes admin-deleted rows; admin reports mostly exclude, but some dashboard counts/categories do not. |
| Admin `/users/:id/transactions` | Validates include/admin_deleted query flags but controller ignores them and includes all user transactions by default. |
| Budget spending | Backend filters `admin_deleted_at IS NULL`; mobile local budget cards trust returned `current_spending`, but budget screen daily breakdown fetches current period transactions separately. |
| Net worth | Mobile sums all returned active accounts; admin account list returns all user accounts including inactive. |
| Transfers | Source row is negative, destination positive; UI sign is based on `transfer_direction`. If transfer metadata missing, transfer defaults negative in backend `computeBalanceDelta`. |

### 3.15 Money/data-flow gotchas

1. `transactions.amount` is always positive; sign is contextual.
2. `accounts.balance` is not the only truth; `current_balance` is a derived warning signal.
3. Admin soft-delete updates stored account balance but leaves the row, so all future queries must remember `admin_deleted_at IS NULL`.
4. Mobile reports recompute totals from paginated/fallback transaction fetches, not from `/api/transactions/summary`.
5. Mobile formatters commonly use `amount || 0`, so `NaN`, `undefined`, `null`, and empty values display as `$0`.

## SECTION 4 - API CONTRACT

### 4.1 Every route, method, path, auth, description

Auth levels: `public`, `auth`, `admin`, `admin+scope`.

| Method | Path | Auth | Handler |
|---|---|---|---|
| POST | `/api/client-error` | public | Logs client error and returns 202. `app.js:172-193`. |
| GET | `/health` | public | Health/version/min app/backup status. `app.js:223-241`. |
| POST | `/api/auth/register` | public | Register user. `authRoutes.js:206`. |
| POST | `/api/auth/login` | public | Login. `authRoutes.js:207`. |
| POST | `/api/auth/forgot-password` | public | Request reset. `authRoutes.js:208`. |
| POST | `/api/auth/reset-password` | public | Reset password. `authRoutes.js:209`. |
| POST | `/api/auth/verify-email` | public | Verify email. `authRoutes.js:210`. |
| POST | `/api/auth/resend-verification` | public | Resend verification. `authRoutes.js:211`. |
| GET | `/api/auth/csrf` | public | Return CSRF token. `authRoutes.js:212`. |
| POST | `/api/auth/refresh` | public | Rotate refresh token. `authRoutes.js:213`. |
| POST | `/api/auth/logout` | auth | Revoke refresh/access. `authRoutes.js:214`. |
| PUT | `/api/auth/change-password` | auth | Change password. `authRoutes.js:215`. |
| GET | `/api/auth/me` | auth | Current user. `authRoutes.js:216`. |
| PATCH | `/api/auth/me` | auth | Update profile. `authRoutes.js:242-267`. |
| GET | `/api/auth/sessions` | auth | Active sessions. `authRoutes.js:217`. |
| DELETE | `/api/auth/sessions/others` | auth | Revoke other sessions. `authRoutes.js:218`. |
| DELETE | `/api/auth/sessions/:sessionId` | auth | Revoke one session. `authRoutes.js:219`. |
| POST | `/api/auth/push-token` | auth | Register push token. `authRoutes.js:220-223`. |
| DELETE | `/api/auth/push-token` | auth | Remove push token. `authRoutes.js:224-226`. |
| GET | `/api/auth/notification-settings` | auth | Preferences. `authRoutes.js:227`. |
| PUT | `/api/auth/notification-settings` | auth | Update preferences. `authRoutes.js:228-230`. |
| GET | `/api/auth/notifications` | auth | Notifications. `authRoutes.js:231-233`. |
| PATCH | `/api/auth/notifications/:id/read` | auth | Mark read. `authRoutes.js:234-236`. |
| GET | `/api/auth/data` | auth | Export my data. `authRoutes.js:237`. |
| DELETE | `/api/auth/data` | auth | Delete my financial data. `authRoutes.js:238`. |
| DELETE | `/api/auth/account` | auth | Delete/anonymize account. `authRoutes.js:239-241`. |
| GET | `/api/accounts` | auth | List active accounts. `accountRoutes.js:65`. |
| POST | `/api/accounts` | auth | Create account. `accountRoutes.js:66`. |
| GET | `/api/accounts/:id` | auth | Get active account. `accountRoutes.js:67`. |
| PUT | `/api/accounts/:id` | auth | Update account metadata. `accountRoutes.js:68`. |
| DELETE | `/api/accounts/:id` | auth | Deactivate account with transaction action. `accountRoutes.js:69`. |
| GET | `/api/transactions` | auth | List transactions. `transactionRoutes.js:107`. |
| POST | `/api/transactions` | auth | Create transaction/transfer. `transactionRoutes.js:109`. |
| GET | `/api/transactions/summary` | auth | Financial summary. `transactionRoutes.js:110`. |
| DELETE | `/api/transactions/bulk` | auth | Bulk hard delete. `transactionRoutes.js:111`. |
| PATCH | `/api/transactions/bulk/category` | auth | Bulk update category. `transactionRoutes.js:112`. |
| GET | `/api/transactions/:id` | auth | Get transaction. `transactionRoutes.js:113`. |
| PUT | `/api/transactions/:id` | auth | Update transaction. `transactionRoutes.js:114`. |
| DELETE | `/api/transactions/:id` | auth | Hard delete transaction. `transactionRoutes.js:115`. |
| GET | `/api/budgets` | auth | List budgets. `budgetRoutes.js:42`. |
| POST | `/api/budgets` | auth | Create budget. `budgetRoutes.js:43`. |
| GET | `/api/budgets/:id` | auth | Budget detail. `budgetRoutes.js:44`. |
| PUT | `/api/budgets/:id` | auth | Update budget. `budgetRoutes.js:45`. |
| DELETE | `/api/budgets/:id` | auth | Delete budget. `budgetRoutes.js:46`. |
| GET | `/api/categories` | auth | List categories. `categoryRoutes.js:33`. |
| POST | `/api/categories` | auth | Create category. `categoryRoutes.js:34`. |
| PUT | `/api/categories/reorder` | auth | Reorder categories. `categoryRoutes.js:35`. |
| PUT | `/api/categories/:id` | auth | Update category. `categoryRoutes.js:36`. |
| DELETE | `/api/categories/:id` | auth | Delete category. `categoryRoutes.js:37`. |
| GET | `/api/announcements` | auth | Active announcements. `announcementRoutes.js:15`. |
| POST | `/api/announcements/:id/dismiss` | auth | Dismiss announcement. `announcementRoutes.js:16`. |
| GET | `/api/admin/dashboard` | admin | Admin stats. |
| GET | `/api/admin/transactions` | admin | Global transactions. |
| GET | `/api/admin/transactions/:id` | admin | Transaction detail. |
| DELETE | `/api/admin/transactions/:id` | admin+`write:transactions` for API tokens | Admin soft-delete transaction. |
| GET/POST/PUT/DELETE | `/api/admin/default-categories...` | admin | Manage defaults. |
| POST | `/api/admin/default-categories/push` | admin | Push defaults to users. |
| POST | `/api/admin/users/bulk` | admin | Bulk user status/password action. |
| GET/POST | `/api/admin/audit-retention...` | admin, purge requires `db:maintenance` + confirmation | Audit retention/purge. |
| GET/PUT | `/api/admin/system-config` | admin | Read/write app settings. |
| POST | `/api/admin/database/integrity-check` | admin | SQLite integrity check. |
| POST | `/api/admin/database/vacuum` | admin+`db:maintenance` + confirmation | Vacuum. |
| GET | `/api/admin/database/backup` | admin+`db:backup` for API tokens | Download DB backup. |
| GET | `/api/admin/reports` | admin | Reports. |
| GET | `/api/admin/reports/export` | admin | CSV report export. |
| GET/POST/PUT/DELETE | `/api/admin/announcements...` | admin, writes require `write:announcements` for API tokens | Announcement CRUD. |
| GET/POST/DELETE | `/api/admin/api-tokens...` | admin | Admin API token CRUD. |
| GET | `/api/admin/token-scopes` | admin | Scope list. |
| GET/POST/PUT | `/api/admin/webhooks...` | admin | Webhook CRUD/deliveries. |
| GET/POST/DELETE | `/api/admin/security-blocks...` | admin | Security block list/mutate. |
| GET | `/api/admin/deleted-users`, `/api/admin/deleted-users/:id` | admin | Deleted-user archive. |
| GET | `/api/admin/users`, `/api/admin/users/:id`, `/api/admin/users/:id/*` | admin | User detail, sessions, transactions, accounts, export, metrics. |
| PUT/POST/DELETE | `/api/admin/users/:id/...` | admin | User status/role/reset/delete/revoke/impersonate/account actions. |
| GET | `/api/admin/audit-logs` | admin | Audit logs. |
| GET | `/api/admin/system-health` | admin | System health. |

Admin route evidence is `backend\src\routes\adminRoutes.js:163-323`.

### 4.2 Request body/query shape and validation

Representative exact validators:

```js
// accountRoutes.js:38-62
38:const createRules = [
39:  body('name').trim().isLength({ min: 1, max: 50 })
40:  body('type').isIn(validTypes)
41:  body('currency').trim().isLength({ min: 3, max: 3 }).isAlpha()
42:  body('color').matches(/^#[0-9A-Fa-f]{6}$/)
43:  body('icon').isString().bail().isLength({ min: 1, max: 50 })
44:  moneyFormat('balance', { min: 0, message: 'balance must be a non-negative number' }),
45:  clearableMoneyFormat('overdraft_limit', { min: 0, message: 'overdraft_limit must be a non-negative number' }),
47:const updateRules = [
49:  // balance is intentionally not updatable here; account balances are transaction-derived.
50:  body('name').optional().trim().isLength({ min: 1, max: 50 })
54:  clearableMoneyFormat('overdraft_limit', ...)
56:const deleteRules = [
58:  query('transaction_action').optional().isIn(['delete', 'cash'])
```

```js
// transactionRoutes.js:50-104
50:const filters = [
51:  query('account_id').optional().isUUID()
53:  query('type').optional().isIn(types)
54:  query('start_date').optional().custom(isIsoDate)
58:  decimalMoney(query('min_amount').optional(), 'min_amount'),
60:  query('search').optional().isString().isLength({ max: 100 })
65:const createRules = [
66:  body('account_id').optional({ nullable: true, checkFalsy: true }).isUUID()
67:  body('to_account_id').if(body('type').equals('transfer')).isUUID()
68:  body('category_id').custom((value, { req }) => {
75:  body('type').isIn(types)
76:  positiveMoney(body('amount'), 'amount'),
77:  body('date').custom(isIsoDate)
78:  body('description').optional(...).isLength({ max: 200 })
80:  body('tags').optional({ nullable: true }).isArray()
83:  body('recurring').optional().isBoolean()
84:  body('recurring_interval').optional({ nullable: true }).isIn(['daily', 'weekly', 'monthly', 'yearly'])
86:const updateRules = [
88:  optionalPositiveMoney(body('amount'), 'amount'),
91:  body('category_id').optional().isUUID()
```

```js
// budgetRoutes.js:25-38
25:const createRules = [
26:  decimalAmount(body('amount').notEmpty()),
27:  body('category_id').isUUID()
28:  body('period').isIn(periods)
29:  body('start_date').custom(isIsoDate)
30:  body('end_date').optional({ nullable: true, checkFalsy: true }).custom(isIsoDate)
32:const updateRules = [
34:  decimalAmount(body('amount').optional()),
35:  body('category_id').optional().isUUID()
```

Admin validators are exact in `adminRoutes.js:66-144` and route-specific bodies at `adminRoutes.js:167-312`.

### 4.3 Response shapes

Common list shape:

```js
// accountController.js:153
153:    return res.json({ data: serializeMoney(accounts), pagination: paginationMeta(page, limit, total) });
// transactionController.js:286
286:    return res.json({ data: serializeMoney(transactions), pagination: paginationMeta(page, limit, total) });
// budgetController.js:150
150:    return res.json({ data: serializeMoney(data), pagination: paginationMeta(page, limit, total) });
```

Create/update detail examples:

```js
// transactionController.js:253,378,410
253:    return res.status(201).json(serializeMoney({ transactions: hydrated }));
378:    return res.json(serializeMoney(newTx));
410:    return res.json({ success: true, deleted: related.length });
```

```js
// accountController.js:142,200,232
142:    return res.status(201).json(serializeMoney(account));
200:    return res.json(serializeMoney(newAccount));
232:    return res.json({ success: true, transactions: transactionResult });
```

```js
// budgetController.js:124,172-178,215,227
124:    return res.status(201).json(serializeMoney(budget));
172:    return res.json(serializeMoney({
174:      current_spending: current,
175:      remaining: Number(budget.amount) - current,
176:      percent_used: budgetPercentUsed(budget.amount, current),
177:      weekly_breakdown: breakdown,
215:    return res.json(serializeMoney(newBudget));
227:    return res.json({ success: true });
```

Auth response examples:

```js
// authController.js:400-404
400:    return res.status(200).json({
401:      accessToken: issueAccessToken(updatedUser),
402:      refreshToken,
403:      user: sanitizeUser(updatedUser),
404:    });
```

```js
// authController.js:459,488,595,648,757,858-863
459:    return res.status(200).json({ accessToken, refreshToken: nextRefreshToken });
488:    return res.status(200).json({ success: true });
595:    return res.status(200).json({ success: true, message: 'Password has been reset successfully.' });
648:    return res.status(200).json({ success: true, message: 'Email verified. You can now sign in.' });
757:    return res.status(200).json({ success: true, accessToken: issueAccessToken(updatedUser), refreshToken: nextRefreshToken });
859:  return res.status(200).json(sanitizeUser(req.user));
863:  return res.status(200).json({ csrfToken: req.csrfToken });
```

### 4.4 Stored one format, returned another

All keys in `MONEY_RESPONSE_KEYS` are stored as cents when sourced from DB numeric columns and returned as dollars by `serializeMoney` (`money.js:1-22,94-113`). Boolean keys in `BOOLEAN_RESPONSE_KEYS` are stored as 0/1 and returned as booleans (`money.js:24-33,101-104`). `tags` is stored as JSON text and returned as array (`money.js:105-110`).

### 4.5 Computed/derived response fields

| Field | Route/source | Code |
|---|---|---|
| `current_balance` | Accounts list/detail | `accountController.js:150-160`, `accountBalance.js:12-24`. |
| `recent_transactions` | Account detail | `accountController.js:163-164`. |
| `current_spending`, `remaining`, `percent_used` | Budget list/detail/admin budget performance | `budgetController.js:132-148,160-177`, `adminController.js:1035-1055`. |
| `weekly_breakdown` | Budget detail | `budgetController.js:166-177`. |
| `net` | Transaction summary/admin reports | `transactionController.js:443-447`, `adminController.js:1710`. |
| `pagination` | list routes | `paginationMeta` helpers. |
| `device_hint` | Sessions | `authController.js:873-876`. |
| `deleted_users` archive totals | Admin delete user | Snapshot fields in `deleted_users` schema and admin delete code. |

### 4.6 Role/query/body behavior changes

| Route | Variation |
|---|---|
| `/api/auth/register`, `/forgot-password`, `/resend-verification` | Responses can include raw tokens only in development/test with env flags (`authController.js:124-151`). |
| `/api/auth/login` | Inactive/unknown/bad password all 401; unverified email with correct password returns 403 code `EMAIL_NOT_VERIFIED` (`authController.js:318-331`). |
| `/api/accounts/:id DELETE` | Requires `transaction_action` only if transactions exist; action query controls delete vs cash move (`accountController.js:209-225`). |
| `/api/transactions POST` | `type=transfer` creates two rows and ignores category requirement; income/expense create one row and require category. |
| `/api/admin/transactions` | `include_deleted` and `admin_deleted` control soft-deleted visibility (`adminController.js:1188-1190`). |
| `/api/admin/users/:id/accounts/:accountId DELETE` | Body `transaction_action` defaults to `cash` (`adminController.js:1314`). |
| Admin routes with API tokens | `requireAdminScope` checks scope only for `token_type === 'admin_api_token'`; normal admin JWT bypasses scope (`auth.js:138-144`). |

### 4.7 Inconsistent success response shapes

| Route | Shapes |
|---|---|
| `POST /api/transactions` | Always `{ transactions: Transaction[] }`, even single create (`transactionRoutes.js:108`, `transactionController.js:253`). |
| `PUT /api/transactions/:id` | Returns a single transaction object (`transactionController.js:378`). |
| `DELETE /api/transactions/:id` | `{ success: true, deleted: number }` (`transactionController.js:410`). |
| `DELETE /api/accounts/:id` | `{ success: true, transactions: {...} }` (`accountController.js:232`). |
| `POST /api/auth/register` | Existing email returns 201 with generic `{ success, message }`; created verified-disabled returns different success message (`authController.js:219-282`). |
| Admin confirmation routes | First call can return 202 `{ requires_confirmation, confirmation_token... }`; second call returns operation success (`adminRoutes.js:17-36`). |

### 4.8 200/2xx partial or silent failures

| Route/path | Evidence |
|---|---|
| `POST /api/client-error` | Always 202 after logging sanitized payload; no auth. `app.js:172-193`. |
| Push notifications | Fire-and-forget `.catch(logger.warn)` after transaction/password operations. `transactionController.js:163-168,246-251`, `authController.js:751-756`. |
| Announcement dismiss in mobile | UI hides before API succeeds; catch only toast. `DashboardScreen.tsx:134-140`. |
| Auth forgot password for missing/inactive user | Always 200 generic response. `authController.js:499-501`. |
| Register existing user | Returns 201 generic response after dummy hash. `authController.js:217-227`. |

### 4.9 Non-standardized error responses

| Source | Shape |
|---|---|
| Validation middleware | `{ errors: [{ field, message }] }` in route files, e.g. `transactionRoutes.js:10-14`. |
| Controllers | `{ error: '...' }`, e.g. `transactionController.js:185`. |
| Login unverified | `{ error, code: 'EMAIL_NOT_VERIFIED' }` (`authController.js:328-331`). |
| Admin confirmation | 202 non-error `{ requires_confirmation, confirmation_token, expires_in_seconds, action }` (`adminRoutes.js:30-35`). |
| Final error handler | `{ error: statusCode === 500 ? 'Internal server error' : err.message }` (`app.js:271-273`). |
| Rate limits | `{ error: 'Too many...' }` (`authRoutes.js:16`, `adminRoutes.js:152`). |

### 4.10 API gotchas

1. `DELETE /api/transactions/:id` ignores the mobile-provided `{ confirm: true }` body; no body validation exists.
2. `DELETE /api/accounts/:id` uses query `transaction_action`; admin account delete uses body `transaction_action`.
3. `/api/admin/users/:id/transactions` validates `include_deleted`/`admin_deleted` but the controller does not implement them.
4. Money is returned in dollars by key name; newly added money fields will leak cents unless added to `MONEY_RESPONSE_KEYS`.

## SECTION 5 - AUTH, PERMISSIONS & SECURITY

### 5.1 How users authenticate

Password hash and access/refresh issue on login:

```js
// authController.js:344-404
344:    const passwordMatches = await verifyPassword(password, user.password_hash);
367:    const refreshToken = generateRefreshToken();
368:    const refreshTokenHash = hashToken(refreshToken);
369:    const refreshFamilyId = crypto.randomUUID();
370:    const expiresAt = addDays(new Date(), REFRESH_TOKEN_DAYS).toISOString();
373:    const completeLogin = db.transaction(() => {
382:      db.prepare(`
383:      INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
384:        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
385:      `).run(crypto.randomUUID(), user.id, refreshFamilyId, refreshTokenHash, expiresAt, loginAt, loginAt, req.get('user-agent') || null);
400:    return res.status(200).json({
401:      accessToken: issueAccessToken(updatedUser),
402:      refreshToken,
403:      user: sanitizeUser(updatedUser),
```

Access token payload:

```js
// authController.js:108-115
108:function issueAccessToken(user) {
109:  return generateAccessToken({
110:    sub: user.id,
111:    email: user.email,
112:    role: user.role,
113:    must_change_password: Boolean(user.must_change_password),
114:    security_stamp: user.security_stamp,
```

JWT sign:

```js
// security.js:26-42
26:function generateAccessToken(payload) {
38:  if (process.env.JWT_ISSUER) options.issuer = process.env.JWT_ISSUER;
39:  if (process.env.JWT_AUDIENCE) options.audience = process.env.JWT_AUDIENCE;
41:  return jwt.sign(payload, process.env.JWT_SECRET, options);
```

### 5.2 Token/session validation middleware

```js
// auth.js:59-123
59:function requireAuth(req, res, next) {
61:    const authHeader = req.headers.authorization || '';
62:    const [scheme, token] = authHeader.split(' ');
64:    if (scheme !== 'Bearer' || !token) {
66:      return res.status(401).json({ error: 'Authentication required' });
69:    if (token.startsWith('fa_')) {
70:      return authenticateApiToken(token, req, res, next);
73:    const verifyOptions = { algorithms: [JWT_ALGORITHM] };
77:    const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);
85:    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId);
87:    if (!user) {
89:      return res.status(401).json({ error: 'Invalid token' });
92:    if (isAccessTokenBlocked(decoded.jti)) {
94:      return res.status(401).json({ error: 'Invalid token' });
97:    if (!decoded.security_stamp || decoded.security_stamp !== user.security_stamp) {
99:      return res.status(401).json({ error: 'Invalid token' });
102:    const isChangePasswordRoute = req.method === 'PUT' && req.originalUrl.split('?')[0] === '/api/auth/change-password';
103:    if ((decoded.must_change_password || user.must_change_password) && !isChangePasswordRoute) {
104:      return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
112:    if (error.name === 'TokenExpiredError') {
114:      return res.status(401).json({ error: 'Token expired' });
117:    if (error.name === 'JsonWebTokenError') {
119:      return res.status(401).json({ error: 'Invalid token' });
```

Refresh-token rotation:

```js
// authController.js:419-459
419:    db.transaction(() => {
420:      const storedToken = db.prepare(`
421:        SELECT refresh_tokens.*, users.email, users.role, users.is_active, users.must_change_password, users.security_stamp
423:        JOIN users ON users.id = refresh_tokens.user_id
424:        WHERE refresh_tokens.token_hash = ?
425:          AND refresh_tokens.revoked = 0
432:      if (!storedToken.is_active) {
436:      if (new Date(storedToken.expires_at).getTime() <= Date.now()) {
437:        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(storedToken.id);
441:      const revokeResult = db.prepare('UPDATE refresh_tokens SET revoked = 1, last_used_at = ? WHERE id = ? AND revoked = 0').run(createdAt, storedToken.id);
445:      db.prepare(`
446:        INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
459:    return res.status(200).json({ accessToken, refreshToken: nextRefreshToken });
```

### 5.3 Admin vs regular user enforcement

```js
// auth.js:126-144
126:function requireAdmin(req, res, next) {
127:  if (!req.user) {
128:    return res.status(401).json({ error: 'Authentication required' });
131:  if (req.user.role !== 'admin') {
132:    return res.status(403).json({ error: 'Admin access required' });
138:function requireAdminScope(scope) {
140:    if (req.auth?.token_type !== 'admin_api_token') return next();
141:    const scopes = Array.isArray(req.auth.scopes) ? req.auth.scopes : [];
142:    if (scopes.includes(scope) || scopes.includes('admin:*')) return next();
143:    return res.status(403).json({ error: `API token scope required: ${scope}` });
```

All admin routes:

```js
// adminRoutes.js:163
163:router.use(requireAuth, requireAdmin, adminLimiter);
```

### 5.4 Missing auth or role checks

| Route | Current auth | Finding |
|---|---|---|
| `POST /api/client-error` | Public | Accepts unauthenticated client error reports by design/code. `app.js:172-193`. |
| `/health` | Public | Public health exposes uptime, version, `min_app_version`, `last_backup_at`. `app.js:223-241`. |
| Swagger `/api/docs` | Public in non-production | Exposed if NODE_ENV not production. `app.js:203-217`. |
| Financial user routes | `router.use(requireAuth)` | Auth present: accounts `accountRoutes.js:64`, transactions `transactionRoutes.js:106`, budgets `budgetRoutes.js:41`, categories `categoryRoutes.js:32`, announcements `announcementRoutes.js:14`. |
| Admin routes | `requireAuth, requireAdmin` | Role check present: `adminRoutes.js:163`. |

### 5.5 Cross-user access/modify paths

Regular user controllers consistently include `user_id = req.user.id` for financial resources. Examples:

```js
// accountController.js:206
206:    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.id, req.user.id);
// transactionController.js:307
307:    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
// budgetController.js:184
184:    const oldBudget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
```

Intentional admin cross-user access:

```js
// adminController.js:1170-1216
1170:function getAllTransactions(req, res, next) {
1203:    const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t LEFT JOIN users u ON u.id = t.user_id ${whereSql}`).get(...params).count;
1215:    audit(req, 'ADMIN_VIEWED_GLOBAL_TRANSACTIONS', 'transaction', null, null, { filters: req.query, result_count: transactions.length });
```

Potential cross-user data exposure is role-gated to admin. No unauthenticated financial cross-user route found.

### 5.6 User input reaching DB without parameterization/sanitization

Mostly parameterized. Dynamic SQL sites:

```js
// transactionController.js:264-285
264:    for (const [key, column] of [['account_id', 't.account_id'], ['category_id', 't.category_id'], ['type', 't.type']]) {
265:      if (req.query[key]) { where.push(`${column} = ?`); params.push(req.query[key]); }
279:    const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${whereSql}`).get(...params).count;
```

Column names come from hardcoded maps, values are bound parameters. Dynamic `IN` placeholders are generated from validated UUID arrays:

```js
// transactionController.js:466-476
466:function placeholders(values) {
467:  return values.map(() => '?').join(', ');
476:  const rows = db.prepare(`SELECT * FROM transactions WHERE user_id = ? AND admin_deleted_at IS NULL AND id IN (${placeholders(requestedIds)})`).all(userId, ...requestedIds);
```

NOT FOUND - no confirmed raw user-supplied value interpolated directly into SQL without placeholder binding. Dynamic field lists are restricted by hardcoded `allowed` arrays in controllers.

### 5.7 Sensitive/internal data leaks in errors

Final handler hides 500 messages:

```js
// app.js:262-273
262:  logger.error(err.message || 'Unhandled application error', {
268:    stack: err.stack,
271:  res.status(statusCode).json({
272:    error: statusCode === 500 ? 'Internal server error' : err.message,
273:  });
```

Non-500 thrown messages are returned. Examples include operational details:

```js
// transactionController.js:334-339
334:          if (!groupId) throw Object.assign(new Error('Transfer group is missing; cannot safely update amount.'), { statusCode: 409 });
339:            throw Object.assign(new Error('Transfer group is incomplete; both sides must be present before updating amount.'), { statusCode: 409 });
```

Development/test raw reset/verification token response:

```js
// authController.js:124-151
124:  if (['development', 'test'].includes(process.env.NODE_ENV) && process.env.ALLOW_RESET_TOKEN_IN_RESPONSE === 'true') {
125:    response.resetToken = token;
150:  if (['development', 'test'].includes(process.env.NODE_ENV) && process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE === 'true') {
151:    response.verificationToken = token;
```

### 5.8 Token expiry/deleted or deactivated user behavior

Expired access token:

```js
// auth.js:112-115
112:    if (error.name === 'TokenExpiredError') {
113:      recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'token_expired' });
114:      return res.status(401).json({ error: 'Token expired' });
```

Deleted/deactivated user:

```js
// auth.js:85-90
85:    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId);
87:    if (!user) {
89:      return res.status(401).json({ error: 'Invalid token' });
```

Security-stamp invalidation:

```js
// auth.js:97-100
97:    if (!decoded.security_stamp || decoded.security_stamp !== user.security_stamp) {
99:      return res.status(401).json({ error: 'Invalid token' });
```

### 5.9 Rate limiting/brute force/abuse prevention

Present:

```js
// app.js:61-88
61:const globalLimiter = rateLimit({
63:  windowMs: Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
64:  limit: Number(process.env.GLOBAL_RATE_LIMIT_MAX) || 300,
81:const clientErrorLimiter = rateLimit({
83:  windowMs: 60 * 1000,
84:  limit: 10,
```

```js
// authRoutes.js:10-53
10:const loginLimiter = rateLimit({ windowMs: 60 * 1000, limit: 5, ... });
19:const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, ... });
28:const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, ... });
37:const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, ... });
46:const emailVerificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, ... });
```

Login lockout:

```js
// authController.js:346-365
346:    if (!passwordMatches) {
347:      const failedAttempts = (user.failed_login_attempts || 0) + 1;
348:      const lockedUntil = failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
352:      db.prepare(`
353:        UPDATE users
354:        SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
364:      return res.status(401).json({ error: 'Invalid credentials' });
```

### 5.10 Security gotchas

1. CSRF is present but bearer-token API clients are exempt when authorization header exists (`csrfProtection.js:72-98`).
2. Admin API token authentication joins `created_by` user and requires that user active, but access is the creator/admin user's role; token row itself has scopes only checked on selected routes.
3. Webhook secret encryption defaults to `JWT_SECRET` if `WEBHOOK_SECRET_KEY` is missing (`security.js:52-59`), coupling token secret rotation to encrypted webhook secret decryptability.
4. Local mobile biometric lock gates app UI, not SecureStore retrieval itself (see supplemental existing doc; code in `mobile\src\services\secureStorage.ts` stores without access-control options).

## SECTION 6 - ERROR HANDLING & FRAGILE PATHS

### 6.1 Every try/catch block pattern

Backend controllers consistently wrap handlers and call `next(error)`. Examples:

```js
// transactionController.js:180-255
180:function createTransaction(req, res, next) {
181:  try {
...
254:  } catch (error) { return next(error); }
```

```js
// budgetController.js:109-125
109:function createBudget(req, res, next) {
110:  try {
...
125:  } catch (error) { return next(error); }
```

```js
// adminController.js:1170-1219
1170:function getAllTransactions(req, res, next) {
1171:  try {
...
1217:  } catch (error) {
1218:    return next(error);
1219:  }
```

Notable swallowed/logged errors:

```js
// transactionController.js:163-168
163:  void sendPushNotification(
168:  ).catch((pushError) => logger.warn('Budget overspend push failed', { userId, error: pushError.message }));
```

```ts
// mobile\src\services\clientErrors.ts:16-17
16:    await axios.post(`${API_BASE_URL}/api/client-error`, payload, { timeout: 5000 });
17:  } catch {
```

```ts
// mobile\src\screens\transactions\AddTransactionScreen.tsx:99-100
99:      dispatch(fetchAccounts());
100:      api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }).then((response) => setCategories(unwrapList(response.data))).catch(() => setCategories([]));
```

### 6.2 DB operations that can fail and are not wrapped

At module load/startup, DB schema/migrations are not inside request try/catch:

```js
// db.js:1095-1105
1095:function migrate() {
1096:  createTables();
1097:  ensureSchemaUpdates();
1098:  seedDefaultCategories();
1099:  seedAdminAccount();
1100:  seedDefaultCashAccounts();
1101:  purgeDeletedUserArchives();
1102:  recordSchemaVersion(1);
1105:migrate();
```

Within request handlers, most DB operations are inside try/catch. Some helper writes called inside route/middleware are not locally wrapped and rely on caller/final error handling, e.g. API token last-used write:

```js
// auth.js:34-39
34:  const lastWritten = apiTokenLastUsedWritten.get(row.token_id) || 0;
36:  if (nowMs - lastWritten >= API_TOKEN_WRITE_DEBOUNCE_MS) {
37:    db.prepare('UPDATE admin_api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.token_id);
```

### 6.3 Multi-step operations not wrapped in DB transaction

Wrapped correctly in transactions: transaction create/edit/delete, account create/delete, budget create/update/delete, password reset, email verify, login refresh rotation, admin soft delete, admin account delete, admin correction.

Unwrapped multi-step examples:

| Operation | Evidence | Broken state if later step fails |
|---|---|---|
| `updateMe` dynamic user update then read | `authController.js:948-954` | If update succeeds and read fails, profile changed but client sees error. |
| `logout` revoke refresh token, block access token, write audit | `authController.js:469-488` | Refresh token may be revoked before access token block/audit fail. |
| `revokeOtherSessions` validates current then updates others then audit | `authController.js:909-922` | Sessions revoked but audit may fail. |
| `getDashboardStats` reads multiple unrelated stats without snapshot transaction | `adminController.js:456-539` | Counts/totals can be mutually inconsistent if writes occur concurrently. |

### 6.4 Async operations not awaited or promises intentionally unhandled

Fire-and-forget:

```js
// transactionController.js:163-168
163:  void sendPushNotification(...).catch(...)
// transactionController.js:246-251
246:      void sendPushNotification(...).catch(...)
// authController.js:751-756
751:    void sendPushNotification(...).catch(...)
```

Mobile fire-and-forget:

```ts
// TransactionDetailScreen.tsx:63-65
63:            await dispatch(deleteTransaction(route.params.id)).unwrap();
64:            dispatch(fetchTransactions({ page: 1, limit: 20 }));
65:            dispatch(refreshAccounts());
```

### 6.5 Calculations that can produce NaN, Infinity, null, undefined

| Code | Guard | Downstream |
|---|---|---|
| `amountToCents` | Rejects non-finite and too small. `money.js:41-70`. | Throws 400/500 via controller. |
| `centsToAmount` | Non-finite returns original value. `money.js:73-77`. | `serializeMoney` may return original non-finite if numeric not finite. |
| Mobile `formatCurrency(amount || 0)` | Converts `NaN`/null/undefined to `$0`. `AccountCard.tsx:24-25`, `ReportsScreen.tsx:71-72`. | Bad data becomes visually `$0`. |
| `BudgetProgressCard` | `ratio = amount > 0 ? spent / amount : 0`; `progress = Math.min(ratio,1)` no finite guard. `BudgetProgressCard.tsx:17-23`. | If `spent` is `NaN`, width becomes `NaN%`. |
| `OverviewScreen.amountValue` | Returns 0 for non-finite. `OverviewScreen.tsx:77-80`. | Bad data hidden as zero. |
| `ReportsScreen.parseStoredDate` | Invalid date becomes epoch. `ReportsScreen.tsx:87-89`. | Invalid transaction dates are graphed/exported as 1970-01-01 buckets. |

### 6.6 Null DB lookup without check

Checked correctly in core user paths:

```js
// accountController.js:206-207
206:    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.id, req.user.id);
207:    if (!account) return res.status(404).json({ error: 'Account not found' });
```

```js
// budgetController.js:156-158
156:    const budget = db.prepare(`SELECT b.*, c.name AS category_name FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
157:      WHERE b.id = ? AND b.user_id = ?`).get(req.params.id, req.user.id);
158:    if (!budget) return res.status(404).json({ error: 'Budget not found' });
```

Potentially surprising: `createAccountBalanceCorrection` reads account without `is_active = 1`, so inactive accounts can receive correction:

```js
// adminController.js:1364-1365
1364:    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.accountId, req.params.id);
1365:    if (!account) return res.status(404).json({ error: 'Account not found' });
```

### 6.7 Race conditions

| Race | Evidence | Result |
|---|---|---|
| Balance updates use `balance = balance + ?` inside SQLite transactions | `transactionController.js:108`, `accountController.js:35-36` | Atomic per statement; SQLite serializes writes, lower risk. |
| Transfer pair integrity has no DB constraint | `transactionController.js:226-227`, `db.js:145-172` | Concurrent admin/user actions could leave incomplete transfer groups if one path acts between reads and writes. |
| Admin confirmation tokens are process-local Map | `adminRoutes.js:15-36` | Multi-process deployment would lose/fragment confirmation state. |
| API token last-used debounce is process-local | `auth.js:11-39` | Multiple processes write inconsistent last-used timestamps. |
| Mobile offline queue uses `Math.random` temp ids | `transactionsSlice.ts:133-135`, `accountsSlice.ts:72-74`, `budgetsSlice.ts:59-60` | Client-side temp ID collisions possible but low probability. |

### 6.8 User input in calculation without finite/range/type validation

Backend route validators and `amountToCents` cover most money inputs. Notable gaps:

| Input | Code | Gap |
|---|---|---|
| `process.env.LARGE_TRANSACTION_AMOUNT` | `transactionController.js:244` | Env value not startup-validated; bad value throws during transaction create. |
| Mobile numpad `amountNumber = Number(amount || '0')` | `AddTransactionScreen.tsx:112-117,171-179` | Validates positive/max, but string state can display `$0.00` for odd intermediate states. |
| Mobile budget current_spending/amount from API | `BudgetProgressCard.tsx:17-23` | No finite guard before ratio/progress. |

### 6.9 Most dangerous fragility gaps

1. Stored/derived balance duality can corrupt perceived balances if any transaction/balance update path diverges.
2. Admin user transactions include soft-deleted rows by default while user routes do not.
3. Admin dashboard category/daily/new-transaction metrics miss soft-delete filters.
4. Transfer integrity is code-only with no DB constraint.
5. Mobile offline optimistic updates can display uncommitted financial data.

## SECTION 7 - MOBILE / FRONTEND LAYER

### 7.1 API-fetched vs locally computed values

Fetched:

```ts
// DashboardScreen.tsx:102-109
102:      const [settings, accountResult, transactionsResponse, , monthlySummaryResponse, allTimeSummaryResponse, announcementsResponse] = await Promise.all([
104:        dispatch(fetchAccounts()).unwrap(),
105:        api.get<TransactionsResponse>('/api/transactions', { params: { limit: 5, page: 1, start_date: start, end_date: end } }),
106:        dispatch(fetchBudgets()).unwrap(),
107:        api.get<Summary>('/api/transactions/summary', { params: { start_date: start, end_date: end } }),
108:        api.get<Summary>('/api/transactions/summary'),
109:        api.get<{ data: Announcement[] }>('/api/announcements'),
```

Computed locally:

```ts
// DashboardScreen.tsx:80-95
80:  const netWorth = useMemo(
81:    () => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0),
84:  const monthlyChange = (() => {
86:    const raw = (monthlySummary.net / Math.abs(netWorth)) * 100;
92:  const alertCount = useMemo(() => {
93:    const notifications = buildNotifications(budgets, transactions, new Date(), visibleAnnouncements);
```

Overview computed values are at `OverviewScreen.tsx:156-185`. Reports computed values are at `ReportsScreen.tsx:265-272,517-584`.

### 7.2 Mobile formatting, rounding, unit conversion

Hardcoded USD and whole-dollar formatting:

```ts
// AccountCard.tsx:24-25
24:function formatCurrency(amount: number, currency = 'USD') {
25:  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount || 0);
```

```ts
// ReportsScreen.tsx:71-72
71:function formatCurrency(amount: number) {
72:  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
```

```ts
// TransactionListItem.tsx:16-17
16:function formatCurrency(amount: number) {
17:  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount || 0);
```

### 7.3 Stale display/caching risks

| State | Evidence | Risk |
|---|---|---|
| Redux account/transaction/budget arrays | `accountsSlice.ts:172-199`, `transactionsSlice.ts:320-370`, `budgetsSlice.ts:115-126` | Values persist until explicit refetch; failed refresh leaves old values visible with error state in slice. |
| Dashboard local `summary`, `monthlySummary`, `announcements` | `DashboardScreen.tsx:73-79,112-116` | Failed refresh only shows toast, old dashboard stays. |
| Budget daily breakdown cache | `BudgetsScreen.tsx:90,130-147` | Once a budget breakdown is loaded, it is reused even if transactions change until screen state resets. |
| Offline queue optimistic rows | `transactionsSlice.ts:180-190`, `accountsSlice.ts:95-105`, `budgetsSlice.ts:82-85` | Temporary local rows may diverge from rejected backend writes. |

### 7.4 NaN/undefined/null display risks

| Code | Behavior |
|---|---|
| `formatCurrency(amount || 0)` | Hides bad value as `$0` (`AccountCard.tsx:24-25`, `ReportsScreen.tsx:71-72`). |
| `BudgetProgressCard` | `NaN` ratio can produce `NaN%` width (`BudgetProgressCard.tsx:17-23,38`). |
| `TransactionListItem` | Missing `transfer_direction` for transfer is treated negative unless destination (`TransactionListItem.tsx:27-30`). |
| `ReportsScreen.parseStoredDate` | Invalid date becomes epoch (`ReportsScreen.tsx:87-89`). |

### 7.5 Loading states and old value visibility

Examples:

```tsx
// DashboardScreen.tsx:197-203
197:        <View style={styles.accountsBridge}>
199:            {accountsLoading && accounts.length === 0 ? (
200:              <View style={styles.loadingCard}><ActivityIndicator color={theme.colors.highlight} /></View>
201:            ) : accounts.length === 0 ? (
```

If accounts exist, loading does not replace old account cards.

```tsx
// OverviewScreen.tsx:188-195
188:  if (loading && !refreshing) {
190:      <View style={styles.loadingRoot}>
191:        <ActivityIndicator size="large" color={theme.colors.highlight} />
192:        <Text style={styles.loadingText}>Loading overview</Text>
```

Reports loading:

```tsx
// ReportsScreen.tsx:431-439
431:        {error ? (
439:          {loading ? <ChartSkeleton /> : transactions.length ? (
```

### 7.6 Error states

| Screen/service | User sees |
|---|---|
| Dashboard refresh fail | Toast only, old values remain. `DashboardScreen.tsx:121-123`. |
| Overview refresh fail | Toast only. `OverviewScreen.tsx:142-143`. |
| Reports fail | Error banner and transactions cleared. `ReportsScreen.tsx:240-245,431-434`. |
| Budget detail fail | Toast, existing budget remains if already loaded. `BudgetDetailScreen.tsx:72-76`. |
| Categories load fail in transaction screens | Categories set to empty silently/no toast in Add/Edit. `AddTransactionScreen.tsx:99-100`, `EditTransactionScreen.tsx:52`. |
| API refresh failure | Tokens cleared and logout dispatched. `api.ts:139-143`. |

### 7.7 Mobile/backend display gotchas

1. Backend returns dollar values; mobile does not divide by 100, so mobile is correct only because backend serializes.
2. Mobile reports recompute from transaction lists and may miss data if API limit fallback truncates at 100 (`ReportsScreen.tsx:192-201`).
3. Account cards fall back to stored `balance` when `current_balance` is absent (`AccountCard.tsx:45`), masking backend derived-balance mismatch warnings.
4. Multiple screens hardcode USD despite users/accounts having currency fields.

## SECTION 8 - KNOWN BUGS, INCONSISTENCIES & RISK RANKING

### 8.1 Confirmed bugs

**CRITICAL - Admin user transaction endpoint includes admin-deleted rows by default and ignores validated delete filters**

```js
// C:\Users\bemat\OneDrive\Desktop\FinanceApp\backend\src\controllers\adminController.js:920-953
920:    const where = ['t.user_id = ?'];
...
953:    const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${whereSql}`).get(...params).count;
```

What it does: returns all transactions for the user, including rows with `admin_deleted_at` set. Route validators accept `include_deleted` and `admin_deleted` at `adminRoutes.js:102-104`, but controller does not use them.

What it should do: match global admin transaction filter semantics or explicitly document all-rows behavior.

Impact: admin user detail transaction views and exports can display soft-deleted financial activity as active.

**HIGH - Admin dashboard top categories/daily/new transaction metrics include soft-deleted transactions**

```js
// adminController.js:468-477
468:    const newTransactionsThisMonth = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE created_at >= ?').get(monthStart).count;
469:    const topCategories = db.prepare(`
473:      WHERE t.type = 'expense'
```

```js
// adminController.js:499-504
499:    const rows = db.prepare(`
500:      SELECT substr(date, 1, 10) AS date, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
501:      FROM transactions
502:      WHERE date >= ?
```

What it does: omits `admin_deleted_at IS NULL`.

Impact: admin dashboard can report deleted transaction amounts/counts.

**HIGH - Transfer group integrity is not database-enforced**

```sql
-- transactions schema has metadata columns but no group constraint
-- db.js:159-162
transfer_group_id TEXT,
transfer_direction TEXT CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination')),
to_account_id TEXT,
from_account_id TEXT,
```

What it does: code expects exactly two rows but DB allows zero/one/many.

Impact: updates/deletes can become blocked with 409 or admin delete can soft-delete an incomplete subset.

**MEDIUM - Mobile Reports can silently truncate data after limit fallback**

```ts
// ReportsScreen.tsx:192-201
192:async function fetchTransactions(params: Record<string, unknown>, signal?: AbortSignal) {
194:    const response = await api.get<{ data: Transaction[] }>('/api/transactions', { params, signal });
197:    if (Number(params.limit) > 100) {
198:      const response = await api.get<{ data: Transaction[] }>('/api/transactions', { params: { ...params, limit: 100 }, signal });
199:      return response.data.data || [];
```

What it does: if a request with `limit > 100` fails, it retries at 100 and uses that as full data.

Impact: report totals/exports can undercount without telling the user.

**MEDIUM - Budget progress can render invalid width for non-finite API values**

```ts
// BudgetProgressCard.tsx:17-23,38
17:  const spent = Number(budget.current_spending || 0);
18:  const amount = Number(budget.amount || 0);
19:  const ratio = amount > 0 ? spent / amount : 0;
20:  const progress = Math.min(ratio, 1);
38:        <View style={[styles.progress, { width: `${progress * 100}%`, backgroundColor: color }]} />
```

What it does: no `Number.isFinite` guard for `spent`/`amount`.

Impact: unexpected API shape can produce `NaN%` progress.

**LOW - Mobile hardcodes USD/rounds whole dollars in several places**

```ts
// AccountCard.tsx:24-25
24:function formatCurrency(amount: number, currency = 'USD') {
25:  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount || 0);
// ReportsScreen.tsx:71-72
71:function formatCurrency(amount: number) {
72:  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
```

Impact: cents and non-USD user/account currencies can be hidden in UI/report displays.

### 8.2 Inconsistencies

| Concept | Different implementations |
|---|---|
| Transaction delete | User hard delete vs admin soft delete. |
| Account delete | User `is_active=0`; admin hard deletes account. |
| Account delete action | User query param, admin body param with default `cash`. |
| Money formatting | Backend serializes dollars; mobile many screens format with hardcoded USD and different fraction digits. |
| Budget percent | Backend `budgetPercentUsed` rounds to 2 decimals; mobile cards use raw ratio thresholds. |
| Error shapes | `{ error }`, `{ errors: [...] }`, 202 confirmation, auth-specific `{ error, code }`. |
| Soft-delete filters | User transaction routes filter; admin global default filters; admin user transactions and some dashboard metrics do not. |

### 8.3 Duplication/hardcoding that future changes would silently break

1. Transaction types are repeated in DB schema, backend routes, mobile types, and UI filters.
2. Account types are repeated in DB schema, account routes, mobile AccountType, icon maps.
3. Money serialization depends on `MONEY_RESPONSE_KEYS`; new money fields must be manually added.
4. Budget formulas exist in `budgetController.js`, `adminController.js`, `BudgetProgressCard.tsx`, `BudgetsScreen.tsx`, `BudgetDetailScreen.tsx`, `OverviewScreen.tsx`, `notifications.ts`.
5. Date range logic exists separately in backend controllers and mobile `dateRanges`/Reports/Overview.
6. Currency formatters are duplicated across components instead of using one user/account-currency aware helper.

### 8.4 Unvalidated assumptions

| Assumption | Evidence |
|---|---|
| Transfer group has exactly two active rows | Code checks in user update/delete but DB does not enforce. |
| Serialized money key list is complete | `money.js:1-22`. |
| `account.current_balance` is present on all account responses mobile cares about | Mobile falls back to `balance` at `AccountCard.tsx:45`. |
| API transaction list limit can support report ranges | Reports tries 500/1000, then falls back to 100. |
| Process-local admin confirmation and token debounce are enough | `adminRoutes.js:15-36`, `auth.js:11-39`. |
| Dates stored as text parse consistently in JS and SQLite datetime | Date strings throughout schema and query logic. |

### 8.5 Final risk ranking

1. Stored `accounts.balance` vs derived `current_balance`: dangerous because any missed delta creates real financial balance errors; fixing requires a single source of truth or enforced reconciliation.
2. Admin soft-delete filter inconsistency: dangerous because deleted transactions can reappear in admin user views/dashboard totals; fixing requires consistent query semantics.
3. Transfer integrity is code-only: dangerous because incomplete transfer groups block user operations or produce asymmetric balances; fixing requires DB constraints or a transfer parent table.
4. Admin account hard delete plus transaction move/delete paths: dangerous because account deletion semantics differ from user deletion and can rewrite transfer metadata; fixing requires one lifecycle model.
5. Mobile report truncation/fallback: dangerous because exported reports can understate finances; fixing requires paginated fetching or summary endpoints.
6. Money serialization by key name: dangerous because new aggregate fields can leak cents as dollars; fixing requires typed DTOs or explicit serializers.
7. Offline optimistic mutations: dangerous because UI can show unaccepted financial changes; fixing requires pending-state separation and reconciliation.
8. Dashboard aggregate soft-delete omissions: dangerous because admin operational metrics can be wrong; fixing requires shared aggregate query helpers.
9. Hardcoded USD/rounding: dangerous for multi-currency/cents accuracy in user decisions; fixing requires centralized currency formatting.
10. Process-local security state for confirmations/debounce: dangerous in multi-instance deployment; fixing requires DB/shared-store state.
