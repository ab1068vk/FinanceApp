# Second-Pass Important Missed Items Audit - 2026-05-10

This report was created after reviewing the existing reports in `docs/`:

- `docs/CODEBASE_TECHNICAL_AUDIT.md`
- `docs/CODEBASE_SUPPLEMENTAL_MISSED_ITEMS.md`
- `docs/COMPLETE_DEEP_TECHNICAL_AUDIT_2026-05-10.md`

It does not repeat the broad architecture, schema, API, money, auth, mobile, and risk material already covered there. It records important codebase behaviors that are either absent from those reports or only implied without a concrete failure path.

## 1. Recurring Transaction UI Does Not Create Backend Recurring Rules

**Status:** IMPORTANT MISSED ITEM  
**Severity:** HIGH  
**Impact:** A user can mark a normal transaction as recurring in the mobile app, and the backend stores `transactions.recurring = 1`, but the backend processor only generates future transactions from `recurring_transactions`. No route or controller inserts into `recurring_transactions`, so mobile-created recurring transactions become reminders only, not actual scheduled transactions.

Existing reports document both `transactions.recurring` and the `recurring_transactions` table, but they do not call out that the mobile workflow writes one representation while the backend processor reads another.

### Mobile sends `recurring` on normal transaction create

`mobile/src/screens/transactions/AddTransactionScreen.tsx:202-213`

```tsx
      await dispatch(createTransaction({
        account_id: accountId || undefined,
        to_account_id: type === 'transfer' ? toAccountId : undefined,
        category_id: categoryId || undefined,
        type,
        amount: parsedAmount,
        description: description.trim() || undefined,
        note: note.trim() || undefined,
        date: new Date(`${date}T00:00:00.000Z`).toISOString(),
        tags,
        recurring,
        recurring_interval: recurring ? interval : undefined,
      })).unwrap();
```

`mobile/src/screens/transactions/AddTransactionScreen.tsx:303-307`

```tsx
              <View style={styles.recurringRow}>
                <Text style={styles.recurringText}>Recurring</Text>
                <Switch value={recurring} onValueChange={setRecurring} trackColor={{ true: '#E94560' }} />
              </View>
              {recurring ? <View style={styles.intervalRow}>{(['daily', 'weekly', 'monthly', 'yearly'] as Interval[]).map((item) => <TouchableOpacity key={item} style={[styles.intervalPill, interval === item && styles.intervalPillActive]} onPress={() => setInterval(item)}><Text style={[styles.intervalText, interval === item && styles.intervalTextActive]}>{item}</Text></TouchableOpacity>)}</View> : null}
```

### Backend validates and stores those fields on `transactions`

`backend/src/routes/transactionRoutes.js:83-84`

```js
  body('recurring').optional().isBoolean().withMessage('recurring must be boolean'),
  body('recurring_interval').optional({ nullable: true }).isIn(['daily', 'weekly', 'monthly', 'yearly']).withMessage('recurring_interval must be daily, weekly, monthly, or yearly'),
```

`backend/src/controllers/transactionController.js:195-200`

```js
      id: crypto.randomUUID(), user_id: req.user.id, account_id: account.id, category_id: categoryId,
      type: req.body.type, amount, description: sanitizeText(req.body.description), note: sanitizeText(req.body.note),
      date: transactionDate, recurring: parseBoolField(req.body.recurring),
      // FIX: 4
      recurring_interval: req.body.recurring_interval || null, receipt_path: req.body.receipt_path || null,
      tags: JSON.stringify(parseTags(req.body.tags)), transfer_group_id: null, transfer_direction: null,
```

`backend/src/controllers/transactionController.js:111-120`

