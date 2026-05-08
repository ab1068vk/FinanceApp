# Authentication And Authorization Technical Reference

Scope: current codebase as of 2026-05-08. Primary enforcement is in the Express backend. The React Native client stores tokens and hides admin UI, but backend middleware is the security boundary.

## 1. How Users Authenticate

### Credential login

Users authenticate with `POST /api/auth/login`. The route is anonymous, rate limited, and validates `email` and `password`.

`backend/src/routes/authRoutes.js:169`
```js
const loginValidation = [
  emailRule(),
  body('password')
    .isString()
    .withMessage('password must be a string')
    .bail()
    .notEmpty()
    .withMessage('password is required'),
];
```

`backend/src/routes/authRoutes.js:206`
```js
router.post('/register', registerLimiter, registerValidation, validate, authController.register);
router.post('/login', loginLimiter, loginValidation, validate, authController.login);
```

The login controller:

- Looks up `users.email`.
- Rejects inactive, locked, unverified, or bad-password users.
- On success, creates one JWT access token and one opaque refresh token.
- Stores only the refresh token hash in SQLite.
- Returns the raw refresh token once to the client.

`backend/src/controllers/authController.js:300`
```js
async function login(req, res, next) {
  try {
    const email = req.body.email.toLowerCase();
    const password = req.body.password;
    const user = getUserByEmail(email);
```

`backend/src/controllers/authController.js:375`
```js
const refreshToken = generateRefreshToken();
const refreshTokenHash = hashToken(refreshToken);
const refreshFamilyId = crypto.randomUUID();
const expiresAt = addDays(new Date(), REFRESH_TOKEN_DAYS).toISOString();
```

`backend/src/controllers/authController.js:390`
```js
db.prepare(`
INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`).run(crypto.randomUUID(), user.id, refreshFamilyId, refreshTokenHash, expiresAt, loginAt, loginAt, req.get('user-agent') || null);
```

`backend/src/controllers/authController.js:408`
```js
return res.status(200).json({
  accessToken: issueAccessToken(updatedUser),
  refreshToken,
  user: sanitizeUser(updatedUser),
});
```

### Access token

Access tokens are JWTs signed with HS256. They expire in 15 minutes and include a `jti`.

`backend/src/utils/security.js:26`
```js
function generateAccessToken(payload) {
  assertJwtSecret();
  const options = {
    algorithm: JWT_ALGORITHM,
    expiresIn: '15m',
    jwtid: crypto.randomUUID(),
  };
```

The JWT payload created for normal login contains `sub`, `email`, `role`, `must_change_password`, and `security_stamp`; `jsonwebtoken` adds `iat`, `exp`, and `jti`.

`backend/src/controllers/authController.js:116`
```js
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

The token is sent by the client in the `Authorization` header.

`mobile/src/services/api.ts:73`
```ts
const { accessToken } = await getTokens();

if (accessToken) {
  config.headers.Authorization = `Bearer ${accessToken}`;
}
```

### Refresh token

Refresh tokens are 64 random bytes encoded as hex, valid for 30 days, stored server-side as SHA-256 hashes.

`backend/src/utils/security.js:44`
```js
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
```

Refresh token DB storage:

`backend/database/db.js:235`
```js
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

### Client storage

The mobile app stores the raw access token, raw refresh token, and serialized user in Expo SecureStore.

`mobile/src/constants/index.ts:18`
```ts
export const ACCESS_TOKEN_KEY = 'financeapp.accessToken';
export const REFRESH_TOKEN_KEY = 'financeapp.refreshToken';
export const USER_KEY = 'financeapp.user';
```

`mobile/src/services/secureStorage.ts:15`
```ts
export async function saveTokens(accessToken: string, refreshToken: string) {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}
```

No auth session cookie is used for backend API authentication. A CSRF cookie exists, but Bearer-token requests bypass CSRF enforcement.

`backend/src/middleware/csrfProtection.js:76`
```js
function csrfProtection(req, res, next) {
  const token = setCsrfCookie(req, res);
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();
  if (AUTH_EXEMPT_PATHS.has(req.path)) return next();
  if (hasBearerToken(req)) return next();
```

### Admin API tokens

Admins can create long-lived opaque admin API tokens with `fa_` prefix. The raw token is returned once, and only its hash is stored in `admin_api_tokens`.

`backend/database/db.js:338`
```js
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
```

`backend/src/controllers/adminController.js:1823`
```js
const rawToken = `fa_${crypto.randomBytes(32).toString('hex')}`;
const row = {
  id: crypto.randomUUID(),
  name: req.body.name,
  token_hash: hashToken(rawToken),
  scopes: JSON.stringify(scopes),
```

## 2. Token Validation On Each Request

Routes that require auth call `requireAuth`. The middleware accepts two Bearer token types:

- JWT access tokens.
- Admin API tokens beginning with `fa_`.

Actual middleware:

`backend/src/middleware/auth.js:40`
```js
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      recordSecurityEvent(req, [], 'SECURITY_AUTH_MISSING', { reason: 'missing_bearer_token' });
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (token.startsWith('fa_')) {
      return authenticateApiToken(token, req, res, next);
    }
```

`backend/src/middleware/auth.js:54`
```js
const verifyOptions = { algorithms: [JWT_ALGORITHM] };
if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
if (process.env.JWT_AUDIENCE) verifyOptions.audience = process.env.JWT_AUDIENCE;

const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);
const userId = decoded.sub;
```

