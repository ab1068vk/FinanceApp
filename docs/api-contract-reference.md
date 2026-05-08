# FinanceApp API Contract Reference

Audited on 2026-05-08 from the Express backend implementation. All paths are relative to the repo root.

Primary evidence:

```js
// backend/src/app.js:172,195-201,223
app.post('/api/client-error', clientErrorLimiter, (req, res) => {
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/admin', adminRoutes);
app.get('/health', (req, res) => {
```

## Shared Contract Rules

### Auth Levels

- `Public`: no bearer token required.
- `User`: `Authorization: Bearer <JWT>` or an accepted bearer token. User routes require an active user.
- `Admin`: `Authorization: Bearer <JWT>` for an active admin, or an active `fa_...` admin API token whose creator is still an admin.
- `Admin + scope`: only admin API tokens are scope-checked. Admin JWTs pass through scope checks.

```js
// backend/src/middleware/auth.js:53-60,116-134
if (scheme !== 'Bearer' || !token) {
  return res.status(401).json({ error: 'Authentication required' });
}
if (token.startsWith('fa_')) {
  return authenticateApiToken(token, req, res, next);
}
if (req.user.role !== 'admin') {
  return res.status(403).json({ error: 'Admin access required' });
}
if (req.auth?.token_type !== 'admin_api_token') return next();
```

### CSRF

State-changing requests require a CSRF token only when there is no bearer token. Auth bootstrap routes are exempt.

```js
// backend/src/middleware/csrfProtection.js:4-14,76-84
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
]);
if (!STATE_CHANGING_METHODS.has(req.method)) return next();
if (AUTH_EXEMPT_PATHS.has(req.path)) return next();
if (hasBearerToken(req)) return next();
```

### Pagination

Most list responses use `{ data: T[], pagination }`. `pagination` contains both camel-ish legacy and snake-ish keys.

```js
// backend/src/utils/pagination.js:1-21
const pageSize = Math.min(Math.max(Number.parseInt(String(req.query.limit || req.query.page_size || defaultPageSize), 10) || defaultPageSize, 1), maxPageSize);
return {
  total_count: total,
  page,
  page_size: pageSize,
  total_pages: totalPages,
  total,
  limit: pageSize,
  totalPages,
};
```

`PaginationMeta` response shape:

```ts
{
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  total: number;
  limit: number;
  totalPages: number;
}
```

### Money Fields

Request money fields are decimal major currency units, validated to at most two decimals. DB storage is integer cents. Response serialization converts selected numeric keys back to decimal units.

```js
// backend/src/utils/money.js:1-22,24-48,62-70
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
  'net',
  'spending',
  'spent',
  'overBy',
  'target_balance',
  'delta',
  'total_income',
  'total_expense',
  'total_account_balance',
  'transaction_total',
]);
return sign * abs;
return Math.round(cents) / 100;
if (MONEY_RESPONSE_KEYS.has(childKey) && typeof childValue === 'number') {
  return [childKey, centsToAmount(childValue)];
}
```

## Core Schemas

These are the response shapes returned by controllers. Fields marked derived are computed in SQL/controller code, not stored directly.

### User

```ts
{
  id: string;
  email: string;
  full_name: string;
  avatar_color: string | null;
  role: 'user' | 'admin';
  is_active: 0 | 1;
  created_at: string;
  updated_at: string | null;
  last_login: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  must_change_password: 0 | 1;
  email_verified_at: string | null;
  currency: string;
  has_completed_onboarding: 0 | 1;
  security_stamp: string;
}
```

`password_hash` is present in the DB but removed from every sanitized user response. `security_stamp` remains returned by `sanitizeUser`.

```js
// backend/database/db.js:92-109
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  security_stamp TEXT NOT NULL DEFAULT (lower(hex(randomblob(32))))
);

// backend/src/utils/security.js:90-97
const safeUser = { ...user };
delete safeUser.password_hash;
return safeUser;
```

### Account

```ts
{
  id: string;
  user_id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'cash';
  balance: number;              // response dollars, DB cents
  overdraft_limit: number | null; // response dollars, DB cents
  currency: string;
  color: string | null;
  icon: string | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string | null;
  current_balance?: number;     // derived, response dollars
  recent_transactions?: Transaction[];
  transaction_count?: number;   // admin derived
}
```

```js
// backend/database/db.js:128-140
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('checking', 'savings', 'credit', 'investment', 'cash')),
  balance INTEGER DEFAULT 0,
  overdraft_limit INTEGER,
  currency TEXT DEFAULT 'USD',
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1))
);

// backend/src/controllers/accountController.js:143-146
const accounts = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
  FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
return res.json({ data: serializeMoney(accounts), pagination: paginationMeta(page, limit, total) });
```

### Transaction

```ts
{
  id: string;
  user_id: string;
  account_id: string | null;
  category_id: string | null;
  type: 'income' | 'expense' | 'transfer';
  amount: number;                  // response dollars, DB cents
  description: string | null;
  note: string | null;
  date: string;
  recurring: 0 | 1;
  recurring_interval: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  receipt_path: string | null;
  tags: string | null;             // JSON string in responses, array in create/update requests
  transfer_group_id: string | null;
  transfer_direction: 'source' | 'destination' | null;
  to_account_id: string | null;
  from_account_id: string | null;
  admin_deleted_at: string | null;
  admin_deleted_by: string | null;
  admin_delete_reason: string | null;
  created_at: string;
  updated_at: string | null;
  category_name?: string | null;   // joined
  account_name?: string | null;    // joined
  user_email?: string | null;      // admin joined
  user_full_name?: string | null;  // admin joined
}
```

```js
// backend/database/db.js:144-170
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT,
  category_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  tags TEXT,
  transfer_group_id TEXT,
  transfer_direction TEXT CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination')),
  admin_deleted_at TEXT,
  admin_deleted_by TEXT,
  admin_delete_reason TEXT
);

// backend/src/controllers/transactionController.js:184-190
const base = {
  id: crypto.randomUUID(), user_id: req.user.id, account_id: account.id, category_id: categoryId,
  type: req.body.type, amount, description: sanitizeText(req.body.description), note: sanitizeText(req.body.note),
  date: transactionDate, recurring: req.body.recurring ? 1 : 0,
  recurring_interval: req.body.recurring_interval || null, receipt_path: req.body.receipt_path || null,
  tags: JSON.stringify(parseTags(req.body.tags)), transfer_group_id: null, transfer_direction: null,
};
```

### Budget

```ts
{
  id: string;
  user_id: string;
  category_id: string | null;
  amount: number;                  // response dollars, DB cents
  period: 'monthly' | 'weekly' | 'yearly';
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string | null;
  category_name?: string | null;
  category_icon?: string | null;
  category_color?: string | null;
  current_spending?: number;       // derived, response dollars
  remaining?: number;              // derived, response dollars
  percent_used?: number;           // derived percent, not money
  weekly_breakdown?: { week: string; spending: number }[];
  status?: 'over' | 'within';      // admin derived
}
```

```js
// backend/src/controllers/budgetController.js:113-126
const budgets = db.prepare(`SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = b.user_id AND t.category_id = b.category_id
    AND t.type = 'expense' AND t.admin_deleted_at IS NULL AND datetime(t.date) >= datetime(b.start_date)
    AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date, '+1 day', '-1 second'))), 0) AS current_spending
  FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
