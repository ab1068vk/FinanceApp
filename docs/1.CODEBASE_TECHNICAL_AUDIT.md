# FinanceApp Technical Architecture, Security, API, Database, Money, Auth, and Fragility Reference

Generated from local source on 2026-05-10. Paths are relative to `C:\Users\bemat\OneDrive\Desktop\FinanceApp` unless otherwise noted.

## 1. APP STRUCTURE

### Architecture Pattern

FinanceApp is a layered monorepo:

- **Mobile frontend**: Expo React Native + TypeScript + React Navigation + Redux Toolkit.
- **Backend API**: Express monolith with route validators, controllers, middleware, utilities, and SQLite persistence.
- **Database**: local SQLite via `better-sqlite3`; migrations/seeding happen at module load.
- **Shared**: `shared/` exists but is not currently used as a strong shared-contract package.

Source evidence:

```js
// backend/src/app.js:191-199
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/admin', adminRoutes);
```

```ts
// mobile/src/navigation/index.tsx:386-403
export function RootNavigator() {
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const user = useAppSelector((state) => state.auth.user);
  ...
      {isAuthenticated && user?.must_change_password ? (
        <RootStackNavigator.Screen name="ForceChangePassword" component={ChangePasswordScreen} options={{ gestureEnabled: false }} />
      ) : isAuthenticated ? (
        <RootStackNavigator.Screen name="App" component={AppStack} />
      ) : (
        <RootStackNavigator.Screen name="Auth" component={AuthStack} />
      )}
```

### Folder and Module Breakdown

| Path | Responsibility |
|---|---|
| `backend/src/app.js` | Express application setup: security middleware, parsers, route mounting, Swagger in non-production, health, 404, final error handler. |
| `backend/src/server.js` | Environment validation, server start, token cleanup, deleted-user purge, recurring transaction processor, backups, shutdown handlers. |
| `backend/database/db.js` | SQLite setup, schema creation, migrations, default categories, admin seed, default cash accounts, money column migration. |
| `backend/src/routes/*Routes.js` | Route registration, auth attachment, validation rules and rate limits. |
| `backend/src/controllers/*Controller.js` | Request handlers and DB mutations. |
| `backend/src/middleware/auth.js` | Bearer JWT and admin API token authentication, admin role checks, scope checks. |
| `backend/src/middleware/csrfProtection.js` | Browser-style double-submit CSRF token handling. |
| `backend/src/utils/money.js` | Cents conversion, balance delta, recursive API serialization of money and booleans. |
| `backend/src/utils/accountBalance.js` | Derived balance expression and stored-vs-derived consistency warning. |
| `mobile/src/services/api.ts` | Axios instance, token injection, 401 refresh, retry queue, basic TLS pinning hook. |
| `mobile/src/services/secureStorage.ts` | SecureStore token/user persistence. |
| `mobile/src/store/slices/*.ts` | Redux async thunks and state models for auth, accounts, transactions, budgets, admin. |
| `mobile/src/screens` | User/admin screens. |

### Entry Points and Bootstrapping

Backend:

```js
// backend/src/server.js:92-104
function cleanupRefreshTokens() {
  const now = new Date().toISOString();
  const refresh = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1').run(now);
  const blocklist = db.prepare('DELETE FROM access_token_blocklist WHERE expires_at <= ?').run(now);
  logger.info('Token cleanup completed', {
    refreshTokensDeleted: refresh.changes,
    accessTokenBlocklistDeleted: blocklist.changes,
  });
}
```

```js
// backend/src/server.js:131-145
try {
  processRecurringTransactions();
} catch (error) {
  logger.error('Recurring transaction processor failed', { error: error.message });
}

const recurringTransactionTimer = setInterval(() => {
  try {
    processRecurringTransactions();
  } catch (error) {
    logger.error('Recurring transaction processor failed', { error: error.message });
  }
}, RECURRING_TRANSACTION_INTERVAL_MS);
```

Database bootstraps on require:

```js
// backend/database/db.js:1102-1115
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
```

### Key Dependencies

Backend dependencies from `backend/package.json:18-37`:

- `express`, `cors`, `helmet`, `compression`, `morgan`: HTTP API and hardening.
- `better-sqlite3`: synchronous SQLite ORM/driver layer.
- `bcryptjs`: password hashing.
- `jsonwebtoken`: JWT access tokens.
- `express-validator`: request validation.
- `express-rate-limit`: brute force and abuse protection.
- `express-mongo-sanitize`, `hpp`: payload/query hardening.
- `winston`, `winston-daily-rotate-file`: logging.
- `nodemailer`: email delivery.
- `swagger-jsdoc`, `swagger-ui-express`: non-production API docs.

Mobile dependencies from `mobile/package.json:12-49`:

- Expo/React Native stack, React Navigation, Redux Toolkit, Axios.
- `expo-secure-store`: token persistence.
- `expo-notifications`: push notifications.
- `react-native-chart-kit`, `react-native-svg`: charts.
- `react-hook-form`, `yup`: UI form validation.

### Routing Structure

All backend routes are mounted in `backend/src/app.js:193-199`.

Public or semi-public:

| Method | Path | Controller | Auth |
|---|---|---|---|
| GET | `/health` | inline | public |
| POST | `/api/client-error` | inline | public, rate-limited |
| POST | `/api/auth/register` | `authController.register` | public |
| POST | `/api/auth/login` | `authController.login` | public |
| POST | `/api/auth/forgot-password` | `authController.forgotPassword` | public |
| POST | `/api/auth/reset-password` | `authController.resetPassword` | public |
| POST | `/api/auth/verify-email` | `authController.verifyEmail` | public |
| POST | `/api/auth/resend-verification` | `authController.resendVerification` | public |
| GET | `/api/auth/csrf` | `authController.getCsrfToken` | public |
| POST | `/api/auth/refresh` | `authController.refreshToken` | refresh token body |

Authenticated user:

| Method | Path | Controller | Request Shape |
|---|---|---|---|
| POST | `/api/auth/logout` | `logout` | `{ refreshToken: string }` |
| PUT | `/api/auth/change-password` | `changePassword` | `{ currentPassword: string, newPassword: string }` |
| GET | `/api/auth/me` | `getMe` | none |
| GET | `/api/auth/sessions` | `getSessions` | none |
| DELETE | `/api/auth/sessions/others` | `revokeOtherSessions` | `{ refreshToken: string }` |
| DELETE | `/api/auth/sessions/:sessionId` | `revokeSession` | path UUID |
| POST | `/api/auth/push-token` | `registerPushToken` | `{ token: string, platform: string }` |
| DELETE | `/api/auth/push-token` | `deregisterPushToken` | `{ token: string }` |
| GET | `/api/auth/notification-settings` | `getNotificationSettings` | none |
| PUT | `/api/auth/notification-settings` | `updateNotificationSettings` | `{ preferences: object }` |
| GET | `/api/auth/notifications` | `getNotifications` | query `limit?` |
| PATCH | `/api/auth/notifications/:id/read` | `markNotificationRead` | path UUID |
| GET | `/api/auth/data` | `exportMyData` | none |
| DELETE | `/api/auth/data` | `deleteMyData` | none |
| DELETE | `/api/auth/account` | `deleteMyAccount` | `{ confirmation: "DELETE" }` |
| PATCH | `/api/auth/me` | `updateMe` | `{ full_name?, avatar_color?, currency?, has_completed_onboarding? }` |

Financial user routes:

```js
// backend/src/routes/accountRoutes.js:64-69
router.use(requireAuth);
router.get('/', controller.getAccounts);
router.post('/', createRules, validate, controller.createAccount);
router.get('/:id', idParam, validate, controller.getAccount);
router.put('/:id', updateRules, validate, controller.updateAccount);
router.delete('/:id', deleteRules, validate, controller.deleteAccount);
```

```js
// backend/src/routes/transactionRoutes.js:106-115
router.use(requireAuth);
router.get('/', filters, validate, controller.getTransactions);
router.post('/', createRules, validate, controller.createTransaction);
router.get('/summary', filters, validate, controller.getTransactionSummary);
router.delete('/bulk', bulkIdRules, validate, controller.bulkDeleteTransactions);
router.patch('/bulk/category', bulkCategoryRules, validate, controller.bulkUpdateTransactionCategory);
router.get('/:id', idParam, validate, controller.getTransaction);
router.put('/:id', updateRules, validate, controller.updateTransaction);
router.delete('/:id', idParam, validate, controller.deleteTransaction);
```

```js
// backend/src/routes/budgetRoutes.js:41-46
router.use(requireAuth);
router.get('/', controller.getBudgets);
router.post('/', createRules, validate, controller.createBudget);
router.get('/:id', idParam, validate, controller.getBudget);
router.put('/:id', updateRules, validate, controller.updateBudget);
router.delete('/:id', idParam, validate, controller.deleteBudget);
```

Admin routes require both `requireAuth` and `requireAdmin`:

```js
// backend/src/routes/adminRoutes.js:163-170
router.use(requireAuth, requireAdmin, adminLimiter);
router.get('/dashboard', adminController.getDashboardStats);
router.get('/transactions', transactionFilters, validate, adminController.getAllTransactions);
router.get('/transactions/:id', idParam, validate, adminController.getAdminTransaction);
router.delete('/transactions/:id', destructiveAdminLimiter, requireAdminScope('write:transactions'), [
  idParam,
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.adminSoftDeleteTransaction);
```

## 2. SECURITY ANALYSIS

### Authentication and Authorization

#### Access Token Creation

Access tokens are JWTs, HS256, 15-minute expiry, with `jti`. Payload includes `sub`, `email`, `role`, `must_change_password`, `security_stamp`; admin impersonation also adds impersonation fields.

```js
// backend/src/utils/security.js:26-42
function generateAccessToken(payload) {
  assertJwtSecret();
  ...
  const options = {
    algorithm: JWT_ALGORITHM,
    expiresIn: '15m',
    jwtid: crypto.randomUUID(),
  };
  if (process.env.JWT_ISSUER) options.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) options.audience = process.env.JWT_AUDIENCE;

  return jwt.sign(payload, process.env.JWT_SECRET, options);
}
```

```js
// backend/src/controllers/authController.js:108-116
function issueAccessToken(user) {
  return generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    must_change_password: Boolean(user.must_change_password),
    security_stamp: user.security_stamp,
  });
}
```

#### Refresh Token Storage

Refresh tokens are random 64-byte hex strings. Only SHA-256 hash is stored in `refresh_tokens.token_hash`.

```js
// backend/src/utils/security.js:44-50
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
```

```js
// backend/src/controllers/authController.js:367-385
const refreshToken = generateRefreshToken();
const refreshTokenHash = hashToken(refreshToken);
const refreshFamilyId = crypto.randomUUID();
const expiresAt = addDays(new Date(), REFRESH_TOKEN_DAYS).toISOString();
...
db.prepare(`
INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`).run(crypto.randomUUID(), user.id, refreshFamilyId, refreshTokenHash, expiresAt, loginAt, loginAt, req.get('user-agent') || null);
```

Mobile stores tokens in Expo SecureStore:

```ts
// mobile/src/services/secureStorage.ts:15-19
export async function saveTokens(accessToken: string, refreshToken: string) {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}
```

#### Token Validation on Each Request

```js
// backend/src/middleware/auth.js:59-110
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');
    ...
    const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);
    const userId = decoded.sub;
    ...
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId);
    ...
    if (isAccessTokenBlocked(decoded.jti)) {
      recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'blocked_access_token', subject: userId });
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (!decoded.security_stamp || decoded.security_stamp !== user.security_stamp) {
      recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'security_stamp_mismatch', subject: userId });
      return res.status(401).json({ error: 'Invalid token' });
    }
    ...
    req.auth = decoded;
    req.accessToken = token;
    req.user = sanitizeUser(user);
    return next();
  } catch (error) {
```

Expired and invalid token behavior:

```js
// backend/src/middleware/auth.js:111-120
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'token_expired' });
      return res.status(401).json({ error: 'Token expired' });
    }

    if (error.name === 'JsonWebTokenError') {
      recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'invalid_jwt', message: error.message });
      return res.status(401).json({ error: 'Invalid token' });
    }
```

Mobile refreshes on 401:

```ts
// mobile/src/services/api.ts:101-143
if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
  return Promise.reject(error);
}
...
const response = await axios.post<{ accessToken: string; refreshToken?: string }>(
  `${API_BASE_URL}/api/auth/refresh`,
  { refreshToken },
  { timeout: 10000 }
);
...
await saveTokens(newAccessToken, nextRefreshToken);
...
} catch (refreshError) {
  processQueue(refreshError, null);
  await clearTokens();
  store.dispatch(authActions.logout());
  return Promise.reject(refreshError);
}
```

#### Admin vs Regular User

```js
// backend/src/middleware/auth.js:126-144
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  return next();
}

function requireAdminScope(scope) {
  return (req, res, next) => {
    if (req.auth?.token_type !== 'admin_api_token') return next();
    const scopes = Array.isArray(req.auth.scopes) ? req.auth.scopes : [];
    if (scopes.includes(scope) || scopes.includes('admin:*')) return next();
    return res.status(403).json({ error: `API token scope required: ${scope}` });
  };
}
```

Admin API tokens are separate Bearer tokens prefixed `fa_`:

```js
// backend/src/middleware/auth.js:16-56
function authenticateApiToken(token, req, res, next) {
  const row = db.prepare(`
    SELECT t.id AS token_id, t.scopes, u.*
    FROM admin_api_tokens t
    JOIN users u ON u.id = t.created_by
    WHERE t.token_hash = ?
      AND t.is_active = 1
      AND t.revoked_at IS NULL
      AND u.is_active = 1
  `).get(hashToken(token));
  ...
  req.auth = {
    api_token_id: tokenId,
    scopes: parsedScopes,
    sub: user.id,
    token_type: 'admin_api_token',
  };
```

### Data Security

Passwords use bcrypt with 12 rounds:

```js
// backend/src/utils/security.js:18-24
async function hashPassword(plain) {
  return bcrypt.hash(plain, saltRounds);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
```

Webhook secrets are AES-256-GCM encrypted:

```js
// backend/src/utils/security.js:64-77
function encryptSecret(value) {
  if (value === null || value === undefined || value === '') return null;
  if (isEncryptedSecret(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}
```

CORS is allowlist-based:

```js
// backend/src/app.js:145-158
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
  exposedHeaders: ['X-Request-ID', 'X-CSRF-Token'],
}));
```

CSRF is enforced for state-changing browser-style requests unless a Bearer token is present:

```js
// backend/src/middleware/csrfProtection.js:76-94
function csrfProtection(req, res, next) {
  const token = setCsrfCookie(req, res);
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();
  if (AUTH_EXEMPT_PATHS.has(req.path)) return next();
  if (hasBearerToken(req)) return next();
  ...
  if (!provided || provided !== cookieToken || provided !== token || !isValidToken(provided)) {
    recordSecurityEvent(req, [], 'SECURITY_CSRF_FAILURE', {
      reason: 'invalid_csrf_token',
      has_cookie_token: Boolean(cookieToken),
      has_provided_token: Boolean(provided),
      path: req.originalUrl,
    });
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
```

### Security Red Flags and Gaps

1. **Admin API token access is tied to creator account role only indirectly.** `authenticateApiToken` joins `users u ON u.id = t.created_by` and checks `u.is_active = 1`, but does not check `u.role = 'admin'` before `requireAdmin` later checks `req.user.role`. If the creator is demoted after token creation, `requireAdmin` should block because `req.user` is the creator user, but the token row itself stays active.
2. **Admin global dashboard calculations include admin-deleted rows in some subqueries.** `transactionTotals` filters deleted transactions, but `topCategories` and `dailyVolume` do not filter `admin_deleted_at`.

```js
// backend/src/controllers/adminController.js:463-477
const transactionTotals = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS sum FROM transactions WHERE admin_deleted_at IS NULL').get();
...
const topCategories = db.prepare(`
  SELECT c.id AS category_id, COALESCE(c.name, 'Uncategorized') AS category_name, COALESCE(SUM(t.amount), 0) AS total
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.type = 'expense'
  GROUP BY c.id, c.name
