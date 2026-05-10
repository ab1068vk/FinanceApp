# Third-Pass Additional Missed Items - 2026-05-10

This is a smaller follow-up to:

- `docs/CODEBASE_TECHNICAL_AUDIT.md`
- `docs/CODEBASE_SUPPLEMENTAL_MISSED_ITEMS.md`
- `docs/COMPLETE_DEEP_TECHNICAL_AUDIT_2026-05-10.md`
- `docs/SECOND_PASS_IMPORTANT_MISSED_ITEMS_2026-05-10.md`

It records additional concrete issues found after a targeted pass over admin API-token scope enforcement, category invariants, transaction update contract drift, and notification preference validation.

## 1. Admin API Tokens With Low Scopes Can Create New High-Scope Tokens

**Status:** IMPORTANT MISSED ITEM  
**Severity:** CRITICAL  
**Impact:** Admin API token scopes are only enforced on routes that explicitly call `requireAdminScope(...)`. `POST /api/admin/api-tokens` does not call `requireAdminScope`, and token creation accepts any scope in `AVAILABLE_TOKEN_SCOPES`, including `admin:*`. A token created with the default `read:users` scope can therefore call the token-creation endpoint and mint a new token with `admin:*`.

Existing reports mention that scopes are checked only on selected routes, but they do not call out the concrete privilege-escalation path through API-token creation.

### Admin API token auth turns the token creator into `req.user`

`backend/src/middleware/auth.js:16-27`

```js
function authenticateApiToken(token, req, res, next) {
  // FIX: 2
  const row = db.prepare(`
    SELECT t.id AS token_id, t.scopes, u.*
    FROM admin_api_tokens t
    -- created_by is joined for audit attribution only, not access control.
    JOIN users u ON u.id = t.created_by
    WHERE t.token_hash = ?
      AND t.is_active = 1
      AND t.revoked_at IS NULL
      AND u.is_active = 1
  `).get(hashToken(token));
```

`backend/src/middleware/auth.js:48-56`

```js
  req.auth = {
    api_token_id: tokenId,
    scopes: parsedScopes,
    sub: user.id,
    token_type: 'admin_api_token',
  };
  req.accessToken = token;
  req.user = sanitizeUser(user);
  return next();
```

### Admin role check does not check token scopes

`backend/src/middleware/auth.js:127-135`

```js
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  return next();
```

### Scope checks only happen when a route calls `requireAdminScope`

`backend/src/middleware/auth.js:138-144`

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

### API-token routes are not scope-gated

`backend/src/routes/adminRoutes.js:230-237`

```js
router.get('/api-tokens', adminController.listApiTokens);
router.get('/token-scopes', adminController.getTokenScopes);
router.post('/api-tokens', [
  body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('name must be 1-100 characters'),
  body('scopes').optional().isArray({ min: 1, max: 20 }).withMessage('scopes must be an array'),
  body('scopes.*').optional().isString().isLength({ min: 1, max: 80 }).withMessage('scope must be 1-80 characters'),
], validate, adminController.createApiToken);
router.delete('/api-tokens/:id', idParam, validate, adminController.revokeApiToken);
```

### Default token scope is `read:users`

`backend/src/controllers/adminController.js:74-79`

```js
function normalizeTokenScopes(scopes) {
  const requestedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : ['read:users'];
  const normalized = [...new Set(requestedScopes.map((scope) => String(scope || '').trim()).filter(Boolean))];
  const invalid = normalized.filter((scope) => !AVAILABLE_TOKEN_SCOPE_SET.has(scope));
  return { scopes: normalized, invalid };
}
```

### `admin:*` is an allowed requested scope

`backend/src/controllers/adminController.js:23-32`

```js
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
```

### Token creation stores whatever allowed scopes were requested

`backend/src/controllers/adminController.js:1888-1905`