return res.json({ data: serializeMoney(data), pagination: paginationMeta(page, limit, total) });
```

### Category

```ts
{
  id: string;
  user_id: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  type: 'income' | 'expense';
  is_default: 0 | 1;
  is_system: 0 | 1;
  is_active: 0 | 1;
  sort_order: number;
  created_at: string;
}
```

```js
// backend/database/db.js:112-126
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
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Announcement

```ts
{
  id: string;
  title: string;
  body: string;
  is_active?: 0 | 1;       // admin responses only
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string | null;
  created_by?: string | null; // admin responses only
}
```

```js
// backend/src/controllers/announcementController.js:19-32
const rows = db.prepare(`
  SELECT a.id, a.title, a.body, a.starts_at, a.ends_at, a.created_at, a.updated_at
  FROM announcements a
...
return res.json({ data: rows, pagination: paginationMeta(page, limit, total) });

// backend/src/controllers/adminController.js:1726-1728
const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
return res.json({ data: rows, pagination: paginationMeta(page, limit, total) });
```

## Route Index

### Public And System

| Method | Path | Auth | One-line behavior | Request body | Success response | Evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/health` | Public | Health probe with DB status and runtime metadata. | None | `{ status: 'ok' \| 'degraded', service: string, uptime: number, db: 'ok' \| 'error', timestamp: string, version: string, min_app_version: string, last_backup_at: string \| null }` | `backend/src/app.js:223-241` `res.status(...).json({ status, service, uptime, db, timestamp, version, min_app_version, last_backup_at })` |
| `POST` | `/api/client-error` | Public | Accepts client-side error telemetry and logs it. | `{ message?: string, stack?: string, screen?: string, appVersion?: string, platform?: string, type?: string, metadata?: object }` | `202 { success: true }` | `backend/src/app.js:172-193` `logger.error('Client-side error reported', ...); res.status(202).json({ success: true })` |
| `GET` | `/api/docs` | Public, dev only | Swagger UI in non-production if optional packages are installed. | None | HTML Swagger UI | `backend/src/app.js:217` `app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));` |

### Auth Routes

Base evidence for validators and route bindings:

```js
// backend/src/routes/authRoutes.js:206-265
router.post('/register', registerLimiter, registerValidation, validate, authController.register);
router.post('/login', loginLimiter, loginValidation, validate, authController.login);
router.post('/forgot-password', passwordResetLimiter, forgotPasswordValidation, validate, authController.forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPasswordValidation, validate, authController.resetPassword);
router.post('/verify-email', emailVerificationLimiter, [verificationTokenRule()], validate, authController.verifyEmail);
router.post('/resend-verification', emailVerificationLimiter, forgotPasswordValidation, validate, authController.resendVerification);
router.get('/csrf', authController.getCsrfToken);
router.post('/refresh', refreshLimiter, [refreshTokenRule()], validate, authController.refreshToken);
router.post('/logout', requireAuth, [refreshTokenRule()], validate, authController.logout);
router.put('/change-password', requireAuth, changePasswordLimiter, changePasswordValidation, validate, authController.changePassword);
router.get('/me', requireAuth, authController.getMe);
```

| Method | Path | Auth | One-line behavior | Request body | Success response | Notes/evidence |
|---|---|---:|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Creates a user and default cash account, or privacy-preserves duplicate registration. | Required `{ email: string, password: string, full_name: string }` | Email verification required: `201 { success: true, message: string, verificationToken?: string }`; no verification: `201 { success: true, message: string }` | `backend/src/routes/authRoutes.js:163-167`; `backend/src/controllers/authController.js:226,276,279-282` |
| `POST` | `/api/auth/login` | Public | Exchanges credentials for tokens and sanitized user. | Required `{ email: string, password: string }` | `200 { accessToken: string, refreshToken: string, user: User }` | `backend/src/routes/authRoutes.js:169-177`; `backend/src/controllers/authController.js:400-404` |
| `POST` | `/api/auth/forgot-password` | Public | Creates and delivers password reset token without revealing whether email exists. | Required `{ email: string }` | `200 { success: true, message: string, resetToken?: string }` | `backend/src/controllers/authController.js:118-128,506-543` |
| `POST` | `/api/auth/reset-password` | Public | Consumes reset token and sets new password. | Required `{ resetToken: string, newPassword: string }` | `200 { success: true, message: string }` | `backend/src/routes/authRoutes.js:193-196`; `backend/src/controllers/authController.js:549-598` |
| `POST` | `/api/auth/verify-email` | Public | Consumes verification token. | Required `{ verificationToken: string }` | `200 { success: true, message: string }` | `backend/src/routes/authRoutes.js:198-210`; `backend/src/controllers/authController.js:604-647` |
| `POST` | `/api/auth/resend-verification` | Public | Sends a new verification token without revealing account state. | Required `{ email: string }` | `200 { success: true, message: string, verificationToken?: string }` | `backend/src/controllers/authController.js:653-674` |
| `GET` | `/api/auth/csrf` | Public | Returns current CSRF token. | None | `{ csrfToken: string }` | `backend/src/controllers/authController.js:847-848` |
| `POST` | `/api/auth/refresh` | Public | Rotates refresh token and issues new access token. | Required `{ refreshToken: string }` | `200 { accessToken: string, refreshToken: string }` | `backend/src/controllers/authController.js:410-470` |
| `POST` | `/api/auth/logout` | User | Revokes the given refresh token and blocks current access token. | Required `{ refreshToken: string }` | `200 { success: true }` | `backend/src/controllers/authController.js:476-495` |
| `PUT` | `/api/auth/change-password` | User | Changes current user's password and rotates sessions. | Required `{ currentPassword: string, newPassword: string }` | `200 { success: true, accessToken: string, refreshToken: string }` | `backend/src/routes/authRoutes.js:179-186`; `backend/src/controllers/authController.js:680-756` |
| `GET` | `/api/auth/me` | User | Returns current sanitized user. | None | `User` | `backend/src/controllers/authController.js:843-844` |
| `PATCH` | `/api/auth/me` | User | Updates profile fields. | Optional `{ full_name?: string, avatar_color?: string, currency?: string, has_completed_onboarding?: boolean }`; at least one required at runtime | `User` | `backend/src/routes/authRoutes.js:240-265`; `backend/src/controllers/authController.js:913-938` |
| `GET` | `/api/auth/sessions` | User | Lists active refresh sessions. | None | `{ active_sessions: number, sessions: { id: string, created_at: string, expires_at: string, last_used_at: string \| null, user_agent: string \| null, device_hint: string }[] }` | `backend/src/controllers/authController.js:851-866` |
| `DELETE` | `/api/auth/sessions/others` | User | Revokes all other refresh sessions. | Required `{ refreshToken: string }` | `{ success: true, revoked: number }` | `backend/src/controllers/authController.js:889-907` |
| `DELETE` | `/api/auth/sessions/:sessionId` | User | Revokes one session by UUID. | None | `{ success: true, revoked: 1 }` | `backend/src/routes/authRoutes.js:219`; `backend/src/controllers/authController.js:872-883` |
| `POST` | `/api/auth/push-token` | User | Registers or updates a push token. | Required `{ token: string, platform: string }` | `201 { success: true }` | `backend/src/routes/authRoutes.js:220-223`; `backend/src/controllers/authController.js:762-771` |
| `DELETE` | `/api/auth/push-token` | User | Deletes a push token for this user. | Required `{ token: string }` | `{ success: true, deleted: number }` | `backend/src/routes/authRoutes.js:224-226`; `backend/src/controllers/authController.js:777-781` |
| `GET` | `/api/auth/notification-settings` | User | Returns notification preference map. | None | `{ preferences: Record<string, boolean> }` | `backend/src/controllers/authController.js:787-793` |
| `PUT` | `/api/auth/notification-settings` | User | Updates known notification preference keys only. | Required `{ preferences: Record<string, boolean> }` | `{ preferences: Record<string, boolean> }` | `backend/src/routes/authRoutes.js:227-230`; `backend/src/controllers/authController.js:799-810` |
| `GET` | `/api/auth/notifications` | User | Lists latest user notifications. Query: `limit?: number` (runtime clamp 1-100, no route validation). | None | `{ data: { id: string, user_id: string, type: string, title: string, body: string, data_json: string \| null, read_at: string \| null, created_at: string }[] }` | `backend/src/controllers/authController.js:816-826` |
| `PATCH` | `/api/auth/notifications/:id/read` | User | Marks a notification read. | None | `{ success: true, read_at: string }` | `backend/src/routes/authRoutes.js:232-234`; `backend/src/controllers/authController.js:832-837` |
| `GET` | `/api/auth/data` | User | Downloads user's data as JSON. | None | JSON file `{ exported_at, user, accounts, transactions, budgets, categories, audit_logs }` | `backend/src/controllers/authController.js:944-973` |
| `DELETE` | `/api/auth/data` | User | Deletes user financial data and recreates default cash account. | None | `{ success: true, deleted: { transactions: number, budgets: number, accounts: number, categories: number } }` | `backend/src/controllers/authController.js:979-1004` |
| `DELETE` | `/api/auth/account` | User | Anonymizes/deactivates user's account after confirmation. | Required `{ confirmation: 'DELETE' }` | `{ success: true, deleted: { transactions: number, budgets: number, accounts: number, categories: number } }` | `backend/src/routes/authRoutes.js:237-239`; `backend/src/controllers/authController.js:1010-1054` |