`backend/src/middleware/auth.js:66`
```js
const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId);

if (!user) {
  recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'unknown_or_inactive_user', subject: userId });
  return res.status(401).json({ error: 'Invalid token' });
}
```

`backend/src/middleware/auth.js:73`
```js
if (isAccessTokenBlocked(decoded.jti)) {
  recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'blocked_access_token', subject: userId });
  return res.status(401).json({ error: 'Invalid token' });
}

if (!decoded.security_stamp || decoded.security_stamp !== user.security_stamp) {
  recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'security_stamp_mismatch', subject: userId });
  return res.status(401).json({ error: 'Invalid token' });
}
```

`backend/src/middleware/auth.js:83`
```js
const isChangePasswordRoute = req.method === 'PUT' && req.originalUrl.split('?')[0] === '/api/auth/change-password';
if ((decoded.must_change_password || user.must_change_password) && !isChangePasswordRoute) {
  return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
}

req.auth = decoded;
req.accessToken = token;
req.user = sanitizeUser(user);
```

Admin API token validation:

`backend/src/middleware/auth.js:11`
```js
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
```

`backend/src/middleware/auth.js:27`
```js
db.prepare('UPDATE admin_api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.token_id);
const { token_id: tokenId, scopes, ...user } = row;
req.auth = {
  api_token_id: tokenId,
  scopes: JSON.parse(scopes || '[]'),
  sub: user.id,
  token_type: 'admin_api_token',
};
req.accessToken = token;
req.user = sanitizeUser(user);
```

## 3. Admin Vs Regular User Separation

The backend separates access by the `users.role` column.

`backend/database/db.js:92`
```js
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  avatar_color TEXT DEFAULT '#0F3460',
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
```

Actual admin check:

`backend/src/middleware/auth.js:107`
```js
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  return next();
}
```

All admin routes apply `requireAuth`, then `requireAdmin`, then rate limiting:

`backend/src/routes/adminRoutes.js:131`
```js
router.use(requireAuth, requireAdmin, adminLimiter);
```

Admin API token scope checks apply only to admin API tokens, not to JWT-backed admins.

`backend/src/middleware/auth.js:119`
```js
function requireAdminScope(scope) {
  return (req, res, next) => {
    if (req.auth?.token_type !== 'admin_api_token') return next();
    const scopes = Array.isArray(req.auth.scopes) ? req.auth.scopes : [];
    if (scopes.includes(scope) || scopes.includes('admin:*')) return next();
    return res.status(403).json({ error: `API token scope required: ${scope}` });
  };
}
```

The mobile app hides admin UI based on `user.role`, but this is not the security boundary.

`mobile/src/navigation/index.tsx:304`
```tsx
const isAdmin = user?.role === 'admin';
const availableMenuItems = React.useMemo(
  () => (isAdmin
    ? [{ name: 'Admin' as const, label: 'Admin Dashboard', icon: 'shield' as const }, ...menuItems]
    : menuItems),
```

`mobile/src/navigation/index.tsx:330`
```tsx
{isAdmin ? <Tab.Screen name="Admin" component={AdminStack} /> : null}
```

## 4. Route Permission Matrix

Mount points:

`backend/src/app.js:187`
```js
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/admin', adminRoutes);
```

### Anonymous routes

| Method | Route | Permission | Code |
|---|---|---:|---|
| POST | `/api/auth/register` | Anonymous, rate limited | `backend/src/routes/authRoutes.js:206` `router.post('/register', registerLimiter, registerValidation, validate, authController.register);` |
| POST | `/api/auth/login` | Anonymous, rate limited | `backend/src/routes/authRoutes.js:207` `router.post('/login', loginLimiter, loginValidation, validate, authController.login);` |
| POST | `/api/auth/forgot-password` | Anonymous, rate limited | `backend/src/routes/authRoutes.js:208` |
| POST | `/api/auth/reset-password` | Anonymous with reset token | `backend/src/routes/authRoutes.js:209` |
| POST | `/api/auth/verify-email` | Anonymous with verification token | `backend/src/routes/authRoutes.js:210` |
| POST | `/api/auth/resend-verification` | Anonymous | `backend/src/routes/authRoutes.js:211` |
| GET | `/api/auth/csrf` | Anonymous | `backend/src/routes/authRoutes.js:212` |
| POST | `/api/auth/refresh` | Anonymous with refresh token | `backend/src/routes/authRoutes.js:213` |
| POST | `/api/client-error` | Anonymous, rate limited | `backend/src/app.js:172` |
| GET | `/health` | Anonymous | `backend/src/app.js:215` |
| GET | `/api/docs` | Anonymous, non-production only | `backend/src/app.js:195` |

### Authenticated regular-user routes

All routes below require a valid Bearer token via `router.use(requireAuth)` or explicit `requireAuth`.

`backend/src/routes/accountRoutes.js:51`
```js
router.use(requireAuth);
router.get('/', controller.getAccounts);
router.post('/', createRules, validate, controller.createAccount);
router.get('/:id', idParam, validate, controller.getAccount);
router.put('/:id', updateRules, validate, controller.updateAccount);
router.delete('/:id', deleteRules, validate, controller.deleteAccount);
```