```js
    const rawToken = `fa_${crypto.randomBytes(32).toString('hex')}`;
    const row = {
      id: crypto.randomUUID(),
      name: req.body.name,
      token_hash: hashToken(rawToken),
      scopes: JSON.stringify(scopes),
      is_active: 1,
      created_at: nowIso(),
      created_by: req.user.id,
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO admin_api_tokens (id, name, token_hash, scopes, is_active, created_at, created_by)
        VALUES (@id, @name, @token_hash, @scopes, @is_active, @created_at, @created_by)
      `).run(row);
      audit(req, 'ADMIN_CREATED_API_TOKEN', 'api_token', row.id, null, { name: row.name, scopes: JSON.parse(row.scopes) });
    })();
    return res.status(201).json({ id: row.id, name: row.name, scopes: JSON.parse(row.scopes), token: rawToken });
```

## 2. Many Admin Write Routes Are Not Scope-Gated For API Tokens

**Status:** IMPORTANT MISSED ITEM  
**Severity:** HIGH  
**Impact:** The route file applies `requireAuth`, `requireAdmin`, and `adminLimiter` globally, but most write routes do not call `requireAdminScope`. Any active admin API token whose creator is still an active admin can pass those routes regardless of its declared scopes.

### Global admin middleware

`backend/src/routes/adminRoutes.js:163`

```js
router.use(requireAuth, requireAdmin, adminLimiter);
```

### Examples of unscoped write routes

`backend/src/routes/adminRoutes.js:172-193`

```js
router.post('/default-categories', [
  body('name').isString().trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('type').isIn(categoryTypes).withMessage(`type must be one of: ${categoryTypes.join(', ')}`),
  body('icon').optional().isString().isLength({ max: 50 }).withMessage('icon must be up to 50 characters'),
  body('color').optional().isString().isLength({ max: 20 }).withMessage('color must be up to 20 characters').matches(/^#[0-9A-Fa-f]{3,8}$/).withMessage('color must be a valid hex color'),
  body('is_default').optional().isBoolean().withMessage('is_default must be boolean'),
  body('is_system').optional().isBoolean().withMessage('is_system must be boolean'),
  body('sort_order').optional().isInt({ min: 0, max: 10000 }).withMessage('sort_order must be 0-10000'),
], validate, adminController.createDefaultCategory);
router.put('/default-categories/:id', [
```

```js
router.delete('/default-categories/:id', idParam, validate, adminController.deleteDefaultCategory);
router.post('/default-categories/push', adminController.pushDefaultCategories);
```

`backend/src/routes/adminRoutes.js:194-205`

```js
router.post('/users/bulk', [
  body('user_ids').isArray({ min: 1 }).withMessage('user_ids must be a non-empty array'),
  body('user_ids.*').isUUID().withMessage('each user id must be a UUID'),
  body('action').isIn(bulkUserActions).withMessage(`action must be one of: ${bulkUserActions.join(', ')}`),
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.bulkUpdateUsers);
router.get('/audit-retention', adminController.getAuditRetention);
```

```js
router.put('/system-config', systemConfigRules, validate, adminController.updateSystemConfig);
```

`backend/src/routes/adminRoutes.js:221-229`

```js
router.put('/announcements/:id', [
  idParam,
  body('title').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('title must be 1-120 characters'),
  body('body').optional().isString().trim().isLength({ min: 1, max: 1000 }).withMessage('body must be 1-1000 characters'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('starts_at').optional({ nullable: true }).custom(isIsoDate).withMessage('starts_at must be a valid ISO date'),
  body('ends_at').optional({ nullable: true }).custom(isIsoDate).withMessage('ends_at must be a valid ISO date'),
], validate, adminController.updateAnnouncement);
router.delete('/announcements/:id', idParam, validate, adminController.deleteAnnouncement);
```

`backend/src/routes/adminRoutes.js:239-253`

```js
router.post('/webhooks', [
  body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('name must be 1-100 characters'),
  body('url').custom(assertSafeWebhookUrl),
  body('event').isString().trim().isLength({ min: 1, max: 100 }).withMessage('event must be 1-100 characters'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('secret').optional().isString().isLength({ max: 200 }).withMessage('secret must be up to 200 characters'),
], validate, adminController.createWebhook);
router.put('/webhooks/:id', [
```

`backend/src/routes/adminRoutes.js:285-312`

```js
router.put('/users/:id/accounts/:accountId/status', [
  idParam,
  param('accountId').isUUID().withMessage('accountId must be a valid UUID'),
  body('is_active').isBoolean().withMessage('is_active must be boolean'),
  body('reason').optional().isString().isLength({ max: 500 }).withMessage('reason must be up to 500 characters'),
], validate, adminController.updateUserAccountStatus);
router.delete('/users/:id/accounts/:accountId', [
```

```js
router.post('/users/:id/accounts/:accountId/correction', requireConfirmation('balance_correction'), [
```

```js
router.post('/users/:id/revoke-sessions', idParam, validate, adminController.revokeUserSessions);
router.post('/users/:id/impersonate', requireConfirmation('impersonation_token'), [
```

```js
router.put('/users/:id/status', [idParam, body('is_active').isBoolean().withMessage('is_active must be boolean')], validate, adminController.updateUserStatus);
router.put('/users/:id/role', [idParam, body('role').isIn(roles).withMessage(`role must be one of: ${roles.join(', ')}`)], validate, adminController.updateUserRole);
router.post('/users/:id/reset-password', [idParam, passwordRules], validate, adminController.resetUserPassword);
router.delete('/users/:id', destructiveAdminLimiter, requireConfirmation('hard_delete_user'), idParam, validate, adminController.deleteUser);
```

### Examples of routes that do enforce scope

These show the intended mechanism exists, but is not consistently applied.

`backend/src/routes/adminRoutes.js:167-170`

```js
router.delete('/transactions/:id', destructiveAdminLimiter, requireAdminScope('write:transactions'), [
  idParam,
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.adminSoftDeleteTransaction);
```

`backend/src/routes/adminRoutes.js:201-208`

```js
router.post('/audit-retention/purge', destructiveAdminLimiter, requireAdminScope('db:maintenance'), requireConfirmation('audit_log_purge'), [
  body('before').custom(isIsoDate).withMessage('before must be a valid ISO date'),
], validate, adminController.purgeAuditLogs);
router.get('/database/backup', requireAdminScope('db:backup'), adminController.downloadDatabaseBackup);
```

`backend/src/routes/adminRoutes.js:214-220`

```js
router.post('/announcements', requireAdminScope('write:announcements'), [
  body('title').isString().trim().isLength({ min: 1, max: 120 }).withMessage('title must be 1-120 characters'),
  body('body').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('body must be 1-1000 characters'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('starts_at').optional({ nullable: true }).custom(isIsoDate).withMessage('starts_at must be a valid ISO date'),
  body('ends_at').optional({ nullable: true }).custom(isIsoDate).withMessage('ends_at must be a valid ISO date'),
], validate, adminController.createAnnouncement);
```

## 3. Default Category Duplicate Protection Does Not Apply To `user_id IS NULL`

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM  
**Impact:** Default categories are rows where `categories.user_id IS NULL`. SQLite permits multiple `NULL` values in a unique constraint, and the later case-insensitive unique index explicitly applies only when `user_id IS NOT NULL`. Admin default category create/update assumes uniqueness errors can happen, but the schema does not enforce uniqueness for default category `(name, type)` rows.

### Categories table unique constraint includes nullable `user_id`

`backend/database/db.js:113-127`

```js
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

### Case-insensitive unique index excludes default categories

`backend/database/db.js:719-721`

```js
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_type_nocase
      ON categories(user_id, name COLLATE NOCASE, type)
      WHERE user_id IS NOT NULL;
```

### Admin create does not check existing default category first

`backend/src/controllers/adminController.js:1428-1455`

```js
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
      is_default: Object.prototype.hasOwnProperty.call(req.body, 'is_default') ? parseBoolField(req.body.is_default) : 1,
      is_system: parseBoolField(req.body.is_system),
      // FIX: 4
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
    return res.status(201).json(serializeMoney(category));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Default category already exists' });
```

### Admin update also relies on the same missing constraint

`backend/src/controllers/adminController.js:1460-1481`

```js
function updateDefaultCategory(req, res, next) {
  try {
    const oldCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id IS NULL').get(req.params.id);
    if (!oldCategory) return res.status(404).json({ error: 'Default category not found' });
    const allowed = ['name', 'icon', 'color', 'type', 'is_default', 'is_system', 'is_active', 'sort_order'];
    const updates = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = ['is_default', 'is_system', 'is_active'].includes(field) ? parseBoolField(req.body[field]) : req.body[field];
        // FIX: 4
      }
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    db.transaction(() => {
      db.prepare(`UPDATE categories SET ${setSql} WHERE id = @id AND user_id IS NULL`).run({ ...updates, id: req.params.id });
      const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
      audit(req, 'ADMIN_UPDATED_DEFAULT_CATEGORY', 'category', req.params.id, oldCategory, updated);
    })();
    return res.json(serializeMoney(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id)));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Default category already exists' });
```

### Admin list returns all default category duplicates

`backend/src/controllers/adminController.js:1417-1422`

```js
function listDefaultCategories(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id IS NULL').get().count;
    const rows = db.prepare('SELECT * FROM categories WHERE user_id IS NULL ORDER BY type ASC, sort_order ASC, name ASC LIMIT ? OFFSET ?').all(limit, offset);
    return res.json({ data: serializeMoney(rows), pagination: paginationMeta(page, limit, total) });
```

## 4. Transaction Update Type Claims `recurring_interval` Is Updatable, Backend Ignores It

**Status:** IMPORTANT MISSED ITEM  
**Severity:** LOW/MEDIUM  
**Impact:** Mobile TypeScript exposes `recurring_interval` in `UpdateTransactionData`, but the backend update route does not validate it and the controller's allowed field list does not include it. A payload containing only `recurring_interval` returns `400 No allowed fields provided`; a payload containing `recurring_interval` plus another valid field silently ignores `recurring_interval`.

### Mobile update type includes `recurring_interval`

`mobile/src/store/slices/transactionsSlice.ts:60-72`

```ts
  category_id?: string;
  type: TransactionType;
  amount: number;
  description?: string;
  note?: string;
  date: string;
  tags?: string[];
  recurring?: boolean;
  recurring_interval?: 'daily' | 'weekly' | 'monthly' | 'yearly';
};

export type UpdateTransactionData = Partial<Pick<CreateTransactionData, 'amount' | 'description' | 'note' | 'category_id' | 'date' | 'tags' | 'recurring_interval'>> & {
```

`mobile/src/store/slices/transactionsSlice.ts:197-202`

```ts
export const updateTransaction = createAsyncThunk<Transaction, { id: string; data: UpdateTransactionData }, { rejectValue: string }>(
  'transactions/updateTransaction',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await api.put<Transaction>(`/api/transactions/${id}`, data);
      return response.data;
```

### Backend update validator does not include `recurring_interval`

`backend/src/routes/transactionRoutes.js:86-96`

```js
const updateRules = [
  idParam,
  optionalPositiveMoney(body('amount'), 'amount'),
  body('description').optional({ nullable: true }).isString().trim().isLength({ max: 200 }).withMessage('description must be up to 200 characters'),
  body('note').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }).withMessage('note must be up to 1000 characters'),
  body('category_id').optional().isUUID().withMessage('category_id must be a valid UUID'),
  body('date').optional().custom(isIsoDate).withMessage('date must be a valid ISO date'),
  body('tags').optional({ nullable: true }).isArray().withMessage('tags must be an array'),
  body('tags.*').optional().isString().trim().isLength({ max: 50 }).withMessage('each tag must be a string up to 50 characters'),
  body('receipt_path').optional({ nullable: true }).isString().isLength({ max: 255 }).withMessage('receipt_path must be up to 255 characters'),
];
```

### Controller allowed update fields do not include `recurring_interval`

`backend/src/controllers/transactionController.js:307-326`

```js
    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
    if (!oldTx) return res.status(404).json({ error: 'Transaction not found' });
    if (req.body.category_id && !getAllowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    const allowed = ['description', 'note', 'category_id', 'date', 'tags', 'receipt_path'];
    const updates = {};
    let nextAmount;
    const amountChanged = Object.prototype.hasOwnProperty.call(req.body, 'amount');
```

```js
    if (updates.date) updates.date = validateTransactionDate(updates.date);
    if (!Object.keys(updates).length && !amountChanged) return res.status(400).json({ error: 'No allowed fields provided' });
```

## 5. Notification Preference Values Are Not Type-Validated Per Key

**Status:** IMPORTANT MISSED ITEM  
**Severity:** LOW/MEDIUM  
**Impact:** The route only validates that `preferences` is an object. The controller accepts known keys and passes the values through `parseBoolField`, where any truthy value other than exact false-like values becomes `1`. Unknown preference keys are silently ignored.

### Route only validates object shape

`backend/src/routes/authRoutes.js:227-230`

```js
router.get('/notification-settings', requireAuth, authController.getNotificationSettings);
router.put('/notification-settings', requireAuth, [
  body('preferences').isObject().withMessage('preferences must be an object'),
], validate, authController.updateNotificationSettings);
```

### Controller only iterates known keys and ignores unknown keys

`backend/src/controllers/authController.js:800-814`

```js
function updateNotificationSettings(req, res, next) {
  try {
    upsertDefaultPreferences(req.user.id);
    const updates = req.body.preferences || {};
    const update = db.prepare('UPDATE notification_preferences SET enabled = ?, updated_at = ? WHERE user_id = ? AND type = ?');
    const updatedAt = nowIso();
    db.transaction(() => {
      Object.keys(DEFAULT_PREFS).forEach((type) => {
        if (Object.prototype.hasOwnProperty.call(updates, type)) {
          update.run(parseBoolField(updates[type]), updatedAt, req.user.id, type);
          // FIX: 4
        }
      });
    })();
    return getNotificationSettings(req, res, next);
```

### Boolean parser maps arbitrary truthy values to `1`

`backend/src/utils/money.js:35-38`

```js
function parseBoolField(val) {
  // FIX: 4
  if (val === false || val === 0 || val === '0' || val === 'false') return 0;
  return val ? 1 : 0;
}
```

## 6. Third-Pass Risk Ranking

1. **Admin API token privilege escalation via token creation (`adminRoutes.js:230-237`, `adminController.js:1888-1905`)** - a low-scope token can mint an `admin:*` token because token-management routes are not scope-gated.
2. **Unscoped admin write routes for API tokens (`adminRoutes.js:172-312`)** - token scopes communicate least-privilege behavior but many write routes only require admin identity.
3. **Default category duplicates (`db.js:113-127`, `db.js:719-721`, `adminController.js:1428-1455`)** - admin default category uniqueness relies on a constraint that does not apply to `NULL` user IDs.
4. **Transaction update contract drift (`transactionsSlice.ts:71`, `transactionRoutes.js:86-96`, `transactionController.js:310`)** - client typings allow a field the backend rejects or ignores.
5. **Notification preference coercion (`authRoutes.js:227-230`, `authController.js:800-814`, `money.js:35-38`)** - direct API callers can send non-boolean preference values that are coerced instead of rejected.