### Account Routes

```js
// backend/src/routes/accountRoutes.js:25-56
const createRules = [
  body('name').trim().isLength({ min: 1, max: 50 }),
  body('type').isIn(validTypes),
  body('currency').trim().isLength({ min: 3, max: 3 }).isAlpha(),
  body('color').matches(/^#[0-9A-Fa-f]{6}$/),
  body('icon').isString().bail().isLength({ min: 1, max: 50 }),
  moneyFormat('balance', { min: 0, message: 'balance must be a non-negative number' }),
  moneyFormat('overdraft_limit', { min: 0, message: 'overdraft_limit must be a non-negative number' }),
];
router.use(requireAuth);
router.get('/', controller.getAccounts);
router.post('/', createRules, validate, controller.createAccount);
```

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Notes/evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/accounts` | User | Lists active accounts. Query: `page?: int`, `limit?: int`, `page_size?: int`. | None | `{ data: Account[], pagination: PaginationMeta }` | `backend/src/controllers/accountController.js:139-146` |
| `POST` | `/api/accounts` | User | Creates an account and, if balance is non-zero, creates an opening transaction. | Required `{ name: string, type: AccountType, currency: string, color: string, icon: string }`; optional `{ balance?: number|string, overdraft_limit?: number|string }` | `201 Account` | `backend/src/controllers/accountController.js:90-135` |
| `GET` | `/api/accounts/:id` | User | Gets one active account plus recent transactions. | None | `Account & { recent_transactions: Transaction[] }` | `backend/src/controllers/accountController.js:150-158` |
| `PUT` | `/api/accounts/:id` | User | Updates mutable account display/limit fields. | Optional `{ name?: string, currency?: string, color?: string, icon?: string|null, balance?: number|string, overdraft_limit?: number|string }`; at least one accepted field required. Note: route validates `balance` but controller does not include it in `allowed`, so balance is ignored and can still produce "No allowed fields provided". | `Account` | `backend/src/routes/accountRoutes.js:34-41`; `backend/src/controllers/accountController.js:167-199` |
| `DELETE` | `/api/accounts/:id?transaction_action=delete\|cash` | User | Deactivates account; with transactions, caller must choose delete or move to Cash. | No JSON body. Query `transaction_action?: 'delete'|'cash'` | Normal: `{ success: true, transactions: { action: 'none'|'delete'|'cash', deleted: number, moved: number, cash_account_id: string|null } }`; missing action with transactions: `400 { error, transaction_count, actions }` | `backend/src/controllers/accountController.js:203-231` |

### Transaction Routes

```js
// backend/src/routes/transactionRoutes.js:65-114
const createRules = [
  body('account_id').optional({ nullable: true, checkFalsy: true }).isUUID(),
  body('to_account_id').if(body('type').equals('transfer')).isUUID(),
  body('category_id').custom((value, { req }) => { ... }),
  body('type').isIn(types),
  positiveMoney(body('amount'), 'amount'),
  body('date').custom(isIsoDate),
  body('tags').optional({ nullable: true }).isArray(),
];
router.use(requireAuth);
router.get('/', filters, validate, controller.getTransactions);
router.post('/', createRules, validate, controller.createTransaction);
```

Filters for `GET /api/transactions` and `/summary`: `account_id?: uuid`, `category_id?: uuid`, `type?: income|expense|transfer`, `start_date?: ISO`, `end_date?: ISO`, `date_from?: ISO`, `date_to?: ISO`, `min_amount?: decimal`, `max_amount?: decimal`, `search?: string`, `page?: int`, `limit?: int`, `page_size?: int`.

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Notes/evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/transactions` | User | Lists non-admin-deleted transactions. | Query filters above | `{ data: Transaction[], pagination: PaginationMeta }` | `backend/src/controllers/transactionController.js:246-275` |
| `POST` | `/api/transactions` | User | Creates income/expense, or creates paired source/destination transfer rows. | Required `{ type, amount, date }`; required unless transfer `{ category_id }`; optional `{ account_id?: uuid|null }` defaults to Cash; transfer requires `{ to_account_id: uuid }`; optional `{ description?: string|null, note?: string|null, tags?: string[], receipt_path?: string|null, recurring?: boolean, recurring_interval?: 'daily'|'weekly'|'monthly'|'yearly'|null }` | Income/expense: `201 Transaction`; transfer: `201 { transactions: Transaction[] }` | `backend/src/controllers/transactionController.js:170-242` |
| `GET` | `/api/transactions/summary` | User | Summarizes income, expense, net, and category totals. | Query date filters supported; other validated filters are ignored except dates. | `{ total_income: number, total_expense: number, net: number, grouped_by_category: { category_id: string|null, category_name: string, type: string, total: number }[] }` | `backend/src/controllers/transactionController.js:403-437` |
| `DELETE` | `/api/transactions/bulk` | User | Deletes selected transactions; transfer ids expand to both sides. | Required `{ transaction_ids: string[] }` | `{ success: true, deleted: number }` | `backend/src/routes/transactionRoutes.js:97-110`; `backend/src/controllers/transactionController.js:492-506` |
| `PATCH` | `/api/transactions/bulk/category` | User | Sets category for selected transactions. | Required `{ transaction_ids: string[], category_id: string }` | `{ success: true, updated: number }` | `backend/src/routes/transactionRoutes.js:101-111`; `backend/src/controllers/transactionController.js:512-527` |
| `GET` | `/api/transactions/:id` | User | Gets one non-admin-deleted transaction. | None | `Transaction` | `backend/src/controllers/transactionController.js:279-285` |
| `PUT` | `/api/transactions/:id` | User | Updates mutable transaction fields; type is immutable. | Optional `{ amount?: decimal, description?: string|null, note?: string|null, category_id?: uuid, date?: ISO, tags?: string[]|null, receipt_path?: string|null }`; at least one required. | `Transaction`. For transfer amount changes, both rows are updated but response is only the requested row. | `backend/src/controllers/transactionController.js:289-367` |
| `DELETE` | `/api/transactions/:id` | User | Deletes a transaction; transfer deletion deletes both sides. | None | `{ success: true, deleted: number }` | `backend/src/controllers/transactionController.js:371-399` |