```js
  db.prepare(`INSERT INTO transactions (
      id, user_id, account_id, category_id, type, amount, description, note, date,
      recurring, recurring_interval, receipt_path, tags, transfer_group_id,
      transfer_direction, to_account_id, from_account_id, created_at, updated_at
    )
    VALUES (
      @id, @user_id, @account_id, @category_id, @type, @amount, @description, @note, @date,
      @recurring, @recurring_interval, @receipt_path, @tags, @transfer_group_id,
      @transfer_direction, @to_account_id, @from_account_id, @created_at, @updated_at
    )`).run(tx);
```

### Backend processor ignores `transactions.recurring`

`backend/src/utils/recurringProcessor.js:63-73`

```js
    SELECT rt.*,
           a.type AS account_type,
           a.balance AS account_balance,
           a.overdraft_limit,
           c.type AS category_type
    FROM recurring_transactions rt
    JOIN users u ON u.id = rt.user_id AND u.is_active = 1
    JOIN accounts a ON a.id = rt.account_id AND a.user_id = rt.user_id AND a.is_active = 1
    LEFT JOIN categories c ON c.id = rt.category_id AND (c.user_id = rt.user_id OR c.user_id IS NULL)
    WHERE rt.is_active = 1
      AND rt.next_due_date <= ?
```

`backend/src/utils/recurringProcessor.js:123-142`

```js
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
    `).run(transaction);
    db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(balanceDelta(rule), processedAt, rule.account_id, rule.user_id);
    db.prepare(`
      UPDATE recurring_transactions
      SET last_processed_date = ?, next_due_date = ?
      WHERE id = ?
    `).run(today, nextDueDate, rule.id);