| Method | Route | Permission |
|---|---|---:|
| POST | `/api/auth/logout` | Authenticated user |
| PUT | `/api/auth/change-password` | Authenticated user; allowed while `must_change_password` |
| GET | `/api/auth/me` | Authenticated user |
| GET | `/api/auth/sessions` | Authenticated user |
| DELETE | `/api/auth/sessions/others` | Authenticated user with current refresh token |
| DELETE | `/api/auth/sessions/:sessionId` | Authenticated user; own session only |
| POST | `/api/auth/push-token` | Authenticated user |
| DELETE | `/api/auth/push-token` | Authenticated user |
| GET | `/api/auth/notification-settings` | Authenticated user |
| PUT | `/api/auth/notification-settings` | Authenticated user |
| GET | `/api/auth/notifications` | Authenticated user |
| PATCH | `/api/auth/notifications/:id/read` | Authenticated user; own notification only |
| GET | `/api/auth/data` | Authenticated user; own export |
| DELETE | `/api/auth/data` | Authenticated user; own data |
| DELETE | `/api/auth/account` | Authenticated user; own account |
| PATCH | `/api/auth/me` | Authenticated user; own profile |
| GET | `/api/accounts` | Authenticated user; own accounts |
| POST | `/api/accounts` | Authenticated user; own account |
| GET | `/api/accounts/:id` | Authenticated user; own account |
| PUT | `/api/accounts/:id` | Authenticated user; own account |
| DELETE | `/api/accounts/:id` | Authenticated user; own account |

Additional user route declarations:

`backend/src/routes/transactionRoutes.js:106`
```js
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

| Method | Route | Permission |
|---|---|---:|
| GET | `/api/transactions` | Authenticated user; own transactions |
| POST | `/api/transactions` | Authenticated user; own transaction |
| GET | `/api/transactions/summary` | Authenticated user; own transactions |
| DELETE | `/api/transactions/bulk` | Authenticated user; own transactions |
| PATCH | `/api/transactions/bulk/category` | Authenticated user; own transactions and allowed category |
| GET | `/api/transactions/:id` | Authenticated user; own transaction |
| PUT | `/api/transactions/:id` | Authenticated user; own transaction |
| DELETE | `/api/transactions/:id` | Authenticated user; own transaction |

`backend/src/routes/budgetRoutes.js:41`
```js
router.use(requireAuth);
router.get('/', controller.getBudgets);
router.post('/', createRules, validate, controller.createBudget);
router.get('/:id', idParam, validate, controller.getBudget);
router.put('/:id', updateRules, validate, controller.updateBudget);
router.delete('/:id', idParam, validate, controller.deleteBudget);
```

| Method | Route | Permission |
|---|---|---:|
| GET | `/api/budgets` | Authenticated user; own budgets |
| POST | `/api/budgets` | Authenticated user; own budget |
| GET | `/api/budgets/:id` | Authenticated user; own budget |
| PUT | `/api/budgets/:id` | Authenticated user; own budget |
| DELETE | `/api/budgets/:id` | Authenticated user; own budget |

`backend/src/routes/categoryRoutes.js:32`
```js
router.use(requireAuth);
router.get('/', controller.getCategories);
router.post('/', createRules, validate, controller.createCategory);
router.put('/reorder', reorderRules, validate, controller.reorderCategories);
router.put('/:id', updateRules, validate, controller.updateCategory);
router.delete('/:id', idParam, validate, controller.deleteCategory);
```

| Method | Route | Permission |
|---|---|---:|
| GET | `/api/categories` | Authenticated user; own plus system/default categories |
| POST | `/api/categories` | Authenticated user; own category |
| PUT | `/api/categories/reorder` | Authenticated user; own categories |
| PUT | `/api/categories/:id` | Authenticated user; own category |
| DELETE | `/api/categories/:id` | Authenticated user; own category |

`backend/src/routes/announcementRoutes.js:14`
```js
router.use(requireAuth);
router.get('/', controller.getActiveAnnouncements);
router.post('/:id/dismiss', idParam, validate, controller.dismissAnnouncement);
```

| Method | Route | Permission |
|---|---|---:|
| GET | `/api/announcements` | Authenticated user; active, not dismissed |
| POST | `/api/announcements/:id/dismiss` | Authenticated user; creates own dismissal row |

### Admin routes

All routes below require `requireAuth` and `requireAdmin`. Rows marked with a scope require that scope only when called with an admin API token; admin JWTs bypass scope checks by design.

`backend/src/routes/adminRoutes.js:131`
```js
router.use(requireAuth, requireAdmin, adminLimiter);
router.get('/dashboard', adminController.getDashboardStats);
router.get('/transactions', transactionFilters, validate, adminController.getAllTransactions);
router.get('/transactions/:id', idParam, validate, adminController.getAdminTransaction);
router.delete('/transactions/:id', destructiveAdminLimiter, requireAdminScope('write:transactions'), [
```

| Method | Route | Permission |
|---|---|---:|
| GET | `/api/admin/dashboard` | Admin |
| GET | `/api/admin/transactions` | Admin |
| GET | `/api/admin/transactions/:id` | Admin |
| DELETE | `/api/admin/transactions/:id` | Admin; API token scope `write:transactions` |
| GET | `/api/admin/default-categories` | Admin |
| POST | `/api/admin/default-categories` | Admin |
| PUT | `/api/admin/default-categories/:id` | Admin |
| DELETE | `/api/admin/default-categories/:id` | Admin |
| POST | `/api/admin/default-categories/push` | Admin |
| POST | `/api/admin/users/bulk` | Admin |
| GET | `/api/admin/audit-retention` | Admin |
| POST | `/api/admin/audit-retention/purge` | Admin; API token scope `db:maintenance`; confirmation required |
| GET | `/api/admin/system-config` | Admin |
| PUT | `/api/admin/system-config` | Admin |
| POST | `/api/admin/database/integrity-check` | Admin |
| POST | `/api/admin/database/vacuum` | Admin; API token scope `db:maintenance`; confirmation required |
| GET | `/api/admin/database/backup` | Admin; API token scope `db:backup` |
| GET | `/api/admin/reports` | Admin |
| GET | `/api/admin/reports/export` | Admin |
| GET | `/api/admin/announcements` | Admin |
| POST | `/api/admin/announcements` | Admin; API token scope `write:announcements` |
| PUT | `/api/admin/announcements/:id` | Admin |
| DELETE | `/api/admin/announcements/:id` | Admin |
| GET | `/api/admin/api-tokens` | Admin |
| GET | `/api/admin/token-scopes` | Admin |
| POST | `/api/admin/api-tokens` | Admin |
| DELETE | `/api/admin/api-tokens/:id` | Admin |
| GET | `/api/admin/webhooks` | Admin |
| POST | `/api/admin/webhooks` | Admin |
| PUT | `/api/admin/webhooks/:id` | Admin |
| GET | `/api/admin/webhooks/:id/deliveries` | Admin |
| GET | `/api/admin/security-blocks` | Admin |
| POST | `/api/admin/security-blocks` | Admin |
| DELETE | `/api/admin/security-blocks/:ip` | Admin |
| GET | `/api/admin/deleted-users` | Admin |
| GET | `/api/admin/deleted-users/:id` | Admin |
| GET | `/api/admin/users` | Admin |
| GET | `/api/admin/users/:id/sessions` | Admin |
| GET | `/api/admin/users/:id` | Admin |
| GET | `/api/admin/users/:id/spending-by-category` | Admin |
| GET | `/api/admin/users/:id/login-history` | Admin |
| GET | `/api/admin/users/:id/budget-performance` | Admin |
| GET | `/api/admin/users/:id/accounts` | Admin |
| PUT | `/api/admin/users/:id/accounts/:accountId/status` | Admin |
| DELETE | `/api/admin/users/:id/accounts/:accountId` | Admin |
| POST | `/api/admin/users/:id/accounts/:accountId/correction` | Admin; confirmation required |
| GET | `/api/admin/users/:id/export` | Admin |
| POST | `/api/admin/users/:id/revoke-sessions` | Admin |
| POST | `/api/admin/users/:id/impersonate` | Admin; confirmation required |
| PUT | `/api/admin/users/:id/status` | Admin |
| PUT | `/api/admin/users/:id/role` | Admin |
| POST | `/api/admin/users/:id/reset-password` | Admin |
| DELETE | `/api/admin/users/:id` | Admin; confirmation required |
| GET | `/api/admin/audit-logs` | Admin |
| GET | `/api/admin/users/:id/transactions` | Admin |
| GET | `/api/admin/system-health` | Admin |

Route declarations for the latter block:

`backend/src/routes/adminRoutes.js:238`
```js
router.get('/users', [
  query('role').optional().isIn(roles).withMessage(`role must be one of: ${roles.join(', ')}`),
  query('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  query('search').optional().isString().isLength({ max: 100 }).withMessage('search must be up to 100 characters'),
  ...paging,
], validate, adminController.getUsers);
```

`backend/src/routes/adminRoutes.js:244`
```js
router.get('/users/:id/sessions', [idParam, ...paging], validate, adminController.getUserSessions);
router.get('/users/:id', idParam, validate, adminController.getUser);
router.get('/users/:id/spending-by-category', [idParam, query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'), query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date')], validate, adminController.getUserSpendingByCategory);
```

`backend/src/routes/adminRoutes.js:268`
```js
router.get('/users/:id/export', [idParam, ...exportPaging], validate, adminController.exportUserData);
router.post('/users/:id/revoke-sessions', idParam, validate, adminController.revokeUserSessions);
router.post('/users/:id/impersonate', requireConfirmation('impersonation_token'), [
```

## 5. Expired, Revoked, Or Invalid Tokens

### Expired access token

`jsonwebtoken` throws `TokenExpiredError`; response is `401 { error: "Token expired" }`.

`backend/src/middleware/auth.js:92`
```js
} catch (error) {
  if (error.name === 'TokenExpiredError') {
    recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'token_expired' });
    return res.status(401).json({ error: 'Token expired' });
  }
```

The mobile client sees any 401 and attempts refresh once.

`mobile/src/services/api.ts:101`
```ts
if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
  return Promise.reject(error);
}

originalRequest._retry = true;
```

`mobile/src/services/api.ts:125`
```ts
const response = await axios.post<{ accessToken: string; refreshToken?: string }>(
  `${API_BASE_URL}/api/auth/refresh`,
  { refreshToken },
  { timeout: 10000 }
);
```

### Invalid JWT

`JsonWebTokenError` returns `401 { error: "Invalid token" }`.

`backend/src/middleware/auth.js:98`
```js
if (error.name === 'JsonWebTokenError') {
  recordSecurityEvent(req, [], 'SECURITY_AUTH_FAILURE', { reason: 'invalid_jwt', message: error.message });
  return res.status(401).json({ error: 'Invalid token' });
}
```

### Logged-out access token

Logout revokes the submitted refresh token and adds the current access token `jti` to `access_token_blocklist` until its JWT `exp`.

`backend/src/controllers/authController.js:479`
```js
function logout(req, res, next) {
  try {
    const tokenHash = hashToken(req.body.refreshToken);

    db.prepare(`
      UPDATE refresh_tokens
      SET revoked = 1
      WHERE token_hash = ? AND user_id = ?
    `).run(tokenHash, req.user.id);

    blockAccessToken(req.auth?.jti, req.auth?.exp);
```

`backend/src/utils/accessTokenBlocklist.js:17`
```js
function blockAccessToken(jti, expiresAtSeconds) {
  if (!jti || !expiresAtSeconds) return;
  const expiresAtMs = expiresAtSeconds * 1000;
  if (expiresAtMs <= Date.now()) return;
  const expiresAt = new Date(expiresAtMs).toISOString();
```

`backend/src/utils/accessTokenBlocklist.js:31`
```js
function isAccessTokenBlocked(jti) {
  if (!jti) return false;
  pruneExpiredBlockedTokens();
  const cachedExpiry = blockedJtis.get(jti);
  if (cachedExpiry && cachedExpiry > Date.now()) return true;
```

### Revoked or reused refresh token

Refresh token rotation revokes the old token and inserts a new token in the same family.

`backend/src/controllers/authController.js:457`
```js
db.transaction(() => {
  db.prepare('UPDATE refresh_tokens SET revoked = 1, last_used_at = ? WHERE id = ?').run(createdAt, storedToken.id);
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(crypto.randomUUID(), storedToken.user_id, storedToken.family_id || storedToken.id, nextRefreshTokenHash, expiresAt, createdAt, createdAt, req.get('user-agent') || null);
```

If a revoked refresh token is presented, the whole token family is revoked and the response is `401`.

`backend/src/controllers/authController.js:432`
```js
if (storedToken.revoked) {
  if (storedToken.family_id) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?').run(storedToken.family_id);
  writeSecurityLog(req, {
    userId: storedToken.user_id,
    action: 'SECURITY_REFRESH_TOKEN_REUSE',
    newValue: { family_id: storedToken.family_id },
  });
  return res.status(401).json({ error: 'Invalid refresh token' });
}
```

Expired refresh tokens are marked revoked and rejected.

`backend/src/controllers/authController.js:446`
```js
if (new Date(storedToken.expires_at).getTime() <= Date.now()) {
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(storedToken.id);
  return res.status(401).json({ error: 'Invalid refresh token' });
}
```

### Security stamp invalidation

Password changes, admin role changes, admin session revocation, forced password reset, and account deletion update `users.security_stamp`. Any existing JWT with the old stamp fails at middleware line 78.

`backend/src/controllers/adminController.js:1557`
```js
db.prepare('UPDATE users SET security_stamp = ?, updated_at = ? WHERE id = ?').run(newSecurityStamp(), nowIso(), req.params.id);
result = db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(req.params.id);
```

## 6. Cross-User Data Access Or Modification

### Regular users

The regular user controllers consistently constrain access with `req.user.id`.

Account ownership:

`backend/src/controllers/accountController.js:152`
```js
const account = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
  FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1`).get(req.params.id, req.user.id);
```

Transaction ownership:

`backend/src/controllers/transactionController.js:281`
```js
const tx = db.prepare(`SELECT t.*, c.name AS category_name, a.name AS account_name FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
  WHERE t.id = ? AND t.user_id = ? AND t.admin_deleted_at IS NULL`).get(req.params.id, req.user.id);
```

Budget ownership:

`backend/src/controllers/budgetController.js:132`
```js
const budget = db.prepare(`SELECT b.*, c.name AS category_name FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
  WHERE b.id = ? AND b.user_id = ?`).get(req.params.id, req.user.id);
```

Category ownership:

`backend/src/controllers/categoryController.js:87`
```js
const oldCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
```

Notification ownership:

`backend/src/controllers/authController.js:835`
```js
function markNotificationRead(req, res, next) {
  try {
    const readAt = nowIso();
    const result = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(readAt, req.params.id, req.user.id);
```

No regular-user route was found that reads or writes another user's accounts, budgets, transactions, notifications, push tokens, or sessions without either `req.user.id` filtering or an explicit admin route.

### Intentional admin cross-user access

Admin routes intentionally access and mutate user data by `:id`.

Admin user detail reads profile, summary, and audit data:

`backend/src/controllers/adminController.js:570`
```js
function getUser(req, res, next) {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
```

Admin user transaction reads:

`backend/src/controllers/adminController.js:887`
```js
function getUserTransactions(req, res, next) {
  try {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { page, limit, offset } = pagination(req);
    const where = ['t.user_id = ?'];
```

Admin export reads complete user data:

`backend/src/controllers/adminController.js:1036`
```js
function exportUserData(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
```

Admin impersonation mints a normal user access token with extra impersonation claims:

`backend/src/controllers/adminController.js:1966`
```js
function impersonateUser(req, res, next) {
  try {
    const user = assertUserExists(req.params.id);
    if (!user || !user.is_active) return res.status(404).json({ error: 'Active user not found' });
    const warning = 'Support impersonation is sensitive. All use must be justified and audited.';
    const token = generateAccessToken({
      sub: user.id,
```

`backend/src/controllers/adminController.js:1971`
```js
const token = generateAccessToken({
  sub: user.id,
  email: user.email,
  role: user.role,
  security_stamp: user.security_stamp,
  must_change_password: Boolean(user.must_change_password),
  impersonated_by: req.user.id,
```

## 7. Admin Actions Affecting User-Facing Data Without User Notification

The app has an in-app notifications table and push notification utility:

`backend/src/controllers/adminController.js:171`
```js
function createUserNotification(userId, type, title, body, data = {}) {
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, data_json, created_at)
```

Actions with explicit user notifications:

- Admin password reset inserts `admin-password-reset`.
- Admin account delete inserts `admin-account-deleted`.
- New announcement sends push notifications.

`backend/src/controllers/adminController.js:752`
```js
createUserNotification(
  req.params.id,
  'admin-password-reset',
  'Password reset by admin',
  'An administrator reset your password. Use the temporary password they provide, then choose a new password at login.',
```

`backend/src/controllers/adminController.js:1309`
```js
createUserNotification(
  req.params.id,
  'admin-account-deleted',
  'Account deleted by admin',
  `Your account "${account.name}" was deleted by an administrator. Reason: ${reason}`,
```

`backend/src/controllers/adminController.js:1751`
```js
const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all();
users.forEach((user) => {
  void sendPushNotification(user.id, row.title, row.body, { type: 'admin_announcement', announcementId: row.id })
```

Actions affecting user-facing data with no direct user notification in the controller:

| Action | Effect | Code |
|---|---|---|
| `updateUserStatus` | Activates/deactivates user and revokes sessions when deactivated | `backend/src/controllers/adminController.js:633` `UPDATE users SET is_active = ?` |
| `updateUserRole` | Changes role, revokes sessions, invalidates JWTs | `backend/src/controllers/adminController.js:721` `UPDATE users SET role = ?, security_stamp = ?` |
| `bulkUpdateUsers` deactivate | Activates/deactivates many users, may revoke sessions | `backend/src/controllers/adminController.js:1537` |
| `bulkUpdateUsers` force password reset | Sets `must_change_password`, revokes sessions | `backend/src/controllers/adminController.js:1540` |
| `revokeUserSessions` | Invalidates access tokens via stamp and revokes refresh tokens | `backend/src/controllers/adminController.js:1557` |
| `adminSoftDeleteTransaction` | Hides transaction from user queries and changes account balance | `backend/src/controllers/adminController.js:1223` |
| `updateUserAccountStatus` | Hides or shows an account | `backend/src/controllers/adminController.js:1263` |
| `createAccountBalanceCorrection` | Inserts user-visible transaction and changes balance | `backend/src/controllers/adminController.js:1363` |
| `deleteDefaultCategory` | Clears category references from all matching transactions and budgets | `backend/src/controllers/adminController.js:1459` |
| `pushDefaultCategories` | Inserts categories into every active user account | `backend/src/controllers/adminController.js:1503` |
| `updateAnnouncement` | Changes active announcements users may see | `backend/src/controllers/adminController.js:1773` |
| `deleteAnnouncement` | Removes announcement and dismissals | `backend/src/controllers/adminController.js:1788` |
| `updateSystemConfig` | Changes runtime settings such as password policy and lockout configuration | `backend/src/controllers/adminController.js:1611` |

Representative snippets:

`backend/src/controllers/adminController.js:1210`
```js
function adminSoftDeleteTransaction(req, res, next) {
  try {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND admin_deleted_at IS NULL').get(req.params.id);
```

`backend/src/controllers/adminController.js:1221`
```js
db.transaction(() => {
  for (const item of related) {
    updateStoredBalance(item.account_id, item.user_id, -computeBalanceDelta(item));
    db.prepare(`
      UPDATE transactions
      SET admin_deleted_at = ?, admin_deleted_by = ?, admin_delete_reason = ?, updated_at = ?
```

`backend/src/controllers/adminController.js:1331`
```js
function createAccountBalanceCorrection(req, res, next) {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.accountId, req.params.id);
```

`backend/src/controllers/adminController.js:1363`
```js
db.prepare(`
  INSERT INTO transactions (
    id, user_id, account_id, category_id, type, amount, description, note, date,
```

## 8. Inputs Not Fully Validated Or Sanitized Before DB

Most route inputs use `express-validator`, prepared statements, and global security middleware:

`backend/src/app.js:163`
```js
app.use(hpp());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(securityMonitor);
app.use(mongoSanitize({ replaceWith: '_' }));
app.use(csrfProtection);
```

Prepared statements are used for DB access; no direct string interpolation of untrusted values was found except whitelisted SQL fragments and placeholder lists built from validated arrays.

Observed validation/sanitization gaps or weak validation:

### `/api/client-error` accepts unvalidated metadata before logging

This does not write to SQLite directly, but it logs user-supplied metadata. Message/stack fields are sliced; `metadata` is accepted as any object.

`backend/src/app.js:172`
```js
app.post('/api/client-error', clientErrorLimiter, (req, res) => {
  const body = req.body || {};
  logger.error('Client-side error reported', {
```

`backend/src/app.js:177`
```js
message: String(body.message || 'Client error').slice(0, 500),
stack: body.stack ? String(body.stack).slice(0, 4000) : undefined,
screen: body.screen ? String(body.screen).slice(0, 120) : undefined,
appVersion: body.appVersion ? String(body.appVersion).slice(0, 80) : undefined,
platform: body.platform ? String(body.platform).slice(0, 80) : undefined,
type: body.type ? String(body.type).slice(0, 40) : 'client',
metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
```

### Security monitor writes request-derived findings before route validators

Suspicious inputs are serialized into `audit_logs.new_value` before per-route validation. It truncates previews to 500 characters, but it intentionally records path, source, and findings from body/query/params/headers.

`backend/src/middleware/securityMonitor.js:91`
```js
function recordSecurityEvent(req, findings, action = 'SECURITY_ATTACK_ATTEMPT', extra = {}) {
  if (!findings.length && action === 'SECURITY_ATTACK_ATTEMPT') return;

  const payload = {
    request_id: req.id,
    method: req.method,
    path: req.originalUrl,
```

`backend/src/middleware/securityMonitor.js:104`
```js
try {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
    VALUES (?, NULL, ?, 'security', NULL, NULL, ?, ?, ?, ?)
  `).run(
```

### Admin IP block input is length-checked but not IP-validated

`ip` can be any 3-80 character string and is stored as the primary key.

`backend/src/routes/adminRoutes.js:223`
```js
router.get('/security-blocks', adminController.getSecurityBlocks);
router.post('/security-blocks', [
  body('ip').isString().isLength({ min: 3, max: 80 }).withMessage('ip must be 3-80 characters'),
  body('duration_minutes').optional().isInt({ min: 1, max: 1440 }).withMessage('duration_minutes must be 1-1440'),
], validate, adminController.blockSecurityAddress);
```

`backend/src/middleware/securityMonitor.js:202`
```js
function blockSecurityIp(ip, durationMs = BLOCK_MS) {
  const now = Date.now();
  const state = getStrikeState(ip) || { count: STRIKE_LIMIT, firstSeen: now, blockedUntil: 0 };
```

### Admin default category color is length-checked, not hex-validated

Regular user category colors require hex, but admin default category colors allow any string up to 20 characters.

`backend/src/routes/adminRoutes.js:140`
```js
router.post('/default-categories', [
  body('name').isString().trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('type').isIn(categoryTypes).withMessage(`type must be one of: ${categoryTypes.join(', ')}`),
  body('icon').optional().isString().isLength({ max: 50 }).withMessage('icon must be up to 50 characters'),
  body('color').optional().isString().isLength({ max: 20 }).withMessage('color must be up to 20 characters'),
```

`backend/src/controllers/adminController.js:1400`
```js
const category = {
  id: crypto.randomUUID(),
  user_id: null,
  name: String(req.body.name).trim(),
  icon: req.body.icon || null,
  color: req.body.color || null,
```

### Admin system config `date_format` is only length-validated

The value is persisted to `app_settings.value` inside a JSON blob.

`backend/src/routes/adminRoutes.js:91`
```js
const systemConfigRules = [
  body('max_accounts_per_user').optional().isInt({ min: 1, max: 1000 }).withMessage('max_accounts_per_user must be 1-1000').toInt(),
  body('default_currency')
    .optional()
    .isString().trim().matches(/^[A-Za-z]{3}$/).withMessage('default_currency must be a 3-letter currency code')
    .customSanitizer((value) => String(value).toUpperCase()),
  body('date_format').optional().isString().isLength({ max: 40 }).withMessage('date_format must be up to 40 characters'),
```

`backend/src/controllers/adminController.js:1607`
```js
for (const key of allowed) {
  if (Object.prototype.hasOwnProperty.call(req.body, key)) nextSettings[key] = req.body[key];
}
db.transaction(() => {
  setSetting(req, 'runtime', nextSettings);
```

## 9. Error Messages That Leak Internal State Or Sensitive State

### Login reveals deleted-account state

For an email in `deleted_users`, login returns 410 and a deletion-specific message.

`backend/src/controllers/authController.js:306`
```js
if (!user) {
  await verifyPassword(password, await dummyPasswordHashPromise);
  const deletedUser = getDeletedUserByEmail(email);
```

`backend/src/controllers/authController.js:313`
```js
if (deletedUser) {
  return res.status(410).json({
    error: 'Your account was deleted by an administrator.',
    code: 'ACCOUNT_DELETED',
  });
}
```

### Login reveals unverified email state

For an existing active unverified user, the controller calls `verifyPassword` but does not check the result before returning `EMAIL_NOT_VERIFIED`. This leaks that the email exists and is unverified even if the submitted password is wrong.

`backend/src/controllers/authController.js:332`
```js
if (emailVerificationRequired() && !user.email_verified_at) {
  await verifyPassword(password, user.password_hash);
  writeSecurityLog(req, {
    action: 'SECURITY_AUTH_FAILURE',
    userId: user.id,
```

`backend/src/controllers/authController.js:339`
```js
return res.status(403).json({
  error: 'Please verify your email before signing in.',
  code: 'EMAIL_NOT_VERIFIED',
});
```

### Locked account response reveals lockout state and retry time

`backend/src/controllers/authController.js:345`
```js
if (isLocked(user)) {
  return res.status(423).json({
    error: 'Account temporarily locked',
    retryAfter: lockTimeRemaining(user.locked_until),
  });
}
```

### Admin API token scope errors reveal allowed scopes

This is admin-only, but failed token creation returns invalid scopes and the full allowed scope list.

`backend/src/controllers/adminController.js:1818`
```js
return res.status(400).json({
  error: `Invalid API token scope${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}`,
  allowed_scopes: AVAILABLE_TOKEN_SCOPES,
});
```

### Non-500 application errors return raw `err.message`

Any thrown error with a non-500 `statusCode` is returned directly.

`backend/src/app.js:263`
```js
res.status(statusCode).json({
  error: statusCode === 500 ? 'Internal server error' : err.message,
});
```

Examples of deliberately thrown non-500 errors include invalid export cursors and invalid or expired reset/verification tokens.

`backend/src/controllers/adminController.js:249`
```js
const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
```

`backend/src/controllers/adminController.js:261`
```js
throw Object.assign(new Error('Invalid export cursor'), { statusCode: 400 });
```

## 10. Main Gotchas

1. **Admin API token scopes are sparse and only apply to API tokens.** Most admin routes do not call `requireAdminScope`, and JWT-backed admins bypass scope checks entirely.

`backend/src/middleware/auth.js:121`
```js
if (req.auth?.token_type !== 'admin_api_token') return next();
```

2. **Unverified-login path leaks account existence/status.** The code does not require a correct password before returning `EMAIL_NOT_VERIFIED`.

`backend/src/controllers/authController.js:332`
```js
if (emailVerificationRequired() && !user.email_verified_at) {
  await verifyPassword(password, user.password_hash);
```

3. **Admin session revocation invalidates JWTs by security stamp, but regular logout only blocklists the current access token.** Revoking a refresh token by session ID does not blocklist access tokens already issued for that session.

`backend/src/controllers/authController.js:875`
```js
function revokeSession(req, res, next) {
  try {
    const result = db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND user_id = ?')
```

4. **CSRF exists, but Bearer requests bypass it.** This is normal for token-auth mobile APIs, but it means the CSRF cookie is not protecting the primary mobile path.

`backend/src/middleware/csrfProtection.js:80`
```js
if (hasBearerToken(req)) return next();
```

5. **Admin soft delete changes balances and hides transactions without notifying the user.** User transaction queries exclude `admin_deleted_at`, and account balance is adjusted.

`backend/src/controllers/transactionController.js:251`
```js
const where = ['t.user_id = ?', 't.admin_deleted_at IS NULL'];
```

`backend/src/controllers/adminController.js:1223`
```js
updateStoredBalance(item.account_id, item.user_id, -computeBalanceDelta(item));
```

6. **Admin user-transaction endpoint includes admin-deleted transactions.** Unlike regular user queries, `getUserTransactions` does not add `t.admin_deleted_at IS NULL`; admins can see all user transactions through that route.

`backend/src/controllers/adminController.js:887`
```js
function getUserTransactions(req, res, next) {
  try {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
```

`backend/src/controllers/adminController.js:893`
```js
const where = ['t.user_id = ?'];
const params = [req.params.id];
```

7. **Admin spending-by-category ignores soft delete state.** It filters user and expense type, but does not exclude `admin_deleted_at`.

`backend/src/controllers/adminController.js:954`
```js
const params = [req.params.id];
const where = ['t.user_id = ?', "t.type = 'expense'", ...userDateFilters(req, 't.date', params)];
```

8. **User profile update builds SQL dynamically, but only from whitelisted keys.** This looks risky at first glance; the field names come from local code, not request keys.

`backend/src/controllers/authController.js:918`
```js
const updates = {};
if (Object.prototype.hasOwnProperty.call(req.body, 'full_name')) {
  updates.full_name = req.body.full_name.trim();
}
```

`backend/src/controllers/authController.js:936`
```js
const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
db.prepare(`UPDATE users SET ${setSql} WHERE id = @id`).run({ ...updates, id: req.user.id });
```

9. **Impersonation tokens look like normal user access tokens except for extra claims.** Downstream normal-user routes do not check `impersonated_by`; they will treat the request as the target user.

`backend/src/controllers/adminController.js:1971`
```js
const token = generateAccessToken({
  sub: user.id,
  email: user.email,
  role: user.role,
  security_stamp: user.security_stamp,
  must_change_password: Boolean(user.must_change_password),
  impersonated_by: req.user.id,
```

10. **Development/test flags can return reset or verification tokens in responses.** This is gated by both environment and explicit flags, but it is sensitive.

`backend/src/controllers/authController.js:132`
```js
if (['development', 'test'].includes(process.env.NODE_ENV) && process.env.ALLOW_RESET_TOKEN_IN_RESPONSE === 'true') {
  response.resetToken = token;
}
```

`backend/src/controllers/authController.js:145`
```js
if (['development', 'test'].includes(process.env.NODE_ENV) && process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE === 'true') {
  response.verificationToken = token;
}
```