### Budget Routes

```js
// backend/src/routes/budgetRoutes.js:25-46
const createRules = [
  decimalAmount(body('amount').notEmpty()),
  body('category_id').isUUID(),
  body('period').isIn(periods),
  body('start_date').custom(isIsoDate),
  body('end_date').optional({ nullable: true, checkFalsy: true }).custom(isIsoDate),
];
router.use(requireAuth);
```

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Notes/evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/budgets` | User | Lists budgets with current spending and progress. Query: `page?: int`, `limit?: int`, `page_size?: int`. | None | `{ data: Budget[], pagination: PaginationMeta }` | `backend/src/controllers/budgetController.js:109-126` |
| `POST` | `/api/budgets` | User | Creates a non-overlapping budget for a visible category. | Required `{ amount: decimal, category_id: uuid, period: 'monthly'|'weekly'|'yearly', start_date: ISO }`; optional `{ end_date?: ISO|null }` | `201 Budget` | `backend/src/controllers/budgetController.js:92-105` |
| `GET` | `/api/budgets/:id` | User | Gets one budget with spending summary and weekly breakdown. | None | `Budget & { current_spending, remaining, percent_used, weekly_breakdown }` | `backend/src/controllers/budgetController.js:130-154` |
| `PUT` | `/api/budgets/:id` | User | Updates budget fields and prevents overlap. | Optional `{ amount?: decimal, category_id?: uuid, period?: 'monthly'|'weekly'|'yearly', start_date?: ISO, end_date?: ISO|null }`; at least one required. | `Budget` without derived spending fields | `backend/src/controllers/budgetController.js:158-188` |
| `DELETE` | `/api/budgets/:id` | User | Deletes a budget. | None | `{ success: true }` | `backend/src/controllers/budgetController.js:192-198` |

### Category Routes

```js
// backend/src/routes/categoryRoutes.js:14-37
const createRules = [
  body('name').trim().isLength({ min: 1, max: 50 }),
  body('icon').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 50 }),
  body('color').optional({ nullable: true, checkFalsy: true }).matches(/^#[0-9A-Fa-f]{6}$/),
  body('type').isIn(types),
];
router.use(requireAuth);
```

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Notes/evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/categories` | User | Lists active default and user categories, hiding default duplicates shadowed by user categories. Query pagination. | None | `{ data: Category[], pagination: PaginationMeta }` | `backend/src/controllers/categoryController.js:34-61` |
| `POST` | `/api/categories` | User | Creates a custom category. | Required `{ name: string, type: 'income'|'expense' }`; optional `{ icon?: string|null, color?: '#RRGGBB'|null }` | `201 Category` | `backend/src/controllers/categoryController.js:65-78` |
| `PUT` | `/api/categories/reorder` | User | Reorders owned custom categories. | Required `{ category_ids: string[] }` | `Category[]` without `user_id`, `is_system`, `is_active` because reorder query selects only `id,name,icon,color,type,is_default,sort_order,created_at`. | `backend/src/controllers/categoryController.js:104-118` |
| `PUT` | `/api/categories/:id` | User | Updates owned custom category. | Optional `{ name?: string, icon?: string|null, color?: string|null, type?: 'income'|'expense' }`; at least one required. | `Category` | `backend/src/controllers/categoryController.js:85-100` |
| `DELETE` | `/api/categories/:id` | User | Deletes owned custom category. | None | `{ success: true }` | `backend/src/controllers/categoryController.js:122-128` |

### Announcement Routes