```

### Schema has two separate recurring concepts

`backend/database/db.js:155-156`

```js
      recurring INTEGER DEFAULT 0 CHECK (recurring IN (0, 1)),
      recurring_interval TEXT CHECK (recurring_interval IS NULL OR recurring_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
```

`backend/database/db.js:174-188`

```js
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
```

### Codebase search result

The only `INSERT INTO recurring_transactions` occurrences are in schema/migration code, not request handlers:

`backend/database/db.js:1000-1003`

```js
        INSERT INTO recurring_transactions_money_next
        SELECT id, user_id, account_id, category_id, ROUND(COALESCE(amount, 0) * 100),
               description, frequency, next_due_date, last_processed_date, is_active, created_at
        FROM recurring_transactions;
```

No controller route creates a `recurring_transactions` row.

## 2. Backend Does Not Enforce Category Type Against Transaction Type

**Status:** IMPORTANT MISSED ITEM  
**Severity:** HIGH  
**Impact:** The mobile UI filters categories by transaction type, but the backend accepts any active category visible to the user. A direct API caller can create an expense with an income category, an income with an expense category, or bulk-move existing transactions into a category with the wrong type. Budget and report logic then depends on transaction type in some places and category type in others.

### Backend category lookup only checks ownership/visibility/active state

`backend/src/controllers/transactionController.js:62-64`

```js
function getAllowedCategory(id, userId) {
  // FIX: 3
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND is_active = 1').get(id, userId);
}
```

### Create transaction does not compare `category.type` with `req.body.type`

`backend/src/controllers/transactionController.js:186-199`

```js
    const categoryId = req.body.category_id || null;
    if (categoryId && !getAllowedCategory(categoryId, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    if (req.body.type !== 'transfer' && !categoryId) return res.status(400).json({ error: 'category_id is required' });

    assertTransactionAmount(Number(req.body.amount));
    const amount = amountToCents(req.body.amount, { allowZero: false });
    const transactionDate = normalizeTransactionDate(req.body.date);
    const createdAt = nowIso();
    const baseTx = {
      id: crypto.randomUUID(), user_id: req.user.id, account_id: account.id, category_id: categoryId,
      type: req.body.type, amount, description: sanitizeText(req.body.description), note: sanitizeText(req.body.note),
      date: transactionDate, recurring: parseBoolField(req.body.recurring),
```

### Update transaction allows category replacement without type check

`backend/src/controllers/transactionController.js:307-310`

```js
    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
    if (!oldTx) return res.status(404).json({ error: 'Transaction not found' });
    if (req.body.category_id && !getAllowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    const allowed = ['description', 'note', 'category_id', 'date', 'tags', 'receipt_path'];
```

### Bulk category update also lacks a transaction-type/category-type check

`backend/src/controllers/transactionController.js:523-533`

```js
function bulkUpdateTransactionCategory(req, res, next) {
  try {
    const ids = uniqueIds(req.body.transaction_ids);
    if (!getAllowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });

    const existing = db.prepare(`SELECT id, category_id FROM transactions WHERE user_id = ? AND admin_deleted_at IS NULL AND id IN (${placeholders(ids)})`).all(req.user.id, ...ids);
    if (existing.length !== ids.length) return res.status(404).json({ error: 'One or more transactions were not found' });

    const updatedAt = nowIso();
```

### Mobile applies the missing invariant only locally

`mobile/src/screens/transactions/AddTransactionScreen.tsx:131-132`

```tsx
  const filteredCategories = useMemo(() => categories
    .filter((category) => type === 'transfer' || !category.type || category.type === type)
```

`mobile/src/screens/transactions/EditTransactionScreen.tsx:65-67`

```tsx
  const availableCategories = useMemo(() => {
    if (!transaction || transaction.type === 'transfer') return categories;
    return categories.filter((category) => !category.type || category.type === transaction.type);
```

## 3. Budgets Can Be Created For Income Categories Through The API

**Status:** IMPORTANT MISSED ITEM  
**Severity:** HIGH  
**Impact:** The mobile budget screen hides income categories, but the backend accepts any active visible category for a budget. Budget evaluation only sums `transactions.type = 'expense'`, so a budget attached to an income category is valid at the API level but will likely show zero spending unless mismatched expense rows exist.

### Backend budget category validation does not require expense category

`backend/src/controllers/budgetController.js:18-20`

```js
function allowedCategory(id, userId) {
  // FIX: 3
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND is_active = 1').get(id, userId);
}
```

`backend/src/controllers/budgetController.js:109-121`

```js
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
```

### Budget spending only counts expense transactions

`backend/src/controllers/budgetController.js:132-148`

```js
    const budgets = db.prepare(`SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
      COALESCE(SUM(t.amount), 0) AS current_spending
      FROM budgets b
      LEFT JOIN categories c ON c.id = b.category_id
      LEFT JOIN transactions t ON t.user_id = b.user_id
        AND t.category_id = b.category_id
        AND t.type = 'expense'
        AND t.admin_deleted_at IS NULL
        AND datetime(t.date) >= datetime(b.start_date)
        AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date, '+1 day', '-1 second'))
      WHERE b.user_id = ?
      GROUP BY b.id
      ORDER BY b.created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
    const data = budgets.map((budget) => ({
      ...budget,
      remaining: Number(budget.amount) - Number(budget.current_spending),
      percent_used: budgetPercentUsed(budget.amount, budget.current_spending),
```

`backend/src/controllers/budgetController.js:160-176`

```js
    const currentSpending = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions WHERE user_id = ? AND category_id = ? AND type = 'expense'
      AND admin_deleted_at IS NULL
      AND datetime(date) >= datetime(?) AND (? IS NULL OR datetime(date) <= datetime(?, '+1 day', '-1 second'))`)
      .get(req.user.id, budget.category_id, budget.start_date, budget.end_date, budget.end_date);

    const breakdown = db.prepare(`SELECT strftime('%Y-W%W', date) AS week, COALESCE(SUM(amount), 0) AS spending
      FROM transactions WHERE user_id = ? AND category_id = ? AND type = 'expense'
      AND admin_deleted_at IS NULL
      AND datetime(date) >= datetime(?) AND (? IS NULL OR datetime(date) <= datetime(?, '+1 day', '-1 second'))
      GROUP BY week ORDER BY week`).all(req.user.id, budget.category_id, budget.start_date, budget.end_date, budget.end_date);
    const current = Number(currentSpending.total);
    return res.json(serializeMoney({
      ...budget,
      current_spending: current,
      remaining: Number(budget.amount) - current,
      percent_used: budgetPercentUsed(budget.amount, current),
```

### Mobile filters income categories before budget creation

`mobile/src/screens/budget/BudgetsScreen.tsx:98-102`

```tsx
      const [, categoryResponse] = await Promise.all([
        dispatch(fetchBudgets()).unwrap(),
        api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }),
      ]);
      setCategories(unwrapList(categoryResponse.data).filter((category) => category.type !== 'income'));
```

`mobile/src/screens/budget/BudgetsScreen.tsx:150-163`

```tsx
  const createBudget = async () => {
    const parsedAmount = parsePositiveMoney(amount);
    if (!selectedCategory || parsedAmount === null) {
      showToast({ type: 'error', text1: 'Missing budget details', text2: 'Choose a category and enter an amount.' });
      return;
    }

    try {
      await dispatch(createBudgetThunk({
        category_id: selectedCategory,
        amount: parsedAmount,
        period,
        start_date: new Date(startDate).toISOString(),
        end_date: endDate ? new Date(endDate).toISOString() : null,
```

## 4. Category Type Can Be Changed After Transactions And Budgets Already Reference It

**Status:** IMPORTANT MISSED ITEM  
**Severity:** HIGH  
**Impact:** A user can change a custom category from `expense` to `income` or from `income` to `expense`. Existing transactions and budgets keep the same `category_id`. This can make transaction rows conflict with category metadata and can make budgets appear attached to an income category.

### Category update accepts `type`

`backend/src/routes/categoryRoutes.js:20-25`

```js
const updateRules = [
  idParam,
  body('name').optional().trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('icon').optional({ nullable: true }).isString().isLength({ max: 50 }).withMessage('icon must be up to 50 characters'),
  body('color').optional({ nullable: true }).matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('type').optional().isIn(types).withMessage(`type must be one of: ${types.join(', ')}`),
```

### Controller writes `type` directly and does not inspect references

`backend/src/controllers/categoryController.js:88-104`

```js
function updateCategory(req, res, next) {
  try {
    const oldCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!oldCategory) return res.status(404).json({ error: 'Category not found' });
    const allowed = ['name', 'icon', 'color', 'type'];
    const updates = {};
    for (const field of allowed) if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = field === 'name' ? normalizeCategoryName(req.body[field]) : req.body[field];
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });
    const nextName = Object.prototype.hasOwnProperty.call(updates, 'name') ? updates.name : oldCategory.name;
    const nextType = Object.prototype.hasOwnProperty.call(updates, 'type') ? updates.type : oldCategory.type;
    if (categoryNameExists(req.user.id, nextName, nextType, req.params.id)) return res.status(409).json({ error: 'Category already exists' });
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    let newCategory;
    db.transaction(() => {
      db.prepare(`UPDATE categories SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
      newCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      audit(req, 'CATEGORY_UPDATED', 'category', req.params.id, oldCategory, newCategory);
```

### Budgets and transactions reference category IDs without a type constraint

`backend/database/db.js:169-170`

```js
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
```

`backend/database/db.js:232-233`

```js
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
```

## 5. User Category Delete Hard-Deletes And Silently Nulls Transaction/Budget References

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM/HIGH  
**Impact:** Deleting a user category hard-deletes the category. Because SQLite foreign keys are enabled and `transactions.category_id` / `budgets.category_id` use `ON DELETE SET NULL`, historical transactions and budgets lose the category link. The user route returns only `{ success: true }`, with no count of affected transactions or budgets.

Existing reports mention that category deletion hard-deletes. This missed item is the explicit transaction/budget consequence through enforced foreign keys.

### SQLite foreign keys are enabled

`backend/database/db.js:48-50`

```js
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

### Transaction and budget foreign keys null category IDs on category delete

`backend/database/db.js:169-170`

```js
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
```

`backend/database/db.js:232-233`

```js
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
```

### User category delete performs a hard delete and returns no affected-reference details

`backend/src/controllers/categoryController.js:128-136`

```js
function deleteCategory(req, res, next) {
  try {
    const category = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });
    db.transaction(() => {
      db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
      audit(req, 'CATEGORY_DELETED', 'category', req.params.id, category, null);
    })();
    return res.json({ success: true });
```

### Admin default category delete explicitly clears references first

This differs from user category delete.

`backend/src/controllers/adminController.js:1494-1497`

```js
      clearedTransactionRefs = db.prepare('UPDATE transactions SET category_id = NULL, updated_at = ? WHERE category_id = ?')
        .run(now, req.params.id).changes;
      clearedBudgetRefs = db.prepare('UPDATE budgets SET category_id = NULL, updated_at = ? WHERE category_id = ?')
        .run(now, req.params.id).changes;
```

## 6. Account Create Validator Rejects Negative Opening Balances That Controller Allows

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM  
**Impact:** The controller explicitly parses the initial account balance with `allowNegative: true`, but the route validator rejects negative `balance`. The controller path for negative opening balances is unreachable through the public route.

Existing reports show both snippets separately, but do not identify the contradiction.

### Route validator requires non-negative balance

`backend/src/routes/accountRoutes.js:38-45`

```js
const createRules = [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('type').isIn(validTypes).withMessage(`type must be one of: ${validTypes.join(', ')}`),
  body('currency').trim().isLength({ min: 3, max: 3 }).isAlpha().withMessage('currency must be a 3-letter code'),
  body('color').matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('icon').isString().withMessage('icon must be a string').bail().isLength({ min: 1, max: 50 }).withMessage('icon must be a string up to 50 characters'),
  moneyFormat('balance', { min: 0, message: 'balance must be a non-negative number' }),
```

### Controller allows negative balance

`backend/src/controllers/accountController.js:96-102`

```js
function createAccount(req, res, next) {
  try {
    const initialBalance = amountToCents(req.body.balance || 0, { allowNegative: true });
    // FIX: 9
    const hasOverdraftLimit = Object.prototype.hasOwnProperty.call(req.body, 'overdraft_limit');
    const overdraftLimit = hasOverdraftLimit ? normalizeOverdraftLimit(req.body.overdraft_limit) : null;
    if (overdraftLimit !== null && NON_NEGATIVE_ACCOUNT_TYPES.has(req.body.type) && initialBalance < -overdraftLimit) {
```

## 7. Admin Balance Correction Validator Allows Negative Target Balance, Controller Rejects It

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM  
**Impact:** The admin route uses a signed money validator for `target_balance`, but the controller calls `amountToCents(req.body.target_balance)` without `allowNegative: true`. A negative target balance passes route validation and then fails inside the money parser.

Existing reports document the correction flow and note inactive-account behavior, but not this validation/controller mismatch.

### Route validator accepts signed decimal money

`backend/src/routes/adminRoutes.js:56-63`

```js
const signedDecimalMoney = (chain, field) => chain
  .isFloat()
  .withMessage(`${field} must be a number`)
  .bail()
  .custom((value) => {
    const decimal = String(value);
```

`backend/src/routes/adminRoutes.js:297-302`

```js
router.post('/users/:id/accounts/:accountId/correction', requireConfirmation('balance_correction'), [
  idParam,
  param('accountId').isUUID().withMessage('accountId must be a valid UUID'),
  signedDecimalMoney(body('target_balance').notEmpty(), 'target_balance'),
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.createAccountBalanceCorrection);
```

### Controller parses target balance as non-negative

`backend/src/controllers/adminController.js:1362-1369`

```js
function createAccountBalanceCorrection(req, res, next) {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.accountId, req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const targetBalance = amountToCents(req.body.target_balance);
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'A correction reason of at least 5 characters is required' });
    const derivedBalance = derivedAccountBalance(account.id, account.user_id);
```

`backend/src/utils/money.js:41-61`

```js
function amountToCents(value, { allowZero = true, allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') throw new Error('Amount is required');
  let str = String(value).trim();
  if (!str) throw new Error('Amount is required');
  str = str.replace(/[$,\s]/g, '');
  const negativeParentheses = /^\(.*\)$/.test(str);
  if (negativeParentheses) str = str.slice(1, -1);
  let sign = 1;
  if (str.startsWith('-')) {
    sign = -1;
    str = str.slice(1);
  } else if (str.startsWith('+')) {
    str = str.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error('Amount must be a valid number with up to 2 decimal places');
  }
  if (!allowNegative && sign < 0) {
```

## 8. Mobile Auth Requests Bypass The Central API Client

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM  
**Impact:** Most app API traffic uses the central `api` instance, which attaches authorization headers, blocks mutating requests while offline, and marks development certificate-pinning fallback. `authSlice` uses raw `axios` for login, register, logout, refresh, and `/me`, so those calls bypass the central request/response interceptor behavior. Public auth endpoints are intentionally CSRF-exempt, but the client behavior still diverges from the rest of the app.

Existing reports mention authSlice `axios.post` in limited contexts, but not the full split-brain API-client behavior.

### Central API client behavior

`mobile/src/services/api.ts:43-48`

```ts
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
```

`mobile/src/services/api.ts:64-79`

```ts
api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toLowerCase();
  if (!pinningConfigured && process.env.NODE_ENV !== 'production') {
    config.headers['X-Cert-Pinning-Mode'] = 'development-fallback';
  }
  if (MUTATING_METHODS.has(method) && store.getState().ui.isOnline === false) {
    return Promise.reject(new Error('No internet connection. Changes are disabled while offline.'));
  }

  const { accessToken } = await getTokens();

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});
```

`mobile/src/services/api.ts:82-143`

```ts
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;

    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }
```

```ts
      const response = await axios.post<{ accessToken: string; refreshToken?: string }>(
        `${API_BASE_URL}/api/auth/refresh`,
        { refreshToken },
        { timeout: 10000 }
      );
```

```ts
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      await clearTokens();
      store.dispatch(authActions.logout());
      return Promise.reject(refreshError);
```

### Auth slice uses raw axios for login/register/logout/refresh/me

`mobile/src/store/slices/authSlice.ts:96-116`

```ts
export const loginUser = createAsyncThunk<LoginResponse, LoginCredentials, { rejectValue: ApiErrorPayload }>(
  'auth/loginUser',
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await axios.post<LoginResponse>(`${API_BASE_URL}/api/auth/login`, credentials, { timeout: 10000 });
      await Promise.all([
        saveTokens(response.data.accessToken, response.data.refreshToken),
        saveUser(response.data.user),
      ]);
      return response.data;
    } catch (error) {
```

`mobile/src/store/slices/authSlice.ts:124-132`

```ts
export const logoutUser = createAsyncThunk('auth/logoutUser', async () => {
  const { accessToken, refreshToken } = await getTokens();

  if (accessToken && refreshToken) {
    try {
      await axios.post(
        `${API_BASE_URL}/api/auth/logout`,
        { refreshToken },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
```

`mobile/src/store/slices/authSlice.ts:142-156`

```ts
export const refreshAccessToken = createAsyncThunk<string, void, { rejectValue: ApiErrorPayload }>(
  'auth/refreshAccessToken',
  async (_, { rejectWithValue }) => {
    try {
      const { refreshToken } = await getTokens();
      if (!refreshToken) {
        throw new Error('Missing refresh token');
      }

      const response = await axios.post<{ accessToken: string; refreshToken?: string }>(
        `${API_BASE_URL}/api/auth/refresh`,
        { refreshToken },
        { timeout: 10000 }
      );
      await saveTokens(response.data.accessToken, response.data.refreshToken || refreshToken);
```

`mobile/src/store/slices/authSlice.ts:174-197`

```ts
    try {
      const me = await axios.get<User>(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      await saveUser(me.data);
      return { accessToken, user: me.data };
    } catch (error) {
```

```ts
        const refreshed = await axios.post<{ accessToken: string; refreshToken?: string }>(
          `${API_BASE_URL}/api/auth/refresh`,
          { refreshToken },
          { timeout: 10000 }
        );
        const nextAccessToken = refreshed.data.accessToken;
        const nextRefreshToken = refreshed.data.refreshToken || refreshToken;
        const me = await axios.get<User>(`${API_BASE_URL}/api/auth/me`, {
```

### Public auth endpoints are CSRF-exempt and Bearer requests skip CSRF

`backend/src/middleware/csrfProtection.js:6-13`

```js
const AUTH_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
```

`backend/src/middleware/csrfProtection.js:76-80`

```js
function csrfProtection(req, res, next) {
  const token = setCsrfCookie(req, res);
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();
  if (AUTH_EXEMPT_PATHS.has(req.path)) return next();
  if (hasBearerToken(req)) return next();
```

## 9. Deactivated User Account Leaves Push Tokens, Notifications, And Preferences Behind

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM  
**Impact:** `deleteMyAccount` deactivates/anonymizes the user instead of deleting the `users` row. Because the row remains, `ON DELETE CASCADE` on `push_tokens`, `notifications`, and `notification_preferences` does not run. The function deletes financial rows and revokes refresh tokens, but it does not delete push tokens, notification rows, or notification preferences.

Existing reports mention push tokens should be included in privacy/deletion analysis. This item documents the concrete self-delete path.

### Notification-related tables cascade only on hard user delete

`backend/database/db.js:191-200`

```js
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
```

`backend/database/db.js:203-210`

```js
    CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, token),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

`backend/database/db.js:213-219`

```js
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

### Self-delete does not hard-delete the user row

`backend/src/controllers/authController.js:1026-1054`

```js
async function deleteMyAccount(req, res, next) {
  try {
    if (req.body?.confirmation !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm account deletion' });
    }
```

```js
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
```

### Push send path only checks token rows and preferences, not user active status

`backend/src/utils/pushNotifications.js:18-22`

```js
function preferenceEnabled(userId, type) {
  const key = Object.prototype.hasOwnProperty.call(DEFAULT_PREFS, type) ? type : null;
  if (!key) return true;
  const row = db.prepare('SELECT enabled FROM notification_preferences WHERE user_id = ? AND type = ?').get(userId, key);
  return row ? Boolean(row.enabled) : DEFAULT_PREFS[key];
```

`backend/src/utils/pushNotifications.js:41-45`

```js
  const tokens = db.prepare('SELECT id, token FROM push_tokens WHERE user_id = ?').all(userId);
  if (!tokens.length) return { sent: 0, tickets: [] };

  const messages = tokens.map((row) => ({
    to: row.token,
```

## 10. Mobile CI Test Job Runs TypeScript Typecheck, Not Behavioral Tests

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM  
**Impact:** The GitHub Actions workflow has a `mobile-test` job, but `mobile/package.json` maps `npm test` to `npm run typecheck`. As a result, CI labels the job as tests while running only TypeScript compilation. The `mobile-typecheck` job already runs `npx tsc --noEmit`, so the mobile test job duplicates typechecking.

### Workflow has separate mobile typecheck and mobile test jobs

`.github/workflows/ci.yml:41-53`

```yaml
  mobile-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: mobile/package-lock.json
      - run: npm ci
        working-directory: mobile
      - run: npx tsc --noEmit
        working-directory: mobile
```

`.github/workflows/ci.yml:55-67`

```yaml
  mobile-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: mobile/package-lock.json
      - run: npm ci
        working-directory: mobile
      - run: npm test
        working-directory: mobile
```

### Mobile package maps test to typecheck

`mobile/package.json:5-12`

```json
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "typecheck": "tsc --noEmit",
    "test": "npm run typecheck",
    "lint": "eslint . --ext .ts,.tsx --ignore-pattern node_modules",
```

## 11. Recurring Processor Derives Transaction Type From Category Type And Defaults Null/Missing Category To Expense

**Status:** IMPORTANT MISSED ITEM  
**Severity:** MEDIUM  
**Impact:** `recurring_transactions` has no `type` column. The processor derives type from the joined category. If the category is deleted or missing, the left join produces no category type and the transaction becomes an expense. Because the schema uses `ON DELETE SET NULL` for recurring category deletion, a formerly income recurring rule can become expense after its category is removed.

### Recurring rule schema has no transaction type

`backend/database/db.js:174-188`

```js
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
```

### Processor uses category type and defaults everything else to expense

`backend/src/utils/recurringProcessor.js:26-28`

```js
function transactionTypeForRule(rule) {
  if (rule.category_type === 'income') return 'income';
  return 'expense';
}
```

`backend/src/utils/recurringProcessor.js:63-71`

```js
    SELECT rt.*,
           a.type AS account_type,
           a.balance AS account_balance,
           a.overdraft_limit,
           c.type AS category_type
    FROM recurring_transactions rt
    JOIN users u ON u.id = rt.user_id AND u.is_active = 1
    JOIN accounts a ON a.id = rt.account_id AND a.user_id = rt.user_id AND a.is_active = 1
    LEFT JOIN categories c ON c.id = rt.category_id AND (c.user_id = rt.user_id OR c.user_id IS NULL)
```

## 12. Consolidated Second-Pass Risk Ranking

1. **Recurring UI dead-end (`mobile/src/screens/transactions/AddTransactionScreen.tsx:202-213`, `backend/src/controllers/transactionController.js:195-200`, `backend/src/utils/recurringProcessor.js:63-73`)** - user-facing recurring creation stores flags that the backend scheduler never reads.
2. **Backend category type mismatch (`backend/src/controllers/transactionController.js:62-64`, `backend/src/controllers/transactionController.js:186-199`)** - direct API calls can create financial rows whose transaction type conflicts with category type.
3. **Budget category mismatch (`backend/src/controllers/budgetController.js:18-20`, `backend/src/controllers/budgetController.js:109-121`)** - budgets can target income categories even though budget evaluation counts expenses only.
4. **Mutable category type with existing references (`backend/src/controllers/categoryController.js:88-104`)** - changing category type rewrites metadata under existing transactions and budgets.
5. **Category delete nulls historical references (`backend/src/controllers/categoryController.js:128-136`, `backend/database/db.js:169-170`, `backend/database/db.js:232-233`)** - deleting a category silently turns linked transactions/budgets into uncategorized records.
6. **Self-delete leaves notification/device data (`backend/src/controllers/authController.js:1026-1054`, `backend/database/db.js:191-219`)** - deactivated/anonymized users keep push tokens, notifications, and preferences because cascades do not run.
7. **Admin negative target balance validator/controller mismatch (`backend/src/routes/adminRoutes.js:297-302`, `backend/src/controllers/adminController.js:1362-1369`)** - a route-accepted correction input fails in controller parsing.
8. **Negative opening balance validator/controller mismatch (`backend/src/routes/accountRoutes.js:38-45`, `backend/src/controllers/accountController.js:96-102`)** - controller code for negative initial balances is unreachable through the route.
9. **Auth requests bypass central mobile API client (`mobile/src/store/slices/authSlice.ts:96-197`, `mobile/src/services/api.ts:64-143`)** - auth traffic does not use the same offline, retry, and header behavior as the rest of the app.
10. **Mobile CI “tests” duplicate typecheck (`.github/workflows/ci.yml:41-67`, `mobile/package.json:5-12`)** - CI communicates behavioral test coverage where only TypeScript compilation is running.