```

3. **User export includes admin-deleted transactions.** Normal user list/detail APIs filter `admin_deleted_at`, but export does not.

```js
// backend/src/controllers/authController.js:963-970
const payload = {
  exported_at: nowIso(),
  user: sanitizeUser(getUserById(userId)),
  accounts: db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(userId),
  transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(userId),
  budgets: db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY start_date DESC, created_at DESC').all(userId),
  categories: db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC').all(userId),
```

4. **Client-side offline queue creates optimistic financial state without server-side balance recalculation until sync succeeds.**

```ts
// mobile/src/store/slices/transactionsSlice.ts:180-190
if (isNetworkError(error)) {
  await enqueue({ method: 'POST', url: '/api/transactions', data, description: 'Create transaction' });
  showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
  return {
    ...data,
    id: tempId(),
    category_id: data.category_id || '',
    date: data.date,
    recurring: Boolean(data.recurring),
    created_at: new Date().toISOString(),
  };
}
```

### Security Score

**🟢 Good.** The backend uses bcrypt, short-lived JWTs, hashed/rotated refresh tokens, access-token blocklisting, security stamps, prepared SQL, validation, rate limits, Helmet, CORS controls, CSRF for browser-style requests, audit redaction, and admin separation. It is not “Excellent” because some admin/global financial queries inconsistently include soft-deleted data, exports can expose admin-deleted user records to the user, and error/response contracts are not fully standardized.

## 3. USER DATA HANDLING

### User Data Collected and Stored

`users` table:

```sql
-- backend/database/db.js:93-110
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

Stored user-adjacent data:

- Accounts, balances, overdraft limits, currencies.
- Transactions, notes, tags, receipt paths, transfer metadata.
- Budgets and categories.
- Notifications and push tokens.
- Refresh tokens, password reset tokens, email verification tokens.
- Audit logs with redacted values.
- Deleted user archive summaries.

### Data Flow

Registration creates user + default Cash account:

```js
// backend/src/controllers/authController.js:235-263
const createUser = db.transaction(() => {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, email_verified_at, security_stamp)
    VALUES (?, ?, ?, ?, 'user', 1, ?, ?, ?)
  `).run(userId, email, passwordHash, fullName, createdAt, requiresEmailVerification ? null : createdAt, securityStamp);

  const defaultAccount = createDefaultCashAccount(userId);
  const createdUser = getUserById(userId);
  ...
});
```

User data export:

```js
// backend/src/controllers/authController.js:960-989
function exportMyData(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = {
      exported_at: nowIso(),
      user: sanitizeUser(getUserById(userId)),
      accounts: db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(userId),
      budgets: db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY start_date DESC, created_at DESC').all(userId),
      categories: db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC').all(userId),
      audit_logs: db.prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    };
```

User data deletion keeps login active but deletes finance data and recreates Cash:

```js
// backend/src/controllers/authController.js:1004-1018
db.transaction(() => {
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM budgets WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM accounts WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM categories WHERE user_id = ?').run(req.user.id);
  const defaultAccount = createDefaultCashAccount(req.user.id);
  writeAuditLog(req, {
    userId: req.user.id,
    action: 'USER_DATA_DELETED',
```

Account deletion anonymizes and disables the user:

```js
// backend/src/controllers/authController.js:1043-1055
db.transaction(() => {
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM budgets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM accounts WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM categories WHERE user_id = ?').run(userId);
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  db.prepare(`
    UPDATE users
    SET email = ?, full_name = ?, password_hash = ?, avatar_color = '#6C757D',
        is_active = 0, must_change_password = 0, email_verified_at = NULL,
        security_stamp = ?, updated_at = ?
    WHERE id = ?
  `).run(deletedEmail, `Deleted User ${userId.slice(0, 8)}`, passwordHash, newSecurityStamp(), deletedAt, userId);
```

Admin hard delete archives summary, deletes audit traces, deletes user row:

```js
// backend/src/controllers/adminController.js:813-857
db.prepare(`
  INSERT INTO deleted_users (
    id, original_user_id, email, full_name, role, was_active, created_at, last_login, deleted_at, deleted_by,
    account_count, transaction_count, budget_count, total_account_balance, transaction_total, details_json
  )
...
db.prepare(`
  DELETE FROM audit_logs
  WHERE user_id = ?
    OR entity_id = ?
    OR old_value LIKE ?
    OR new_value LIKE ?
    OR old_value LIKE ?
    OR new_value LIKE ?
`).run(...);
db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
```

### Privacy/GDPR/CCPA Patterns

Present:

- `/api/auth/data` export.
- `/api/auth/data` deletion.
- `/api/auth/account` anonymization + deactivation.
- Deleted-user archive purge.

Purge:

```js
// backend/database/db.js:804-809
function purgeDeletedUserArchives(days = deletedUserArchiveDays()) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM deleted_users WHERE deleted_at < ?').run(cutoff);
}
```

## 4. COMPLETE MONEY AND FINANCE DATA FLOW

### Money Storage

Money is stored as integer cents. The DB columns are:

| Table | Column | Type | Meaning |
|---|---|---|---|
| `accounts` | `balance` | `INTEGER DEFAULT 0` | stored running balance, cents |
| `accounts` | `overdraft_limit` | `INTEGER` | cents, nullable |
| `transactions` | `amount` | `INTEGER NOT NULL CHECK (amount >= 0)` | absolute amount in cents; sign comes from `type`/`transfer_direction` |
| `recurring_transactions` | `amount` | `INTEGER NOT NULL CHECK (amount > 0)` | recurring amount in cents |
| `budgets` | `amount` | `INTEGER NOT NULL CHECK (amount >= 0)` | budget cap in cents |
| `deleted_users` | `total_account_balance` | `INTEGER DEFAULT 0` | archived cents |
| `deleted_users` | `transaction_total` | `INTEGER DEFAULT 0` | archived cents |

Schema source:

```sql
-- backend/database/db.js:129-142
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('checking', 'savings', 'credit', 'investment', 'cash')),
  balance INTEGER DEFAULT 0,
  overdraft_limit INTEGER,
  currency TEXT DEFAULT 'USD',
  ...
);
```

```sql
-- backend/database/db.js:145-171
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT,
  category_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  ...
  transfer_direction TEXT CHECK (transfer_direction IS NULL OR transfer_direction IN ('source', 'destination')),
  ...
);
```

```sql
-- backend/database/db.js:222-233
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category_id TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  period TEXT CHECK (period IN ('monthly', 'weekly', 'yearly')),
  ...
);
```

Legacy decimal-money migrations multiply by 100:

```sql
-- backend/database/db.js:931-933
INSERT INTO accounts_money_next
SELECT id, user_id, name, type, ROUND(COALESCE(balance, 0) * 100),
       CASE WHEN overdraft_limit IS NULL THEN NULL ELSE ROUND(overdraft_limit * 100) END,
```

```sql
-- backend/database/db.js:971-972
INSERT INTO transactions_money_next
SELECT id, user_id, account_id, category_id, type, ROUND(COALESCE(amount, 0) * 100),
```

### Conversion Functions

Storage to display and display to storage:

```js
// backend/src/utils/money.js:41-78
function amountToCents(value, { allowZero = true, allowNegative = false } = {}) {
  const raw = typeof value === 'string' ? value.trim() : value;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
  }
  if (!/^-?\d+(\.\d+)?$/.test(String(raw))) {
    throw Object.assign(new Error('amount must be a finite number'), { statusCode: 400 });
  }
  const sign = amount < 0 ? -1 : 1;
  const [intPart, decPart = ''] = String(raw).replace('-', '').split('.');
  const centsDigits = decPart.padEnd(3, '0').slice(0, 3);
  const roundedCents = parseInt(centsDigits.slice(0, 2), 10) + (Number(centsDigits[2]) >= 5 ? 1 : 0);
  const MAX_CENTS = 999_999_999_999_99;
  const absCents = BigInt(intPart || '0') * 100n + BigInt(roundedCents);
  ...
  return sign * abs;
}

function centsToAmount(value) {
  if (value === null || value === undefined) return value;
  const cents = Number(value);
  if (!Number.isFinite(cents)) return value;
  return parseFloat((Math.round(cents) / 100).toFixed(2));
}
```

Recursive response serializer:

```js
// backend/src/utils/money.js:94-113
function serializeMoney(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => serializeMoney(item, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => {
    if (MONEY_RESPONSE_KEYS.has(childKey) && typeof childValue === 'number') {
      return [childKey, centsToAmount(childValue)];
    }
    ...
    return [childKey, serializeMoney(childValue, childKey)];
  }));
}
```

Mobile display formatter expects API dollars:

```ts
// mobile/src/utils/formatters.ts:3-5
export function formatCurrency(amount = 0, currencyCode = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(Number(amount) || 0);
}
```

### Balance Formulas

Stored balance mutation:

```js
// backend/src/controllers/transactionController.js:104-108
function updateBalance(accountId, userId, delta) {
  if (!db.inTransaction) {
    logger.warn('Account balance updated outside transaction', { accountId, userId, delta });
  }
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
}
```

Delta formula:

```js
// backend/src/utils/money.js:80-91
function computeBalanceDelta(transaction) {
  const amount = Number(transaction.amount || 0);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid transaction amount: ${transaction.amount}`);
  }
  if (transaction.type === 'income') return amount;
  if (transaction.type === 'expense') return -amount;
  if (transaction.type === 'transfer') {
    const dir = transaction.transfer_direction ?? null;
    return dir === 'destination' ? amount : -amount;
  }
  return 0;
}
```

Derived/current balance formula:

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

Stored-vs-derived mismatch detector:

```js
// backend/src/utils/accountBalance.js:32-49
function warnIfAccountBalanceMismatch(account, context = {}) {
  if (!account) return;
  const balance = Number(account.balance);
  const currentBalance = Number(account.current_balance);
  if (!Number.isFinite(balance) || !Number.isFinite(currentBalance)) return;
  const difference = balance - currentBalance;
  if (Math.abs(difference) > 0) {
    logger.warn('Account balance mismatch', {
      accountId: account.id,
      userId: account.user_id,
      balance,
      current_balance: currentBalance,
      difference,
      ...context,
    });
  }
}
```

Net worth in mobile dashboard is all active account `current_balance` or fallback `balance`:

```ts
// mobile/src/screens/dashboard/DashboardScreen.tsx:81-82
() => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0),
[accounts]
```

Income/expense/net summary:

```js
// backend/src/controllers/transactionController.js:424-448
const totals = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS total_expense
  FROM transactions t WHERE ${whereSql}
`).get(...params);
...
return res.json(serializeMoney({
  total_income: totals.total_income,
  total_expense: totals.total_expense,
  net: totals.total_income - totals.total_expense,
  grouped_by_category: grouped,
}));
```

Budget spending/remaining/percent used:

```js
// backend/src/controllers/budgetController.js:99-106
function budgetPercentUsed(amountValue, currentValue) {
  const amount = Number(amountValue || 0);
  const currentSpending = Number(currentValue || 0);
  if (!Number.isFinite(currentSpending) || !Number.isFinite(amount) || amount === 0) {
    return 0;
  }
  if (amount === 0) return currentSpending > 0 ? 100 : 0;
  return Math.round((currentSpending / amount) * 10000) / 100;
}
```

```js
// backend/src/controllers/budgetController.js:132-149
const budgets = db.prepare(`SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  COALESCE(SUM(t.amount), 0) AS current_spending
  FROM budgets b
  ...
  LEFT JOIN transactions t ON t.user_id = b.user_id
    AND t.category_id = b.category_id
    AND t.type = 'expense'
    AND t.admin_deleted_at IS NULL
...
const data = budgets.map((budget) => ({
  ...budget,
  remaining: Number(budget.amount) - Number(budget.current_spending),
  percent_used: budgetPercentUsed(budget.amount, budget.current_spending),
}));
```

Savings rate: no backend canonical savings-rate formula found. Mobile reports/screens infer savings-like values from income, expense, and net summaries, but no persisted or named `savings_rate` calculation exists.

### Transaction Create/Edit/Delete Flow

#### User Creates Income/Expense

1. Route validates body.
2. Controller resolves account, category, amount, date.
3. DB transaction inserts transaction, updates account balance, audits.
4. Response returns `{ transactions: Transaction[] }` with dollars.

Validation:

```js
// backend/src/routes/transactionRoutes.js:65-84
const createRules = [
  body('account_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('account_id must be a valid UUID'),
  body('to_account_id').if(body('type').equals('transfer')).isUUID().withMessage('to_account_id is required for transfers and must be a valid UUID'),
  ...
  body('type').isIn(types).withMessage(`type must be one of: ${types.join(', ')}`),
  positiveMoney(body('amount'), 'amount'),
  body('date').custom(isIsoDate).withMessage('date must be a valid ISO date'),
```

Write:

```js
// backend/src/controllers/transactionController.js:232-238
} else {
  assertBalanceAllowed(account, computeBalanceDelta(base));
  insertTransaction(base);
  updateBalance(account.id, req.user.id, computeBalanceDelta(base));
  checkAccountConsistency(account.id, req.user.id, 'createTransaction');
  audit(req, 'TRANSACTION_CREATED', 'transaction', base.id, null, base);
  created.push(base);
}
```

#### User Creates Transfer

Transfer creates two rows with same group id and opposite directions:

```js
// backend/src/controllers/transactionController.js:206-231
if (base.type === 'transfer') {
  const toAccount = getOwnedAccount(req.body.to_account_id, req.user.id);
  if (!toAccount) throw Object.assign(new Error('to_account_id must belong to the authenticated user'), { statusCode: 400 });
  if (toAccount.id === account.id) throw Object.assign(new Error('to_account_id must be different from account_id'), { statusCode: 400 });
  assertBalanceAllowed(account, -amount);
  const groupId = crypto.randomUUID();
  const sourceTx = {
    ...base,
    transfer_group_id: groupId,
    transfer_direction: 'source',
    to_account_id: toAccount.id,
  };
  const destTx = {
    ...base,
    id: crypto.randomUUID(),
    account_id: toAccount.id,
    transfer_group_id: groupId,
    transfer_direction: 'destination',
    from_account_id: account.id,
  };
  insertTransaction(sourceTx); insertTransaction(destTx);
  updateBalance(account.id, req.user.id, -amount); updateBalance(toAccount.id, req.user.id, amount);
```

#### User Edits Transaction

Type is immutable. Amount changes rebalance. Transfer amount updates both rows or fails if group incomplete.

```js
// backend/src/controllers/transactionController.js:300-317
function updateTransaction(req, res, next) {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'type')) {
      logger.warn('Attempted immutable transaction update', { userId: req.user.id, transactionId: req.params.id });
      audit(req, 'TRANSACTION_IMMUTABLE_UPDATE_ATTEMPTED', 'transaction', req.params.id, null, { type: req.body.type });
      return res.status(400).json({ error: 'type cannot be changed after creation' });
    }
    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
    if (!oldTx) return res.status(404).json({ error: 'Transaction not found' });
    ...
    if (amountChanged) {
      assertTransactionAmount(Number(req.body.amount));
      nextAmount = amountToCents(req.body.amount, { allowZero: false });
    }
```

```js
// backend/src/controllers/transactionController.js:330-370
db.transaction(() => {
  if (amountChanged) {
    if (oldTx.type === 'transfer') {
      const groupId = getTransferGroupId(oldTx);
      if (!groupId) throw Object.assign(new Error('Transfer group is missing; cannot safely update amount.'), { statusCode: 409 });
      const related = getRelatedTransferTransactions(req.user.id, groupId);
      if (related.length !== 2) {
        ...
        throw Object.assign(new Error('Transfer group is incomplete; both sides must be present before updating amount.'), { statusCode: 409 });
      }
      ...
      db.prepare('UPDATE transactions SET amount = ?, updated_at = ? WHERE user_id = ? AND transfer_group_id = ? AND admin_deleted_at IS NULL')
        .run(nextAmount, updates.updated_at, req.user.id, groupId);
    } else {
      const account = getOwnedAccount(oldTx.account_id, req.user.id);
      ...
      const delta = computeBalanceDelta({ ...oldTx, amount: nextAmount }) - computeBalanceDelta(oldTx);
      assertBalanceAllowed(account, delta);
      updateBalance(oldTx.account_id, req.user.id, delta);
      updates.amount = nextAmount;
```

#### User Deletes Transaction

Hard deletes user transaction rows and reverses balance impact.

```js
// backend/src/controllers/transactionController.js:382-410
function deleteTransaction(req, res, next) {
  try {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    ...
    db.transaction(() => {
      for (const item of related) {
        if (item.account_id) updateBalance(item.account_id, req.user.id, -computeBalanceDelta(item));
        db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(item.id, req.user.id);
      }
      affectedAccountIds.forEach((accountId) => checkAccountConsistency(accountId, req.user.id, 'deleteTransaction'));
      audit(req, 'TRANSACTION_DELETED', 'transaction', req.params.id, related, null);
    })();
    return res.json({ success: true, deleted: related.length });
```

#### Admin Deletes Transaction

Admin soft-deletes by setting `admin_deleted_at`, reverses balances, and keeps rows.

```js
// backend/src/controllers/adminController.js:1240-1262
function adminSoftDeleteTransaction(req, res, next) {
  try {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND admin_deleted_at IS NULL').get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    ...
    db.transaction(() => {
      for (const item of related) {
        updateStoredBalance(item.account_id, item.user_id, -computeBalanceDelta(item));
        db.prepare(`
          UPDATE transactions
          SET admin_deleted_at = ?, admin_deleted_by = ?, admin_delete_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(deletedAt, req.user.id, reason, deletedAt, item.id);
      }
      audit(req, 'ADMIN_SOFT_DELETED_TRANSACTION', 'transaction', req.params.id, related, { reason, deleted_at: deletedAt, related_count: related.length });
    })();
    return res.json({ success: true, deleted: related.length, reason });
```

### Account Create/Delete/Move Flow

Create account stores opening balance and also creates opening-balance transaction if nonzero:

```js
// backend/src/controllers/accountController.js:121-140
db.transaction(() => {
  db.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
    VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)`).run(account);

  if (initialBalance !== 0) {
    db.prepare(`INSERT INTO transactions (id, user_id, account_id, category_id, type, amount, description, note, date, recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, NULL, NULL, ?, NULL)`).run(
      crypto.randomUUID(),
      req.user.id,
      account.id,
      initialBalance >= 0 ? 'income' : 'expense',
      Math.abs(initialBalance),
      'Opening balance',
```

Delete account either requires a transaction action, moves transactions to Cash, or hard deletes transactions, then soft-deactivates the account:

```js
// backend/src/controllers/accountController.js:204-232
function deleteAccount(req, res, next) {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const transactionAction = req.query.transaction_action;
    const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id).count;
    if (transactionCount > 0 && !transactionAction) {
      return res.status(400).json({
        error: 'Choose whether to delete this account transactions or move them to Cash',
...
    db.transaction(() => {
      if (transactionAction === 'delete') {
        transactionResult = { action: 'delete', deleted: deleteAccountTransactions(req.params.id, req.user.id), moved: 0, cash_account_id: null };
      } else if (transactionAction === 'cash') {
        const result = moveAccountTransactionsToCash(req.params.id, req.user.id);
...
      db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
```

Move-to-Cash rewrites transaction account references and moves stored balance delta:

```js
// backend/src/controllers/accountController.js:77-92
const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
const movedDelta = direct.reduce((sum, transaction) => sum + computeBalanceDelta(transaction), 0);
const updatedAt = nowIso();

db.prepare('UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
  .run(cashAccount.id, updatedAt, accountId, userId);
db.prepare('UPDATE transactions SET from_account_id = ?, updated_at = ? WHERE from_account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
  .run(cashAccount.id, updatedAt, accountId, userId);
db.prepare('UPDATE transactions SET to_account_id = ?, updated_at = ? WHERE to_account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
  .run(cashAccount.id, updatedAt, accountId, userId);

updateStoredBalance(accountId, userId, -movedDelta);
updateStoredBalance(cashAccount.id, userId, movedDelta);
```

Admin account deletion hard-deletes the account row after optionally moving/deleting transactions and notifies the user:

```js
// backend/src/controllers/adminController.js:1319-1356
const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.accountId, req.params.id).count;
...
db.transaction(() => {
  if (transactionCount > 0 && transactionAction === 'delete') {
    transactionResult = { action: 'delete', deleted: deleteAccountTransactions(req.params.accountId, req.params.id), moved: 0, cash_account_id: null };
  } else if (transactionCount > 0) {
    const result = moveAccountTransactionsToCash(req.params.accountId, req.params.id);
...
  createUserNotification(
    req.params.id,
    'admin-account-deleted',
...
  db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.accountId, req.params.id);
})();
```

### Budget Create/Evaluate/Delete Flow

Create validates category, normalizes dates, blocks overlap, inserts budget:

```js
// backend/src/controllers/budgetController.js:109-124
function createBudget(req, res, next) {
  try {
    if (!allowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    const dates = normalizeBudgetDates(req.body.period, req.body.start_date, req.body.end_date);
    const budget = {
      id: crypto.randomUUID(), user_id: req.user.id, category_id: req.body.category_id, amount: amountToCents(req.body.amount, { allowZero: false }),
      period: req.body.period, start_date: dates.start_date, end_date: dates.end_date,
      created_at: nowIso(), updated_at: null,
    };
    db.transaction(() => {
      assertNoBudgetOverlap(req.user.id, req.body.category_id, dates.start_date, dates.end_date);
      db.prepare(`INSERT INTO budgets (id, user_id, category_id, amount, period, start_date, end_date, created_at, updated_at)
        VALUES (@id, @user_id, @category_id, @amount, @period, @start_date, @end_date, @created_at, @updated_at)`).run(budget);
```

Delete hard-deletes budget:

```js
// backend/src/controllers/budgetController.js:219-227
function deleteBudget(req, res, next) {
  try {
    const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    db.transaction(() => {
      db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
      audit(req, 'BUDGET_DELETED', 'budget', req.params.id, budget, null);
    })();
    return res.json({ success: true });
```

### Recurring Money Flow

Recurring rules insert transactions and mutate balance in one transaction:

```js
// backend/src/utils/recurringProcessor.js:123-143
db.transaction(() => {
  db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, category_id, type, amount, description, note, date,
      recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction,
      to_account_id, from_account_id, created_at, updated_at
    )
...
  `).run(transaction);
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(balanceDelta(rule), processedAt, rule.account_id, rule.user_id);
  db.prepare(`
    UPDATE recurring_transactions
    SET last_processed_date = ?, next_due_date = ?
    WHERE id = ?
  `).run(today, nextDueDate, rule.id);
})();
```

### Money Conflict and Inconsistency Gotchas

1. **Opening balance double-representation can confuse stored vs derived balance.** Account creation stores `accounts.balance = initialBalance` and creates an opening transaction of the same amount. Derived balance equals opening transaction amount, so they match at creation, but direct stored balance updates must stay synchronized forever.
2. **Admin soft delete affects stored balance and derived balance via `admin_deleted_at IS NULL`.** This is intentional, but user export still includes deleted rows.
3. **Dashboard admin top categories and daily volume include admin-deleted transactions.** See `adminController.js:469-504`.
4. **Move-to-Cash only computes `movedDelta` from direct `account_id` rows.** It rewrites `from_account_id`/`to_account_id` as well, but the balance move delta ignores related transfer rows where the account appears only in metadata. In the current transfer design both rows have `account_id`, so this works unless legacy/incomplete transfer rows exist.
5. **Transfer groups are protected for edit/delete but not repaired.** Incomplete transfer groups block user edits/deletes with 409.
6. **Admin balance correction sets stored account balance to target and inserts a correction transaction based on derived balance.** This repairs drift, but if existing stored balance was already different from derived, the correction transaction may not equal `target - stored`.

## 5. COMPLETE AUTHORIZATION REFERENCE

### Permission Levels

| Level | Meaning |
|---|---|
| Public | No Bearer token. Subject to route-specific validators/rate limits. |
| Refresh-token public | Uses body refresh token; no access token. |
| User | `requireAuth`; must be active user, valid JWT/admin API token, matching security stamp. |
| Admin | `requireAuth`, `requireAdmin`; user role must be `admin`. |
| Admin scoped token | For `fa_` admin API tokens, selected destructive routes require scopes such as `write:transactions`, `db:maintenance`, `db:backup`, `write:announcements`. |

Admin scope examples:

```js
// backend/src/routes/adminRoutes.js:201-208
router.post('/audit-retention/purge', destructiveAdminLimiter, requireAdminScope('db:maintenance'), requireConfirmation('audit_log_purge'), [
  body('before').custom(isIsoDate).withMessage('before must be a valid ISO date'),
], validate, adminController.purgeAuditLogs);
...
router.get('/database/backup', requireAdminScope('db:backup'), adminController.downloadDatabaseBackup);
```

### Cross-User Access

Intentional admin cross-user reads/writes:

```js
// backend/src/controllers/adminController.js:914-970
function getUserTransactions(req, res, next) {
  ...
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  ...
  const transactions = db.prepare(`
    SELECT t.*, c.name AS category_name, a.name AS account_name
    FROM transactions t
...
  `).all(...params, limit, offset);
```

```js
// backend/src/controllers/adminController.js:2044-2059
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
```

Regular user data access is consistently scoped by `req.user.id` in financial controllers:

```js
// backend/src/controllers/transactionController.js:59-64
function getOwnedAccount(id, userId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(id, userId);
}
function getAllowedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND is_active = 1').get(id, userId);
}
```

### Admin Actions Affecting User-Facing Data

Admin soft-deleted transactions disappear from user transaction lists and derived balances:

```js
// backend/src/controllers/transactionController.js:262-285
const where = ['t.user_id = ?', 't.admin_deleted_at IS NULL'];
...
const transactions = db.prepare(`SELECT t.*, c.name AS category_name, a.name AS account_name
  FROM transactions t
...
  WHERE ${whereSql}
```

Admin account deletion notifies the user:

```js
// backend/src/controllers/adminController.js:1340-1352
createUserNotification(
  req.params.id,
  'admin-account-deleted',
  'Account deleted by admin',
  `Your account "${account.name}" was deleted by an administrator. Reason: ${reason}`,
  {
    account_id: req.params.accountId,
    account_name: account.name,
    reason,
    deleted_at: deletedAt,
    transaction_result: transactionResult,
  }
);
```

Admin transaction soft delete does not create a user notification in the shown code path; it only audits.

### Auth Gotchas

1. Access token blocklist is DB-backed plus process-local cache. Comment warns multi-instance deployments need shared storage:

```js
// backend/src/utils/accessTokenBlocklist.js:6-9
// WARNING: This Map is an in-memory process-local cache of blocked JTIs.
// The database remains the source of truth, but deployments using separate
// databases per instance still need a shared store for reliable invalidation.
const blockedJtis = new Map();
```

2. CSRF intentionally exempts Bearer-token requests. This is correct for native mobile but not sufficient if future browser clients store Bearer tokens in web storage and call mutating APIs.
3. Admin impersonation returns a normal access token with user `sub`; downstream `requireAuth` does not enforce special restrictions on impersonated tokens beyond audit claims in the token.
4. Refresh token rotation does not revoke the whole token family on reuse; it returns 409 if the same token is already rotated.

## 6. COMPLETE DATABASE SCHEMA AND RELATIONSHIPS

### Tables

| Table | Key Columns and Constraints |
|---|---|
| `schema_version` | `id INTEGER PRIMARY KEY CHECK (id = 1)`, `version`, `updated_at`. |
| `users` | `email UNIQUE NOT NULL`, `password_hash`, `full_name`, `role CHECK user/admin`, `is_active`, lockout fields, verification fields, `security_stamp`. |
| `categories` | optional `user_id`, `type CHECK income/expense`, `is_default`, `is_system`, `is_active`, `UNIQUE(user_id, name, type)`. |
| `accounts` | `user_id NOT NULL`, `type CHECK checking/savings/credit/investment/cash`, `balance INTEGER`, `overdraft_limit INTEGER`, `is_active`. |
| `transactions` | `user_id`, `account_id`, `category_id`, `type CHECK income/expense/transfer`, `amount INTEGER >= 0`, recurring fields, transfer metadata, admin delete metadata. |
| `recurring_transactions` | active recurring rules with `amount INTEGER > 0`, `frequency CHECK daily/weekly/monthly/yearly`. |
| `notifications` | user notifications with `data_json`, `read_at`. |
| `push_tokens` | `UNIQUE(user_id, token)`. |
| `notification_preferences` | `PRIMARY KEY (user_id, type)`. |
| `budgets` | `category_id`, `amount INTEGER >= 0`, `period CHECK monthly/weekly/yearly`, date range. |
| `refresh_tokens` | `token_hash`, `expires_at`, `revoked`, `family_id`, session metadata. |
| `password_reset_tokens` | `token_hash UNIQUE`, `used_at`, `expires_at`. |
| `email_verification_tokens` | `token_hash UNIQUE`, `used_at`, `expires_at`. |
| `audit_logs` | actor/action/entity/old/new/ip/user-agent. |
| `access_token_blocklist` | `jti PRIMARY KEY`, `expires_at`. |
| `deleted_users` | archived user summary and money totals. |
| `app_settings` | key/value config. |
| `announcements` | title/body/active/date window/creator. |
| `announcement_dismissals` | `PRIMARY KEY (announcement_id, user_id)`. |
| `admin_api_tokens` | `token_hash UNIQUE`, `scopes`, active/revoked metadata. |
| `webhooks` | URL/event/secret/active metadata. |
| `webhook_deliveries` | webhook delivery status. |
| `security_ip_blocks` | IP/CIDR block state. |

Source begins:

```sql
-- backend/database/db.js:87-126
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
...
);

CREATE TABLE IF NOT EXISTS categories (
...
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name, type)
);
```

### Foreign Keys

Primary relationships:

| Child | Column | Parent | Delete Behavior |
|---|---|---|---|
| `categories` | `user_id` | `users.id` | CASCADE |
| `accounts` | `user_id` | `users.id` | CASCADE |
| `transactions` | `user_id` | `users.id` | CASCADE |
| `transactions` | `account_id` | `accounts.id` | SET NULL |
| `transactions` | `category_id` | `categories.id` | SET NULL |
| `transactions` | `admin_deleted_by` | `users.id` | SET NULL |
| `recurring_transactions` | `user_id` | `users.id` | CASCADE |
| `recurring_transactions` | `account_id` | `accounts.id` | CASCADE |
| `recurring_transactions` | `category_id` | `categories.id` | SET NULL |
| `notifications`, `push_tokens`, `notification_preferences` | `user_id` | `users.id` | CASCADE |
| `budgets` | `user_id` | `users.id` | CASCADE |
| `budgets` | `category_id` | `categories.id` | SET NULL |
| `refresh_tokens`, `password_reset_tokens`, `email_verification_tokens` | `user_id` | `users.id` | CASCADE |
| `audit_logs` | `user_id` | `users.id` | SET NULL |
| `deleted_users` | `deleted_by` | `users.id` | SET NULL |
| `announcements` | `created_by` | `users.id` | SET NULL |
| `announcement_dismissals` | announcement/user | announcements/users | CASCADE |
| `admin_api_tokens`, `webhooks` | `created_by` | `users.id` | SET NULL |
| `webhook_deliveries` | `webhook_id` | `webhooks.id` | CASCADE |

### Code-Enforced Relationships

Account ownership is manually checked before transaction writes:

```js
// backend/src/controllers/transactionController.js:182-188
const account = req.body.account_id
  ? getOwnedAccount(req.body.account_id, req.user.id)
  : getOrCreateDefaultCashAccount(req.user.id);
if (!account) return res.status(400).json({ error: 'account_id must belong to the authenticated user' });
const categoryId = req.body.category_id || null;
if (categoryId && !getAllowedCategory(categoryId, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
if (req.body.type !== 'transfer' && !categoryId) return res.status(400).json({ error: 'category_id is required' });
```

Budget category ownership/default access is manual:

```js
// backend/src/controllers/budgetController.js:18-20
function allowedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND is_active = 1').get(id, userId);
}
```

Manual cascade on category duplicate migration:

```js
// backend/database/db.js:665-674
const updateCategoryTransactions = db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?');
const updateCategoryBudgets = db.prepare('UPDATE budgets SET category_id = ? WHERE category_id = ?');
const deleteDuplicateCategory = db.prepare('DELETE FROM categories WHERE id = ?');
...
updateCategoryTransactions.run(keepId, duplicateId);
updateCategoryBudgets.run(keepId, duplicateId);
deleteDuplicateCategory.run(duplicateId);
```

### Soft Deletes

| Table | Soft-delete Field | Notes |
|---|---|---|
| `accounts` | `is_active` | User delete sets inactive; admin account delete hard-deletes row. |
| `categories` | `is_active` | Default categories can be deactivated; user category delete hard-deletes own categories. |
| `transactions` | `admin_deleted_at` | Admin soft-delete hides from normal lists/budgets and reverses balance. |
| `users` | `is_active` | Login and auth middleware require active. |
| `admin_api_tokens` | `is_active`, `revoked_at` | Revocation updates token row. |
| `webhooks` | `is_active` | Webhook delivery uses active filter. |
| `announcements` | `is_active` | Active windows also apply. |
| `recurring_transactions` | `is_active` | Processor filters active. |

Queries correctly filtering `transactions.admin_deleted_at IS NULL`:

- User transaction list/detail/update/delete: `backend/src/controllers/transactionController.js:262`, `294`, `307`, `384`.
- Budget spending: `backend/src/controllers/budgetController.js:139`, `162`, `168`.
- Derived account balance: `backend/src/utils/accountBalance.js:23`.

Queries missing this filter:

```js
// backend/src/controllers/authController.js:967
transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(userId),
```

```js
// backend/src/controllers/adminController.js:468
const newTransactionsThisMonth = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE created_at >= ?').get(monthStart).count;
```

```js
// backend/src/controllers/adminController.js:499-504
const rows = db.prepare(`
  SELECT substr(date, 1, 10) AS date, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
  FROM transactions
  WHERE date >= ?
  GROUP BY substr(date, 1, 10)
`).all(start.toISOString());
```

## 7. COMPLETE API CONTRACT

### Common Error Shapes

Validation errors from routes:

```js
// backend/src/routes/transactionRoutes.js:10-13
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, message: e.msg })) });
};
```

Final error handler:

```js
// backend/src/app.js:266-268
res.status(statusCode).json({
  error: statusCode === 500 ? 'Internal server error' : err.message,
});
```

Gotcha: errors are inconsistent: validation uses `{ errors: [{ field, message }] }`; controllers use `{ error: string }`; confirmation uses `{ requires_confirmation, confirmation_token, ... }`; some success partial warnings use custom shapes.

### Financial API Contract

| Method | Path | Auth | Request Body / Query | Success Response |
|---|---|---|---|---|
| GET | `/api/accounts` | user | query `page?, limit?, page_size?` | `{ data: Account[], pagination }`; `balance/current_balance/overdraft_limit` dollars |
| POST | `/api/accounts` | user | `{ name: string, type, currency, color, icon, balance?, overdraft_limit? }` | `Account`; money dollars |
| GET | `/api/accounts/:id` | user owner | path UUID | `Account & { recent_transactions: Transaction[] }` |
| PUT | `/api/accounts/:id` | user owner | `{ name?, currency?, color?, icon?, overdraft_limit? }`; balance not updatable | `Account` |
| DELETE | `/api/accounts/:id` | user owner | query `transaction_action? = delete|cash` | `{ success: true, transactions: { action, deleted, moved, cash_account_id } }` |
| GET | `/api/transactions` | user | filters: account/category/type/date/min/max/search/page/limit | `{ data: Transaction[], pagination }` |
| POST | `/api/transactions` | user | `{ account_id?, to_account_id? for transfer, category_id? except transfer, type, amount, date, description?, note?, tags?, receipt_path?, recurring?, recurring_interval? }` | `{ transactions: Transaction[] }`; transfers return two rows |
| GET | `/api/transactions/summary` | user | date filters | `{ total_income, total_expense, net, grouped_by_category }` |
| GET | `/api/transactions/:id` | user owner | path UUID | `Transaction` |
| PUT | `/api/transactions/:id` | user owner | `{ amount?, description?, note?, category_id?, date?, tags?, receipt_path? }`; `type` forbidden | `Transaction` |
| DELETE | `/api/transactions/:id` | user owner | none | `{ success: true, deleted: number }` |
| DELETE | `/api/transactions/bulk` | user owner | `{ transaction_ids: uuid[] }` | `{ success: true, deleted: number }` |
| PATCH | `/api/transactions/bulk/category` | user owner | `{ transaction_ids: uuid[], category_id: uuid }` | `{ success: true, updated: number }` |
| GET | `/api/budgets` | user | pagination | `{ data: Budget[], pagination }` |
| POST | `/api/budgets` | user | `{ amount, category_id, period, start_date, end_date? }` | `Budget` |
| GET | `/api/budgets/:id` | user owner | path UUID | `Budget & { current_spending, remaining, percent_used, weekly_breakdown }` |
| PUT | `/api/budgets/:id` | user owner | `{ amount?, category_id?, period?, start_date?, end_date? }` | `Budget` |
| DELETE | `/api/budgets/:id` | user owner | path UUID | `{ success: true }` |
| GET | `/api/categories` | user | pagination | `{ data: Category[], pagination }` |
| POST | `/api/categories` | user | `{ name, icon?, color?, type }` | `Category` |
| PUT | `/api/categories/reorder` | user | `{ category_ids: uuid[] }` | `Category[]` |
| PUT | `/api/categories/:id` | user owner | `{ name?, icon?, color?, type? }` | `Category` |
| DELETE | `/api/categories/:id` | user owner | path UUID | `{ success: true }` |
| GET | `/api/announcements` | user | pagination | `{ data: Announcement[], pagination }` |
| POST | `/api/announcements/:id/dismiss` | user | path UUID | `{ success: true, id }` |

Field unit gotcha: request `amount`, `balance`, `overdraft_limit`, `target_balance`, filters `min_amount/max_amount` are **dollars**; DB stores cents; response money fields are serialized back to **dollars** by `serializeMoney`.

### Auth API Contract

| Method | Path | Request | Response |
|---|---|---|---|
| POST `/api/auth/register` | `{ email, password, full_name }` | `{ success, message, verificationToken? }` or `{ success, message }` |
| POST `/api/auth/login` | `{ email, password }` | `{ accessToken, refreshToken, user }` |
| POST `/api/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| POST `/api/auth/logout` | `{ refreshToken }` + Bearer | `{ success: true }` |
| POST `/api/auth/forgot-password` | `{ email }` | `{ success, message, resetToken? }` |
| POST `/api/auth/reset-password` | `{ resetToken, newPassword }` | `{ success, message }` |
| POST `/api/auth/verify-email` | `{ verificationToken }` | `{ success, message }` |
| POST `/api/auth/resend-verification` | `{ email }` | `{ success, message, verificationToken? }` |
| GET `/api/auth/csrf` | none | `{ csrfToken }` |
| PUT `/api/auth/change-password` | `{ currentPassword, newPassword }` | `{ success, accessToken, refreshToken }` |
| GET `/api/auth/me` | none | sanitized `User` |
| GET `/api/auth/sessions` | none | `{ active_sessions, sessions }` |
| PATCH `/api/auth/me` | `{ full_name?, avatar_color?, currency?, has_completed_onboarding? }` | sanitized `User` |
| GET `/api/auth/data` | none | JSON download payload |
| DELETE `/api/auth/data` | none | `{ success, deleted }` |
| DELETE `/api/auth/account` | `{ confirmation: "DELETE" }` | `{ success, deleted }` |

### Admin API Contract

All admin routes require `Bearer` access token for admin user or active admin API token. `requireAdminScope` applies only to admin API tokens.

| Method | Path | Auth/Scope | Request | Response |
|---|---|---|---|---|
| GET `/api/admin/dashboard` | admin | query none | dashboard stats |
| GET `/api/admin/transactions` | admin | filters include user/account/category/type/date/min/max/include_deleted/admin_deleted/search/page/limit | `{ data, pagination }` |
| GET `/api/admin/transactions/:id` | admin | path UUID | transaction with user/account/category names |
| DELETE `/api/admin/transactions/:id` | admin + `write:transactions` for API token | `{ reason }` | `{ success, deleted, reason }` |
| GET/POST/PUT/DELETE `/api/admin/default-categories[...]` | admin | default category body validators | category list/category/success |
| POST `/api/admin/default-categories/push` | admin | none | `{ inserted, skipped }` |
| POST `/api/admin/users/bulk` | admin | `{ user_ids, action, reason }` | bulk result |
| GET `/api/admin/audit-retention` | admin | none | retention settings |
| POST `/api/admin/audit-retention/purge` | admin + `db:maintenance` + confirmation | `{ before, confirmation_token? }` | confirmation or purge result |
| GET/PUT `/api/admin/system-config` | admin | config fields | config object |
| POST `/api/admin/database/integrity-check` | admin | none | integrity result |
| POST `/api/admin/database/vacuum` | admin + `db:maintenance` + confirmation | confirmation token maybe | vacuum result |
| GET `/api/admin/database/backup` | admin + `db:backup` | none | DB file download |
| GET `/api/admin/reports` | admin | none | `{ monthly_financials, cohorts, categories }` |
| GET `/api/admin/reports/export` | admin | query `type?=monthly|categories` | CSV |
| GET/POST/PUT/DELETE `/api/admin/announcements[...]` | admin; create requires `write:announcements` for API token | announcement body | list/object/success |
| GET/POST/DELETE `/api/admin/api-tokens[...]` | admin | name/scopes for create | list/create/revoke |
| GET/POST/PUT `/api/admin/webhooks[...]` | admin | webhook body | list/object |
| GET `/api/admin/webhooks/:id/deliveries` | admin | path UUID | deliveries |
| GET/POST/DELETE `/api/admin/security-blocks[...]` | admin | IP/duration | list/block/clear |
| GET `/api/admin/deleted-users` | admin | filters | `{ data, pagination }` |
| GET `/api/admin/deleted-users/:id` | admin | path UUID | deleted user detail |
| GET `/api/admin/users` | admin | filters role/is_active/search/page/limit | `{ data, pagination }` |
| GET `/api/admin/users/:id` | admin | path UUID | `{ user, summary, recent_audit_logs }` |
| GET `/api/admin/users/:id/sessions` | admin | pagination | sessions |
| GET `/api/admin/users/:id/spending-by-category` | admin | date filters | `{ data, total }` |
| GET `/api/admin/users/:id/login-history` | admin | date filters pagination | `{ data, pagination }` |
| GET `/api/admin/users/:id/budget-performance` | admin | path UUID | `{ data }` |
| GET `/api/admin/users/:id/accounts` | admin | path UUID | `{ data }` |
| PUT `/api/admin/users/:id/accounts/:accountId/status` | admin | `{ is_active, reason? }` | account |
| DELETE `/api/admin/users/:id/accounts/:accountId` | admin | `{ reason, transaction_action? }` | delete result |
| POST `/api/admin/users/:id/accounts/:accountId/correction` | admin + confirmation | `{ target_balance, reason, confirmation_token? }` | `{ transaction, account }` |
| GET `/api/admin/users/:id/export` | admin | pagination/cursor optional | stream/export payload |
| POST `/api/admin/users/:id/revoke-sessions` | admin | none | `{ success, revoked }` |
| POST `/api/admin/users/:id/impersonate` | admin + confirmation | `{ reason, confirmation_token? }` | `{ accessToken, user, expires_in, warning }` |
| PUT `/api/admin/users/:id/status` | admin | `{ is_active }` | user |
| PUT `/api/admin/users/:id/role` | admin | `{ role }` | user |
| POST `/api/admin/users/:id/reset-password` | admin | `{ temporary_password? }` | `{ success, temporary_password, must_change_password, delivery? }` |
| DELETE `/api/admin/users/:id` | admin + confirmation | `{ confirmation_token? }` | confirmation or delete result |
| GET `/api/admin/audit-logs` | admin | filters | `{ data, pagination }` |
| GET `/api/admin/users/:id/transactions` | admin | filters | `{ data, pagination }` |
| GET `/api/admin/system-health` | admin | none | health stats |

Response inconsistency gotchas:

- Creates can return raw object (`Account`, `Budget`, `Category`) while list returns `{ data, pagination }`.
- Transaction create always returns `{ transactions: [] }`; single create still wraps in an array.
- Admin confirmation middleware returns `202` with `requires_confirmation` before the actual action.
- `DELETE /api/accounts/:id` may return `400` asking for `transaction_action` with `actions`, not a standard error shape.

## 8. ERROR HANDLING AND EDGE CASES

### Error Handler

```js
// backend/src/app.js:245-268
app.use((err, req, res, _next) => {
  const statusCode = err.statusCode || err.status || 500;
  ...
  logger.error(err.message || 'Unhandled application error', {
    statusCode,
    method: req.method,
    path: req.originalUrl,
    requestId: req.id,
    ip: req.ip,
    stack: err.stack,
  });

  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal server error' : err.message,
  });
});
```

### Try/Catch Pattern

Most controller handlers wrap sync DB work with `try/catch { return next(error); }`. Representative pattern:

```js
// backend/src/controllers/budgetController.js:219-228
function deleteBudget(req, res, next) {
  try {
    const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    db.transaction(() => {
      db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
      audit(req, 'BUDGET_DELETED', 'budget', req.params.id, budget, null);
    })();
    return res.json({ success: true });
  } catch (error) { return next(error); }
}
```

Silent/best-effort catches:

```js
// backend/src/utils/accessTokenBlocklist.js:19-23
try {
  db.prepare('DELETE FROM access_token_blocklist WHERE expires_at <= ?').run(new Date(now).toISOString());
} catch {
  // Reads fail closed in isAccessTokenBlocked; pruning is best-effort.
}
```

```ts
// mobile/src/store/slices/authSlice.ts:124-140
export const logoutUser = createAsyncThunk('auth/logoutUser', async () => {
  const { accessToken, refreshToken } = await getTokens();
  ...
    } catch {
      // Local logout should always complete even if the server is unreachable.
    }
  }

  await clearTokens();
});
```

Async fire-and-forget notifications are intentionally not awaited:

```js
// backend/src/controllers/transactionController.js:163-168
void sendPushNotification(
  userId,
  `Budget exceeded: ${budget.category_name || 'Category'} is over by ${centsToAmount(overBy).toFixed(2)}`,
  `${budget.category_name || 'This budget'} has exceeded its limit.`,
  { type: 'budget_overspend', budgetId: budget.id, overBy: centsToAmount(overBy) }
).catch((pushError) => logger.warn('Budget overspend push failed', { userId, error: pushError.message }));
```

### Non-Atomic / Partial Failure Behaviors

1. Registration creates user/default account inside a DB transaction, then sends verification email outside it. If email delivery fails, the user has already been created but receives `503`.

```js
// backend/src/controllers/authController.js:265-275
createUser();
if (requiresEmailVerification && verification) {
  try {
    await deliverEmailVerificationToken({ email, token: verification.verificationToken, expiresAt: verification.expiresAt });
  } catch (deliveryError) {
    logger.error('Email verification delivery failed', {
      email: maskEmail(email),
      error: deliveryError.message,
    });
    return res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
  }
```

2. Forgot password inserts reset token before delivery. If delivery fails, a valid token remains stored but undistributed.

```js
// backend/src/controllers/authController.js:509-536
const createResetToken = db.transaction(() => {
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(createdAt, user.id);
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), user.id, resetTokenHash, expiresAt, createdAt);
...
createResetToken();
try {
  await deliverPasswordResetToken({ email: user.email, token: resetToken, expiresAt });
} catch (deliveryError) {
```

3. User export serializes all payload in memory before sending; very large accounts can be memory-heavy.

4. Admin report CSV builds entire CSV string in memory:

```js
// backend/src/controllers/adminController.js:1755-1763
const serializedRows = serializeMoney(rows);
const headers = type === 'monthly'
  ? ['month', 'income', 'expense', 'net', 'count']
  : Object.keys(serializedRows[0] || { empty: '' });
const csv = [headers.join(','), ...serializedRows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? '')).join(','))].join('\n');
...
return res.send(csv);
```

### Input Validation and Sanitization

Strong route validation is present for core APIs. Examples:

```js
// backend/src/routes/accountRoutes.js:38-45
const createRules = [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('type').isIn(validTypes).withMessage(`type must be one of: ${validTypes.join(', ')}`),
  body('currency').trim().isLength({ min: 3, max: 3 }).isAlpha().withMessage('currency must be a 3-letter code'),
  body('color').matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('icon').isString().withMessage('icon must be a string').bail().isLength({ min: 1, max: 50 }).withMessage('icon must be a string up to 50 characters'),
```

Potential edge:

```js
// backend/src/controllers/categoryController.js:116
rows = db.prepare('SELECT * FROM categories WHERE user_id = ? AND id IN (' + ids.map(() => '?').join(',') + ')').all(req.user.id, ...ids);
```

This uses placeholders for values, so injection risk is low, but dynamic placeholder SQL should remain tied to a validated non-empty UUID array as it is now.

### Missing Record Checks

Most handlers check missing records before use:

```js
// backend/src/controllers/accountController.js:206-207
const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.id, req.user.id);
if (!account) return res.status(404).json({ error: 'Account not found' });
```

Known no-op risk:

```js
// backend/src/controllers/transactionController.js:104-108
db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
```

The result is not checked; if an account row is missing during a transaction path, the code relies on earlier ownership checks. Admin soft-delete passes `item.account_id`; if the row is missing or `account_id` is null, it can silently not update.

### Race Conditions

SQLite serializes writes, but logical race windows remain:

- Concurrent user transaction creates both read current account before applying overdraft checks. With SQLite write serialization, the DB transaction should serialize writes, but the account object used for `assertBalanceAllowed` is read before entering the transaction in `createTransaction`.

```js
// backend/src/controllers/transactionController.js:181-191
const account = req.body.account_id
  ? getOwnedAccount(req.body.account_id, req.user.id)
  : getOrCreateDefaultCashAccount(req.user.id);
...
const amount = amountToCents(req.body.amount, { allowZero: false });
```

```js
// backend/src/controllers/transactionController.js:205-210
db.transaction(() => {
  if (base.type === 'transfer') {
    const toAccount = getOwnedAccount(req.body.to_account_id, req.user.id);
    ...
    assertBalanceAllowed(account, -amount);
```

Recommendation: re-read source account inside the transaction before overdraft checks.

### Main Fragility Gotchas, Ranked

1. **High likelihood / medium impact**: admin-deleted transaction filtering is inconsistent across reports/export.
2. **Medium likelihood / high impact**: stored `accounts.balance` can drift from derived transaction balance; current code warns but does not auto-repair except admin correction.
3. **Medium likelihood / medium impact**: email/reset token creation can succeed while delivery fails, leaving valid tokens in DB.
4. **Medium likelihood / medium impact**: offline optimistic client state can diverge from server until sync, especially for transfer pairs and balances.
5. **Low likelihood / high impact**: concurrent overdraft checks may be stale because initial source account is read outside the write transaction.

## 9. APP FEATURES

### User Features

- Register/login/email verification/password reset/change password.
- Session management and logout.
- Secure token storage on mobile.
- Profile editing, onboarding flag, user data export/delete/account deletion.
- Accounts with type, currency, icon/color, balance, overdraft limit.
- Transactions: income, expense, transfer, tags, notes, date filters, search, bulk delete, bulk category update.
- Budgets with period/date ranges, spending evaluation, remaining, percent used, weekly breakdown.
- Categories: default + user categories, reorder, CRUD.
- Dashboard summary, net worth, recent transactions, budgets, announcements.
- Notifications and push tokens.
- Recurring transaction background processor.
- Offline queue for mobile mutations.

### Admin/Internal Features

- Admin dashboard stats and system health.
- User list/detail, status/role changes, reset passwords, revoke sessions, impersonation.
- User transaction/account/budget/audit inspection.
- Admin transaction soft delete.
- Admin account status/delete/correction.
- Default category management and push to users.
- Audit log browsing and retention purge.
- Deleted user archives.
- App system config.
- DB integrity check/vacuum/backup.
- Reports and CSV export.
- Announcements.
- Admin API tokens and scopes.
- Webhooks and delivery history.
- Security IP blocks.

## 10. CODE QUALITY OBSERVATIONS

### Strengths

- Strong route-level validation with `express-validator`.
- Prepared SQL with parameter binding throughout the core paths.
- Money storage normalized to integer cents with explicit conversion helpers.
- Balance deltas and derived balance expression are centralized enough to audit.
- Security posture is materially above average for a local monolith: JWT + refresh rotation + security stamps + blocklist + rate limits + Helmet + CORS + audit redaction.
- Tests cover many risk areas (`backend/tests/*` includes auth, admin, accounts, budgets, money, edge cases, recurring processor).

### Technical Debt / Refactoring Targets

1. Create a single repository/service layer for financial writes so account balance mutation, transaction insertion, transfer group handling, and audit are not duplicated across user, admin, recurring, and account-deletion paths.
2. Make `admin_deleted_at` filtering policy explicit: either include deleted records only with `include_deleted`, or clearly name admin reports as all-time/all-records.
3. Standardize API response and error envelopes.
4. Re-read accounts inside transaction before overdraft-sensitive writes.
5. Make delivery-token workflows compensating: revoke reset/verification token when delivery fails, or return success with later resend UX.
6. Add database triggers or reconciliation job for stored vs derived account balance.

### Top Recommendations

1. **Fix inconsistent admin-deleted filtering** in `authController.exportMyData`, `adminController.getDashboardStats`, and admin daily/top category reporting.
2. **Move overdraft checks inside write transactions** and check `.changes` on balance updates.
3. **Define a formal OpenAPI contract** generated from validators/controllers, then update mobile types from it.
4. **Add a reconciliation endpoint/job** that compares `accounts.balance` to `accountCurrentBalanceExpr` and repairs or flags mismatches.
5. **Unify money response serialization** and add tests that assert every money-bearing endpoint returns dollars, not cents.