```js
// backend/src/routes/announcementRoutes.js:14-16
router.use(requireAuth);
router.get('/', controller.getActiveAnnouncements);
router.post('/:id/dismiss', idParam, validate, controller.dismissAnnouncement);
```

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Notes/evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/announcements` | User | Lists active, date-valid, not-dismissed announcements. Query pagination. | None | `{ data: Announcement[], pagination: PaginationMeta }`; user shape excludes `is_active` and `created_by`. | `backend/src/controllers/announcementController.js:4-32` |
| `POST` | `/api/announcements/:id/dismiss` | User | Marks an announcement dismissed for current user. | None | `{ success: true, id: string }` | `backend/src/controllers/announcementController.js:38-46` |

## Admin Routes

All admin routes use:

```js
// backend/src/routes/adminRoutes.js:147
router.use(requireAuth, requireAdmin, adminLimiter);
```

Some routes return a confirmation challenge before performing the action outside `NODE_ENV=test`:

```js
// backend/src/routes/adminRoutes.js:17-35
const provided = req.body?.confirmation_token || req.get('x-confirmation-token');
return res.status(202).json({
  requires_confirmation: true,
  confirmation_token: token,
  expires_in_seconds: 60,
  action,
});
```

### Admin Dashboard, Users, Audit, Reports

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/admin/dashboard` | Admin | Returns global counts, top categories, daily volume, and security summary. | None | `{ total_users, total_transactions, total_accounts, deleted_users_count, new_users_this_month, new_transactions_this_month, top_5_categories_by_spending, daily_transaction_volume, system_health, security }` | `backend/src/controllers/adminController.js:434-519` |
| `GET` | `/api/admin/users` | Admin | Lists users with account/transaction counts. | Query `role?: 'user'|'admin'`, `is_active?: boolean`, `search?: string`, `page?: int`, `limit?: int`, `page_size?: int`; runtime also supports undocumented `locked=true`. | `{ data: (User & { account_count: number, transaction_count: number })[], pagination }` | `backend/src/routes/adminRoutes.js:257-262`; `backend/src/controllers/adminController.js:525-564` |
| `GET` | `/api/admin/users/:id` | Admin | Returns one user, aggregate summary, recent audit logs. | None | `{ user: User, summary: { account_count, active_account_count, total_account_balance, transaction_count, transaction_total, budget_count, refresh_token_count }, recent_audit_logs: AuditLog[] }` | `backend/src/controllers/adminController.js:570-591` |
| `GET` | `/api/admin/users/:id/sessions` | Admin | Lists active sessions for a user. | Query pagination. | `{ data: { id,user_id,family_id,created_at,last_used_at,expires_at,user_agent }[], pagination }` | `backend/src/controllers/adminController.js:597-617` |
| `PUT` | `/api/admin/users/:id/status` | Admin | Activates/deactivates user; cannot change self or remove last admin. | Required `{ is_active: boolean }` | `User` | `backend/src/routes/adminRoutes.js:293`; `backend/src/controllers/adminController.js:623-638` |
| `PUT` | `/api/admin/users/:id/role` | Admin | Changes role and revokes sessions; cannot change self or remove last admin. | Required `{ role: 'user'|'admin' }` | `User` | `backend/src/routes/adminRoutes.js:294`; `backend/src/controllers/adminController.js:712-726` |
| `POST` | `/api/admin/users/:id/reset-password` | Admin | Sets temporary password, requires user to change it. | Optional `{ temporary_password?: string }`; omitted generates one. | `{ success: true, must_change_password: true, temporary_password: string, delivery: { channel: string, sent: boolean, reason?: string, error?: string } }` | `backend/src/routes/adminRoutes.js:295`; `backend/src/controllers/adminController.js:732-769` |
| `DELETE` | `/api/admin/users/:id` | Admin + confirmation | Hard-deletes user and archives summary. | Confirmation can be body/header from 202 challenge. | First call may be `202 { requires_confirmation, confirmation_token, expires_in_seconds, action }`; confirmed success `{ success: true, deleted: true, hard_deleted: true, archive_id: string }` | `backend/src/routes/adminRoutes.js:296`; `backend/src/controllers/adminController.js:775-839` |
| `POST` | `/api/admin/users/bulk` | Admin | Bulk activate/deactivate/force password reset, excluding self. | Required `{ user_ids: string[], action: 'activate'|'deactivate'|'force_password_reset', reason: string }` | `{ success: true, action: string, affected: number }` | `backend/src/routes/adminRoutes.js:178-183`; `backend/src/controllers/adminController.js:1522-1546` |
| `GET` | `/api/admin/deleted-users` | Admin | Lists hard-deleted user archive rows. | Query `search?: string`, `date_from/start_date?: ISO`, `date_to/end_date?: ISO`, pagination. | `{ data: DeletedUser[], pagination }` | `backend/src/controllers/adminController.js:659-689` |
| `GET` | `/api/admin/deleted-users/:id` | Admin | Gets deleted-user archive by archive id or original user id. | None | `{ user: DeletedUser without details_json, details: object }` | `backend/src/controllers/adminController.js:695-706` |
| `GET` | `/api/admin/audit-logs` | Admin | Lists enriched audit logs. | Query `user_id?: uuid`, `action?: string`, date filters, pagination. | `{ data: (AuditLog & { action_label: string, summary: string })[], pagination }` | `backend/src/controllers/adminController.js:845-881` |
| `GET` | `/api/admin/audit-retention` | Admin | Returns audit retention metadata. | None | `{ oldest: string|null, newest: string|null, count: number, log_size_mb: number, retention_months: number }` | `backend/src/controllers/adminController.js:1568-1575` |
| `POST` | `/api/admin/audit-retention/purge` | Admin + `db:maintenance` + confirmation | Purges audit logs older than a timestamp. | Required `{ before: ISO, confirmation_token?: string }` | 202 confirmation or `{ success: true, purged: number, before: string }` | `backend/src/routes/adminRoutes.js:185-187`; `backend/src/controllers/adminController.js:1581-1589` |
| `GET` | `/api/admin/system-health` | Admin | Returns DB/log/session/runtime memory health. | None | `{ db_size_mb, log_count, log_size_mb, active_sessions, uptime_seconds, heap_used_mb, heap_limit_mb }` | `backend/src/controllers/adminController.js:1121-1135` |
| `GET` | `/api/admin/reports` | Admin | Returns monthly finance, cohorts, and category report data. | None | `{ monthly_financials: { month,income,expense,count,net }[], cohorts: { month,signups,ever_logged_in }[], categories: { category_name,type,count,total }[] }` | `backend/src/controllers/adminController.js:1654-1686` |
| `GET` | `/api/admin/reports/export?type=monthly\|categories` | Admin | Downloads report CSV. | Query `type?: 'monthly'|'categories'`, default `monthly`. | `text/csv` attachment. Monthly headers: `month,income,expense,count`; categories headers: `category_name,type,count,total`. | `backend/src/routes/adminRoutes.js:193-196`; `backend/src/controllers/adminController.js:1692-1717` |

### Admin Transactions And User Data

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/admin/transactions` | Admin | Lists all transactions with user/account/category joins. | Query `user_id?, account_id?, category_id?, type?, start_date/end_date/date_from/date_to?, min_amount?, max_amount?, include_deleted?: boolean, admin_deleted?: boolean, search?, pagination`. | `{ data: Transaction[], pagination }` | `backend/src/routes/adminRoutes.js:75-89,149`; `backend/src/controllers/adminController.js:1141-1187` |
| `GET` | `/api/admin/transactions/:id` | Admin | Gets any transaction, including admin-deleted. | None | `Transaction` with `user_email,user_full_name`. | `backend/src/controllers/adminController.js:1193-1205` |
| `DELETE` | `/api/admin/transactions/:id` | Admin + `write:transactions` for API tokens | Soft-deletes a transaction; transfer group expands to related rows. | Required `{ reason: string }` | `{ success: true, deleted: number, reason: string }` | `backend/src/routes/adminRoutes.js:151-154`; `backend/src/controllers/adminController.js:1211-1233` |
| `GET` | `/api/admin/users/:id/transactions` | Admin | Lists one user's transactions. | Same transaction filters, but `user_id` query is validated yet ignored because path id is used. | `{ data: Transaction[], pagination }` | `backend/src/routes/adminRoutes.js:306`; `backend/src/controllers/adminController.js:887-943` |
| `GET` | `/api/admin/users/:id/spending-by-category` | Admin | Aggregates user's expense spending by category. | Query `start_date?: ISO`, `end_date?: ISO`. | `{ data: { category_id, category_name, category_color, transaction_count, total, percent }[], total: number }` | `backend/src/controllers/adminController.js:949-973` |
| `GET` | `/api/admin/users/:id/login-history` | Admin | Lists user auth/security audit events. | Query date filters and pagination. | `{ data: AuditLog[], pagination }` (not enriched) | `backend/src/controllers/adminController.js:979-997` |
| `GET` | `/api/admin/users/:id/budget-performance` | Admin | Lists user's budgets with progress and `status`. | None | `{ data: (Budget & { current_spending, remaining, percent_used, status })[] }` | `backend/src/controllers/adminController.js:1003-1030` |
| `GET` | `/api/admin/users/:id/accounts` | Admin | Lists user's accounts with transaction counts. | None | `{ data: (Account & { transaction_count: number })[] }` | `backend/src/controllers/adminController.js:1239-1251` |
| `PUT` | `/api/admin/users/:id/accounts/:accountId/status` | Admin | Sets account active flag. | Required `{ is_active: boolean }`; optional `{ reason?: string }` | `Account` | `backend/src/routes/adminRoutes.js:269-274`; `backend/src/controllers/adminController.js:1257-1267` |
| `DELETE` | `/api/admin/users/:id/accounts/:accountId` | Admin | Deletes an active user account, moving transactions to Cash by default. | Required `{ reason: string }`; optional `{ transaction_action?: 'cash'|'delete' }`, default `cash`. | `{ success: true, account_id: string, reason: string, transactions: { action, deleted, moved, cash_account_id } }` | `backend/src/routes/adminRoutes.js:275-280`; `backend/src/controllers/adminController.js:1273-1326` |
| `POST` | `/api/admin/users/:id/accounts/:accountId/correction` | Admin + confirmation | Creates balance correction transaction to reach target balance. | Required `{ target_balance: decimal, reason: string, confirmation_token?: string }` | 202 confirmation or `201 { transaction: Transaction, account: Account }` | `backend/src/routes/adminRoutes.js:281-286`; `backend/src/controllers/adminController.js:1332-1379` |
| `GET` | `/api/admin/users/:id/export` | Admin | Streams paged JSON export for a user. | Query `limit?: int 1..50000`, `cursor?: string`. | JSON attachment `{ exported_at, exported_by, export_as_of, export_limit, cursor, user, accounts, transactions, budgets, audit_logs, next_cursor }` | `backend/src/controllers/adminController.js:1036-1115` |
| `POST` | `/api/admin/users/:id/revoke-sessions` | Admin | Revokes all user refresh sessions and invalidates access tokens by security stamp. | None | `{ success: true, revoked: number }` | `backend/src/controllers/adminController.js:1552-1562` |
| `POST` | `/api/admin/users/:id/impersonate` | Admin + confirmation | Issues 15-minute support impersonation access token. | Required `{ reason: string, confirmation_token?: string }` | 202 confirmation or `{ accessToken: string, user: User, expires_in: '15m', warning: string }` | `backend/src/routes/adminRoutes.js:289-292`; `backend/src/controllers/adminController.js:1967-1982` |

### Admin Defaults, Config, Database, Announcements, Tokens, Webhooks, Security Blocks

| Method | Path | Auth | One-line behavior | Request body/query | Success response | Evidence |
|---|---|---:|---|---|---|---|
| `GET` | `/api/admin/default-categories` | Admin | Lists system/default categories. | Query pagination. | `{ data: Category[], pagination }` | `backend/src/controllers/adminController.js:1385-1390` |
| `POST` | `/api/admin/default-categories` | Admin | Creates global default category. | Required `{ name, type }`; optional `{ icon?, color?, is_default?: boolean, is_system?: boolean, sort_order?: int }` | `201 Category` | `backend/src/routes/adminRoutes.js:156-164`; `backend/src/controllers/adminController.js:1396-1420` |
| `PUT` | `/api/admin/default-categories/:id` | Admin | Updates global default category. | Optional `{ name?, type?, icon?, color?, is_default?, is_system?, is_active?, sort_order? }`; at least one required. | `Category` | `backend/src/routes/adminRoutes.js:165-175`; `backend/src/controllers/adminController.js:1427-1445` |
| `DELETE` | `/api/admin/default-categories/:id` | Admin | Deletes global category and nulls transaction/budget references. | None | `{ success: true, id, deleted: true, transaction_category_refs_cleared: number, budget_category_refs_cleared: number }` | `backend/src/controllers/adminController.js:1452-1477` |
| `POST` | `/api/admin/default-categories/push` | Admin | Copies active default categories to active users where not already visible. | None | `{ success: true, users: number, categories: number, inserted: number, skipped: number }` | `backend/src/controllers/adminController.js:1483-1516` |
| `GET` | `/api/admin/system-config` | Admin | Returns runtime config and public JWT config metadata. | None | `{ node_env, db_path, jwt_issuer, jwt_audience, access_token_ttl, writable_settings }` | `backend/src/controllers/adminController.js:423-431,1595-1597` |
| `PUT` | `/api/admin/system-config` | Admin | Updates writable runtime settings. | Optional `{ max_accounts_per_user?, default_currency?, date_format?, lockout_attempts?, lockout_minutes?, password_requires_special?, password_min_length?, password_reset_url?, webhook_timeout_ms?, audit_retention_months? }` | Same as GET plus `writable_settings` updated. | `backend/src/routes/adminRoutes.js:103-121`; `backend/src/controllers/adminController.js:1603-1615` |
| `POST` | `/api/admin/database/integrity-check` | Admin | Runs SQLite `PRAGMA integrity_check`. | None | `{ ok: boolean, results: object[] }` | `backend/src/controllers/adminController.js:1621-1625` |
| `POST` | `/api/admin/database/vacuum` | Admin + `db:maintenance` + confirmation | Runs SQLite `VACUUM`. | Optional confirmation token. | 202 confirmation or `{ success: true, before_mb: number, after_mb: number }` | `backend/src/routes/adminRoutes.js:191`; `backend/src/controllers/adminController.js:1631-1637` |
| `GET` | `/api/admin/database/backup` | Admin + `db:backup` for API tokens | Streams gzipped SQLite backup. | None | `application/gzip` attachment. | `backend/src/routes/adminRoutes.js:192`; `backend/src/controllers/adminController.js:1643-1648` |
| `GET` | `/api/admin/announcements` | Admin | Lists all announcements. | Query pagination. | `{ data: Announcement[], pagination }` where rows include `is_active` and `created_by`. | `backend/src/controllers/adminController.js:1723-1728` |
| `POST` | `/api/admin/announcements` | Admin + `write:announcements` for API tokens | Creates announcement and sends push notifications. | Required `{ title, body }`; optional `{ is_active?: boolean, starts_at?: ISO|null, ends_at?: ISO|null }` | `201 Announcement` | `backend/src/routes/adminRoutes.js:198-204`; `backend/src/controllers/adminController.js:1734-1757` |
| `PUT` | `/api/admin/announcements/:id` | Admin | Updates announcement. | Optional `{ title?, body?, is_active?, starts_at?, ends_at? }`; at least one required. | `Announcement` | `backend/src/routes/adminRoutes.js:205-212`; `backend/src/controllers/adminController.js:1763-1777` |
| `DELETE` | `/api/admin/announcements/:id` | Admin | Deletes announcement and dismissals. | None | `{ success: true, id: string, deleted: true, dismissals_deleted: number }` | `backend/src/controllers/adminController.js:1783-1793` |
| `GET` | `/api/admin/api-tokens` | Admin | Lists API tokens without token hash/raw token. | Query pagination. | `{ data: { id,name,scopes:string[],is_active,last_used_at,created_at,revoked_at,created_by }[], pagination }` | `backend/src/controllers/adminController.js:1799-1804` |
| `GET` | `/api/admin/token-scopes` | Admin | Lists allowed admin API token scopes. | None | `{ scopes: string[] }` | `backend/src/controllers/adminController.js:1845-1846` |
| `POST` | `/api/admin/api-tokens` | Admin | Creates API token; raw token returned once. | Required `{ name: string }`; optional `{ scopes?: string[] }`, default `['read:users']`. | `201 { id: string, name: string, scopes: string[], token: string }`; invalid scopes: `400 { error, allowed_scopes }` | `backend/src/controllers/adminController.js:62-67,1810-1839` |
| `DELETE` | `/api/admin/api-tokens/:id` | Admin | Revokes API token. | None | `{ success: true }` | `backend/src/controllers/adminController.js:1849-1855` |
| `GET` | `/api/admin/webhooks` | Admin | Lists webhooks with delivery count and masked secret. | Query pagination. | `{ data: (Webhook & { delivery_count: number, secret: '[configured]'|null })[], pagination }` | `backend/src/controllers/adminController.js:1861-1869` |
| `POST` | `/api/admin/webhooks` | Admin | Creates webhook. | Required `{ name, url, event }`; optional `{ is_active?: boolean, secret?: string }`; if secret omitted, random secret is generated. | `201 Webhook` with `secret: '[configured]'` | `backend/src/routes/adminRoutes.js:223-229`; `backend/src/controllers/adminController.js:1875-1893` |
| `PUT` | `/api/admin/webhooks/:id` | Admin | Updates webhook. | Optional `{ name?, url?, event?, is_active?, secret? }`; at least one required. Empty secret clears it. | `Webhook` with `secret: '[configured]'|null` | `backend/src/routes/adminRoutes.js:230-237`; `backend/src/controllers/adminController.js:1899-1919` |
| `GET` | `/api/admin/webhooks/:id/deliveries` | Admin | Lists webhook delivery attempts. | Query pagination. | `{ data: { id, webhook_id, event, status, status_code, error, created_at }[], pagination }` | `backend/src/controllers/adminController.js:1925-1930` |
| `GET` | `/api/admin/security-blocks` | Admin | Lists in-memory/persisted security IP blocks. | Query pagination. | `{ data: SecurityBlock[], pagination }` | `backend/src/controllers/adminController.js:1936-1940` |
| `POST` | `/api/admin/security-blocks` | Admin | Blocks IPv4/IPv6/CIDR for a duration. | Required `{ ip: string }`; optional `{ duration_minutes?: int }`, runtime default 10. | `201 SecurityBlock` | `backend/src/routes/adminRoutes.js:240-246`; `backend/src/controllers/adminController.js:1946-1951` |
| `DELETE` | `/api/admin/security-blocks/:ip` | Admin | Clears security block. | None | `{ success: true, cleared: boolean }` | `backend/src/routes/adminRoutes.js:247`; `backend/src/controllers/adminController.js:1957-1961` |

## Fields With Different Request Vs Response Meaning

| Field | Request meaning | Stored meaning | Response meaning | Evidence |
|---|---|---|---|---|
| `amount` | Decimal major currency units, e.g. `12.34`. | Integer cents. | Decimal major currency units. | `backend/src/routes/transactionRoutes.js:28-38`; `backend/src/controllers/transactionController.js:180-181`; `backend/src/utils/money.js:24-48,62-70` |
| `balance` | Account create/update validator accepts decimal dollars. Create defaults missing value to `0`. | Integer cents. | Decimal dollars. | `backend/src/routes/accountRoutes.js:31,40`; `backend/src/controllers/accountController.js:92-105`; `backend/src/utils/money.js:1-22` |
| `overdraft_limit` | Decimal dollars, optional. Missing stores `null`, present empty/falsey stores `0`. | Integer cents or `null`. | Decimal dollars or `null`. | `backend/src/controllers/accountController.js:93-95,172` |
| `target_balance` | Admin correction request decimal dollars, can be negative. | Converted to cents for delta calculation; not stored directly. | Returned only inside audit/derived correction response after serialization if present. | `backend/src/routes/adminRoutes.js:283-285`; `backend/src/controllers/adminController.js:1336-1340,1377-1379` |
| `tags` | Request array of strings. | JSON string. | JSON string, not parsed back to array. | `backend/src/routes/transactionRoutes.js:80-81,93-94`; `backend/src/controllers/transactionController.js:62-64,189,309` |
| Boolean request fields | Express-validator accepts booleans, but many controllers convert truthiness to `0|1`. | Integer `0|1`. | Integer `0|1` in DB row responses; notification preferences return booleans. | `backend/src/controllers/authController.js:791-793`; `backend/src/controllers/adminController.js:1433-1436,1768-1769,1904-1905` |

## DB Fields Present But Never Returned Or Masked

- `users.password_hash` is removed by `sanitizeUser`.
- Token hashes are never returned: `refresh_tokens.token_hash`, `password_reset_tokens.token_hash`, `email_verification_tokens.token_hash`, `admin_api_tokens.token_hash`.
- Webhook `secret` is encrypted in DB and returned only as `"[configured]"` or `null`.
- `deleted_users.details_json` is parsed into `details`, then removed from `user`.
- `announcement_dismissals.dismissed_at` is not exposed by user announcement routes.
- `access_token_blocklist` rows are never returned by API routes.
- `notification_preferences.updated_at` is not returned by `/api/auth/notification-settings`.
- `notifications.data_json` is returned as `data_json`, not parsed to `data`.

Evidence:

```js
// backend/database/db.js:95,239,251,261,304,332,341,357
password_hash TEXT NOT NULL,
token_hash TEXT NOT NULL,
details_json TEXT,
dismissed_at TEXT DEFAULT (datetime('now')),
token_hash TEXT NOT NULL UNIQUE,
secret TEXT,

// backend/src/controllers/adminController.js:1803-1804,1869,1893,1919
SELECT id, name, scopes, is_active, last_used_at, created_at, revoked_at, created_by FROM admin_api_tokens
secret: row.secret ? '[configured]' : null
return res.status(201).json({ ...row, secret: '[configured]' });
return res.json({ ...row, secret: row.secret ? '[configured]' : null });

// backend/src/controllers/adminController.js:701-706
details = row.details_json ? JSON.parse(row.details_json) : {};
delete row.details_json;
return res.json(serializeMoney({ user: row, details }));
```

## Computed Or Derived Fields

| Field | Where returned | How derived | Evidence |
|---|---|---|---|
| `current_balance` | Account list/detail | SQL expression over transactions, not just `accounts.balance`. | `backend/src/controllers/accountController.js:24,143-152`; `backend/src/utils/accountBalance.js:12-23` |
| `recent_transactions` | Account detail | Last 5 non-deleted transactions for account. | `backend/src/controllers/accountController.js:156-158` |
| `current_spending`, `remaining`, `percent_used`, `weekly_breakdown` | Budget routes | Expense sums over date window and category. | `backend/src/controllers/budgetController.js:113-126,136-154` |
| `status` | Admin budget performance | `'over'` when current spending exceeds budget amount. | `backend/src/controllers/adminController.js:1019-1028` |
| `category_name`, `category_icon`, `category_color`, `account_name`, `user_email`, `user_full_name` | Joined list/detail responses | SQL joins. | `backend/src/controllers/transactionController.js:269-274`; `backend/src/controllers/adminController.js:1175-1184` |
| `action_label`, `summary` | Admin audit logs | Derived from audit action and JSON values. | `backend/src/controllers/adminController.js:96-168,881` |
| `device_hint` | User sessions | First 120 chars of `user_agent` or fallback. | `backend/src/controllers/authController.js:858-861` |
| `delivery_count` | Webhook list | Count of webhook deliveries. | `backend/src/controllers/adminController.js:1865-1869` |
| `next_cursor` | Admin user export | Present when any exported table has more rows. | `backend/src/controllers/adminController.js:1103-1114` |

## Role, Query, And Flag-Dependent Behavior

- Admin API token scopes only restrict `fa_...` API tokens, not admin JWTs.
- `requireConfirmation` changes first-call success shape to `202 { requires_confirmation, confirmation_token, expires_in_seconds, action }` for destructive admin routes outside tests.
- `POST /api/auth/register`, `/forgot-password`, and `/resend-verification` intentionally return success-like responses for duplicate/missing users.
- `POST /api/transactions` returns different shapes for transfer vs non-transfer.
- `DELETE /api/accounts/:id` returns a special `400` chooser response if the account has transactions and no `transaction_action` query.
- `DELETE /api/admin/users/:id/accounts/:accountId` defaults `transaction_action` to `cash`.
- `GET /api/admin/transactions` uses `admin_deleted` first, then `include_deleted`; default excludes admin-deleted rows.
- Date filters accept both `start_date/end_date` and `date_from/date_to` on many routes.
- `GET /api/auth/notifications` accepts `limit` without route validation, clamped at runtime.
- `GET /api/admin/users` supports undocumented `locked=true`.

Evidence:

```js
// backend/src/middleware/auth.js:129-134
if (req.auth?.token_type !== 'admin_api_token') return next();
if (scopes.includes(scope) || scopes.includes('admin:*')) return next();

// backend/src/controllers/transactionController.js:242
return res.status(201).json(serializeMoney(base.type === 'transfer' ? { transactions: hydrated } : hydrated[0]));

// backend/src/controllers/accountController.js:208-215
const transactionAction = req.query.transaction_action;
if (transactionCount > 0 && !transactionAction) {
  return res.status(400).json({
    error: 'Choose whether to delete this account transactions or move them to Cash',
    transaction_count: transactionCount,
    actions: ['delete', 'cash'],
  });
}

// backend/src/controllers/adminController.js:1159-1161
if (req.query.admin_deleted === 'true') where.push('t.admin_deleted_at IS NOT NULL');
else if (req.query.admin_deleted === 'false') where.push('t.admin_deleted_at IS NULL');
else if (req.query.include_deleted !== 'true') where.push('t.admin_deleted_at IS NULL');
```

## Inconsistent Success Response Shapes

1. `POST /api/transactions`
   - Non-transfer returns a single `Transaction`.
   - Transfer returns `{ transactions: Transaction[] }`.
   - Evidence: `backend/src/controllers/transactionController.js:242`.

2. `PUT /api/budgets/:id`
   - Create/list/detail may include derived fields; update returns raw budget only.
   - Evidence: `backend/src/controllers/budgetController.js:105,126,148-154,188`.

3. `PUT /api/categories/reorder`
   - Returns an array directly, not `{ data }`, and omits several category DB fields selected elsewhere.
   - Evidence: `backend/src/controllers/categoryController.js:110-118`.

4. Admin confirmation routes
   - First accepted call can be `202` confirmation challenge; second call returns the real success object.
   - Evidence: `backend/src/routes/adminRoutes.js:17-35`.

5. User vs admin announcements
   - User list omits `is_active` and `created_by`; admin list returns `SELECT *`.
   - Evidence: `backend/src/controllers/announcementController.js:19-20`; `backend/src/controllers/adminController.js:1726-1728`.

6. Audit logs
   - `/api/admin/audit-logs` enriches `action_label` and `summary`; `/api/admin/users/:id/login-history` returns raw audit rows.
   - Evidence: `backend/src/controllers/adminController.js:881,997`.

7. Export routes
   - `/api/auth/data` and `/api/admin/users/:id/export` send JSON attachments via `send`/stream, not `res.json`.
   - Evidence: `backend/src/controllers/authController.js:971-973`; `backend/src/controllers/adminController.js:1051-1115`.

## Non-Standard Error Responses

There is no single error envelope. Errors appear as:

- `{ error: string }`
- `{ errors: { field: string, message: string }[] }`
- `{ error: string, code: string }`
- `{ error: string, allowed_scopes: string[] }`
- `{ error: string, transaction_count: number, actions: string[] }`
- Rate limiter `{ error: string }`
- Confirmation challenge `202 { requires_confirmation, confirmation_token, expires_in_seconds, action }`, which is not an error but interrupts the normal success flow.

Evidence:

```js
// backend/src/routes/authRoutes.js:120-125
return res.status(400).json({
  errors: errors.array().map((error) => ({
    field: error.path,
    message: error.msg,
  })),
});

// backend/src/app.js:245,271-273
res.status(404).json({ error: 'Route not found' });
res.status(statusCode).json({
  error: statusCode === 500 ? 'Internal server error' : err.message,
});

// backend/src/controllers/authController.js:328-331
return res.status(403).json({
  error: 'Please verify your email before signing in.',
  code: 'EMAIL_NOT_VERIFIED',
});

// backend/src/controllers/adminController.js:1819-1822
return res.status(400).json({
  error: `Invalid API token scope${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}`,
  allowed_scopes: AVAILABLE_TOKEN_SCOPES,
});
```

## Main Gotchas

1. Money is request dollars, DB cents, response dollars.
   - This affects `amount`, `balance`, `overdraft_limit`, `target_balance`, totals, and derived financial fields.
   - Evidence: `backend/src/utils/money.js:1-22,24-48,62-70`.

2. `tags` request is an array, response is a JSON string.
   - Evidence: `backend/src/routes/transactionRoutes.js:80-81`; `backend/src/controllers/transactionController.js:189,309`.

3. `PUT /api/accounts/:id` validates `balance` but will not update it because `balance` is missing from the controller's `allowed` list.
   - Evidence: `backend/src/routes/accountRoutes.js:40`; `backend/src/controllers/accountController.js:167-175`.

4. Missing `account_id` on transaction create silently creates/uses the default Cash account.
   - Evidence: `backend/src/controllers/transactionController.js:172-174`.

5. Account create with non-zero opening balance silently creates an "Opening balance" transaction.
   - Evidence: `backend/src/controllers/accountController.js:118-130`.

6. Admin user account delete silently defaults `transaction_action` to `cash`; user account delete requires the query flag when transactions exist.
   - Evidence: `backend/src/controllers/adminController.js:1284`; `backend/src/controllers/accountController.js:208-215`.

7. `GET /api/auth/notifications` returns `data_json`, not parsed `data`, despite mobile types expecting `data`.
   - Evidence: `backend/src/controllers/authController.js:819-826`; `mobile/src/types/api.types.ts:119-127`.

8. `security_stamp` is returned in sanitized user objects, while `password_hash` is removed.
   - Evidence: `backend/src/utils/security.js:90-97`.

9. `GET /api/admin/users/:id/transactions` accepts `user_id` query validation via shared filters but ignores it; path id wins.
   - Evidence: `backend/src/routes/adminRoutes.js:306`; `backend/src/controllers/adminController.js:887-895`.

10. `GET /api/admin/users` supports `locked=true` but route validators do not document/validate it.
    - Evidence: `backend/src/controllers/adminController.js:544-547`.

11. Date-only filters are expanded to UTC day start/end; full timestamps are converted via `new Date(...).toISOString()`.
    - Evidence: `backend/src/controllers/transactionController.js:20-28`; `backend/src/controllers/adminController.js:294-303`.

12. Several successful delete routes return `{ success: true }`, while others return counts, ids, or nested transaction results.
    - Evidence: `backend/src/controllers/categoryController.js:128`; `backend/src/controllers/transactionController.js:399,506`; `backend/src/controllers/accountController.js:231`; `backend/src/controllers/adminController.js:1793`.
