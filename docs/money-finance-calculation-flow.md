# Money / Finance Calculation and Data Flow Reference

Generated from the codebase on 2026-05-08. This document traces storage, conversions, balance mutation, formulas, user/admin workflows, interactions, inconsistencies, and gotchas.

## 1. Money Storage

### Storage Unit And Data Types

All persisted money columns are SQLite `INTEGER` cents after migration. API/mobile display values are decimal units such as `12.34`.

```js
// backend/database/db.js:128
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

```js
// backend/database/db.js:144
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

```js
// backend/database/db.js:173
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

```js
// backend/database/db.js:221
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

```js
// backend/database/db.js:299
account_count INTEGER DEFAULT 0,
transaction_count INTEGER DEFAULT 0,
budget_count INTEGER DEFAULT 0,
total_account_balance INTEGER DEFAULT 0,
transaction_total INTEGER DEFAULT 0,
details_json TEXT,
```

### Money Migration To Cents

Existing non-integer money columns are rebuilt and multiplied by 100.

```js
// backend/database/db.js:889
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
```

```js
// backend/database/db.js:948
INSERT INTO transactions_money_next
SELECT id, user_id, account_id, category_id, type, ROUND(COALESCE(amount, 0) * 100),
       description, note, date, recurring, recurring_interval, receipt_path, tags,
       transfer_group_id, transfer_direction, to_account_id, from_account_id,
       admin_deleted_at, admin_deleted_by, admin_delete_reason, created_at, updated_at
FROM transactions;
```

```js
// backend/database/db.js:977
INSERT INTO recurring_transactions_money_next
SELECT id, user_id, account_id, category_id, ROUND(COALESCE(amount, 0) * 100),
       description, frequency, next_due_date, last_processed_date, is_active, created_at
FROM recurring_transactions;
```

```js
// backend/database/db.js:1001
INSERT INTO budgets_money_next
SELECT id, user_id, category_id, ROUND(COALESCE(amount, 0) * 100),
       period, start_date, end_date, created_at, updated_at
FROM budgets;
```

```js
// backend/database/db.js:1031
INSERT INTO deleted_users_money_next
SELECT id, original_user_id, email, full_name, role, was_active, created_at, last_login,
       deleted_at, deleted_by, account_count, transaction_count, budget_count,
       ROUND(COALESCE(total_account_balance, 0) * 100), ROUND(COALESCE(transaction_total, 0) * 100),
       details_json
FROM deleted_users;
```

## 2. Conversion Functions Between Storage And Display

### Backend Request Decimal To Stored Cents

```js
// backend/src/utils/money.js:24
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
  if (abs === 0 && amount !== 0) {
    throw Object.assign(new Error('amount is too small to represent in cents'), { statusCode: 400 });
  }
  return sign * abs;
}
```

### Backend Stored Cents To Decimal Response

```js
// backend/src/utils/money.js:44
function centsToAmount(value) {
  if (value === null || value === undefined) return value;
  const cents = Number(value);
  if (!Number.isFinite(cents)) return value;
  return Math.round(cents) / 100;
}
```

```js
// backend/src/utils/money.js:51
function moneySql(column) {
  return `ROUND(${column} / 100.0, 2)`;
}
```

`moneySql` is exported but has no production usage found by `rg`.

```js
// backend/src/utils/money.js:55
function serializeMoney(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => serializeMoney(item, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => {
    if (MONEY_RESPONSE_KEYS.has(childKey) && typeof childValue === 'number') {
      return [childKey, centsToAmount(childValue)];
    }
    return [childKey, serializeMoney(childValue, childKey)];
  }));
}
```

```js
// backend/src/utils/money.js:1
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
```

### Backend Conversion Call Sites

```js
// backend/src/controllers/accountController.js:98
const initialBalance = amountToCents(req.body.balance || 0);
const hasOverdraftLimit = Object.prototype.hasOwnProperty.call(req.body, 'overdraft_limit');
const overdraftLimit = hasOverdraftLimit ? Math.max(amountToCents(req.body.overdraft_limit || 0), 0) : null;
```

```js
// backend/src/controllers/transactionController.js:193
const amount = amountToCents(req.body.amount, { allowZero: false });
```

```js
// backend/src/controllers/transactionController.js:317
nextAmount = amountToCents(req.body.amount, { allowZero: false });
```

```js
// backend/src/controllers/budgetController.js:98
id: crypto.randomUUID(), user_id: req.user.id, category_id: req.body.category_id, amount: amountToCents(req.body.amount, { allowZero: false }),
```

```js
// backend/src/controllers/adminController.js:1343
const targetBalance = amountToCents(req.body.target_balance);
```

```js
// backend/src/controllers/authController.js:976
return res.status(200).send(JSON.stringify(serializeMoney(payload), null, 2));
```

### Mobile Input Conversion

Mobile stores typed money as strings while editing, parses to decimal numbers, and sends decimal numbers to the API.

```ts
// mobile/src/utils/numberInput.ts:1
export function sanitizeDecimalInput(value: string, maxDecimals = 2): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [integer = '', ...decimalParts] = cleaned.split('.');
  const decimal = decimalParts.join('').slice(0, maxDecimals);
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
  return decimalParts.length ? `${normalizedInteger || '0'}.${decimal}` : normalizedInteger;
}
```

```ts
// mobile/src/utils/numberInput.ts:9
export function parsePositiveMoney(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
```

```ts
// mobile/src/utils/numberInput.ts:15
export function parseNonNegativeMoney(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
```

### Mobile Display Conversion

```ts
// mobile/src/utils/formatters.ts:3
export function formatCurrency(amount = 0, currencyCode = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(Number(amount) || 0);
}
```

```ts
// mobile/src/utils/formatters.ts:20
export function formatPercent(value = 0, total = 0) {
  if (!total) return '0.0%';
  return `${((Number(value) / Number(total)) * 100).toFixed(1)}%`;
}
```

Additional local display formatters duplicate this pattern in:

- `mobile/src/screens/dashboard/DashboardScreen.tsx:49`
- `mobile/src/screens/reports/ReportsScreen.tsx:71`
- `mobile/src/screens/budget/BudgetsScreen.tsx:36`
- `mobile/src/screens/budget/BudgetDetailScreen.tsx:23`
- `mobile/src/screens/accounts/AccountsScreen.tsx:14`
- `mobile/src/screens/accounts/AccountDetailScreen.tsx:23`
- `mobile/src/components/common/AccountCard.tsx:24`
- `mobile/src/components/common/TransactionListItem.tsx:16`
- `mobile/src/components/common/BudgetProgressCard.tsx:11`
- `mobile/src/utils/notifications.ts:40`

## 3. Every Balance Read, Write, Or Modification

### Balance Computed From Transactions

```js
// backend/src/utils/accountBalance.js:12
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

```js
// backend/src/utils/accountBalance.js:27
function getAccountBalanceSnapshot(accountId, userId) {
  return db.prepare(`SELECT a.id, a.user_id, a.balance, ${accountCurrentBalanceExpr('a')} AS current_balance
    FROM accounts a WHERE a.id = ? AND a.user_id = ?`).get(accountId, userId);
}
```

### User Account Reads

```js
// backend/src/controllers/accountController.js:145
const total = db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ? AND is_active = 1').get(req.user.id).count;
const accounts = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
  FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
```

```js
// backend/src/controllers/accountController.js:158
const account = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
  FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1`).get(req.params.id, req.user.id);
```

```js
// backend/src/controllers/accountController.js:190
if (Object.prototype.hasOwnProperty.call(updates, 'overdraft_limit') && NON_NEGATIVE_ACCOUNT_TYPES.has(oldAccount.type)) {
  const current = db.prepare(`SELECT ${balanceExpr} AS current_balance FROM accounts WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
```

### User Balance Writes

```js
// backend/src/controllers/transactionController.js:106
function updateBalance(accountId, userId, delta) {
  if (!db.inTransaction) {
    logger.warn('Account balance updated outside transaction', { accountId, userId, delta });
  }
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
}
```

```js
// backend/src/controllers/accountController.js:35
function updateStoredBalance(accountId, userId, delta) {
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(delta, nowIso(), accountId, userId);
}
```

```js
// backend/src/controllers/accountController.js:201
updates.updated_at = nowIso();
const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
db.prepare(`UPDATE accounts SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
```

### User Account Creation And Deletion Balance Paths

```js
// backend/src/controllers/accountController.js:121
db.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
  VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)`).run(account);
```

```js
// backend/src/controllers/accountController.js:124
if (Math.abs(initialBalance) > 0.001) {
  db.prepare(`INSERT INTO transactions (id, user_id, account_id, category_id, type, amount, description, note, date, recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, NULL, NULL, ?, NULL)`).run(
```

```js
// backend/src/controllers/accountController.js:234
db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
```

### Admin Balance Reads/Writes

```js
// backend/src/controllers/adminController.js:339
function updateStoredBalance(accountId, userId, delta) {
  if (!accountId) return;
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
}
```

```js
// backend/src/controllers/adminController.js:586
total_account_balance: db.prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM accounts WHERE user_id = ? AND is_active = 1').get(req.params.id).total,
```

```js
// backend/src/controllers/adminController.js:653
const accountStats = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(balance), 0) AS balance FROM accounts WHERE user_id = ?').get(user.id);
```

```js
// backend/src/controllers/adminController.js:1271
db.prepare('UPDATE accounts SET is_active = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(isActive, updatedAt, req.params.accountId, req.params.id);
```

```js
// backend/src/controllers/adminController.js:1330
db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.accountId, req.params.id);
```

```js
// backend/src/controllers/adminController.js:1341
const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.accountId, req.params.id);
const targetBalance = amountToCents(req.body.target_balance);
const delta = targetBalance - Number(account.balance || 0);
```

### Recurring Processor Balance Writes

```js
// backend/src/utils/recurringProcessor.js:136
db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
  .run(balanceDelta(rule), processedAt, rule.account_id, rule.user_id);
```

### Default Cash Account Writes

```js
// backend/src/utils/defaultAccount.js:47
db.prepare(`
  INSERT OR IGNORE INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
  VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)
`).run(account);
```

```js
// backend/database/db.js:800
const insertAccount = db.prepare(`
  INSERT OR IGNORE INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
  VALUES (@id, @user_id, @name, @type, @balance, NULL, @currency, @color, @icon, 1, @created_at, NULL)
`);
```

### Account Data Wipe Balance Path

```js
// backend/src/controllers/authController.js:991
db.transaction(() => {
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM budgets WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM accounts WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM categories WHERE user_id = ?').run(req.user.id);
  const defaultAccount = createDefaultCashAccount(req.user.id);
```

## 4. Formulas

### Transaction Delta / Stored Balance Formula

```js
// backend/src/controllers/transactionController.js:73
function balanceDelta(transaction) {
  if (transaction.type === 'income') return transaction.amount;
  if (transaction.type === 'expense') return -transaction.amount;
  if (transaction.type === 'transfer') {
    return getTransferDirection(transaction) === 'destination' ? transaction.amount : -transaction.amount;
  }
  return 0;
}
```

```js
// backend/src/controllers/accountController.js:25
function transactionBalanceDelta(transaction) {
  const amount = Number(transaction.amount || 0);
  if (transaction.type === 'income') return amount;
  if (transaction.type === 'expense') return -amount;
  if (transaction.type === 'transfer') {
    return transaction.transfer_direction === 'destination' ? amount : -amount;
  }
  return 0;
}
```

```js
// backend/src/controllers/adminController.js:331
function transactionDelta(transaction) {
  const amount = Number(transaction.amount || 0);
  if (transaction.type === 'income') return amount;
  if (transaction.type === 'expense') return -amount;
  if (transaction.type === 'transfer') return transaction.transfer_direction === 'destination' ? amount : -amount;
  return 0;
}
```

### Net Worth / Account Balance Formulas

```ts
// mobile/src/screens/dashboard/DashboardScreen.tsx:80
const netWorth = useMemo(
  () => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0),
  [accounts]
);
```

```ts
// mobile/src/screens/accounts/AccountsScreen.tsx:39
const netWorth = accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0);
```

```ts
// mobile/src/screens/dashboard/OverviewScreen.tsx:156
const overview = useMemo(() => {
  const totalAssets = data.accounts
    .filter((account) => account.type !== 'credit')
    .reduce((sum, account) => sum + accountBalance(account), 0);
  const totalCredit = data.accounts
    .filter((account) => account.type === 'credit')
    .reduce((sum, account) => sum + Math.abs(accountBalance(account)), 0);
  const netWorth = data.accounts.reduce((sum, account) => sum + accountBalance(account), 0);
```

### Income / Expense / Net

```js
// backend/src/controllers/transactionController.js:425
const totals = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS total_expense
  FROM transactions t WHERE ${whereSql}
`).get(...params);
```

```js
// backend/src/controllers/transactionController.js:444
return res.json(serializeMoney({
  total_income: totals.total_income,
  total_expense: totals.total_expense,
  net: totals.total_income - totals.total_expense,
  grouped_by_category: grouped,
}));
```

```ts
// mobile/src/screens/reports/ReportsScreen.tsx:270
const totalIncome = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
const totalExpense = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
const net = totalIncome - totalExpense;
```

```js
// backend/src/controllers/adminController.js:1663
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
```

### Transfers

```js
// backend/src/controllers/transactionController.js:207
if (base.type === 'transfer') {
  const toAccount = getOwnedAccount(req.body.to_account_id, req.user.id);
  if (!toAccount) throw Object.assign(new Error('to_account_id must belong to the authenticated user'), { statusCode: 400 });
  if (toAccount.id === account.id) throw Object.assign(new Error('to_account_id must be different from account_id'), { statusCode: 400 });
  assertBalanceAllowed(account, -amount);
  const groupId = crypto.randomUUID();
```

```js
// backend/src/controllers/transactionController.js:227
insertTransaction(sourceTx); insertTransaction(destTx);
updateBalance(account.id, req.user.id, -amount); updateBalance(toAccount.id, req.user.id, amount);
```

```js
// backend/src/controllers/transactionController.js:355
db.prepare('UPDATE transactions SET amount = ?, updated_at = ? WHERE user_id = ? AND transfer_group_id = ? AND admin_deleted_at IS NULL')
  .run(nextAmount, updates.updated_at, req.user.id, groupId);
```

### Budget Spending, Remaining, Percent Used

```js
// backend/src/controllers/budgetController.js:113
const budgets = db.prepare(`SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = b.user_id AND t.category_id = b.category_id
    AND t.type = 'expense' AND t.admin_deleted_at IS NULL AND datetime(t.date) >= datetime(b.start_date)
    AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date, '+1 day', '-1 second'))), 0) AS current_spending
  FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
  WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
const data = budgets.map((budget) => ({
  ...budget,
  remaining: Number(budget.amount) - Number(budget.current_spending),
  percent_used: Number(budget.amount) > 0
    ? (Number(budget.current_spending) / Number(budget.amount)) * 100
    : 0,
}));
```

```js
// backend/src/controllers/budgetController.js:136
const currentSpending = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total
  FROM transactions WHERE user_id = ? AND category_id = ? AND type = 'expense'
  AND admin_deleted_at IS NULL
  AND datetime(date) >= datetime(?) AND (? IS NULL OR datetime(date) <= datetime(?, '+1 day', '-1 second'))`)
  .get(req.user.id, budget.category_id, budget.start_date, budget.end_date, budget.end_date);
```

```js
// backend/src/controllers/budgetController.js:148
return res.json(serializeMoney({
  ...budget,
  current_spending: current,
  remaining: Number(budget.amount) - current,
  percent_used: Number(budget.amount) > 0 ? (current / Number(budget.amount)) * 100 : 0,
  weekly_breakdown: breakdown,
}));
```

```js
// backend/src/controllers/adminController.js:1027
return res.json(serializeMoney({
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
}));
```

### Savings Rate / Budget Used / Average Movement

```ts
// mobile/src/screens/dashboard/OverviewScreen.tsx:163
const netWorth = data.accounts.reduce((sum, account) => sum + accountBalance(account), 0);
const savingsRate = data.summary.total_income > 0 ? (data.summary.net / data.summary.total_income) * 100 : 0;
const largestExpense = expenseGroups(data.summary)[0];
const budgetLimit = data.budgets.reduce((sum, budget) => sum + amountValue(budget.amount), 0);
const budgetSpent = data.budgets.reduce((sum, budget) => sum + amountValue(budget.current_spending), 0);
const budgetUsed = budgetLimit > 0 ? budgetSpent / budgetLimit : 0;
const overBudgetCount = data.budgets.filter((budget) => amountValue(budget.current_spending) > amountValue(budget.amount)).length;
const activeBudgets = data.budgets.filter((budget) => !budget.end_date || new Date(budget.end_date) >= new Date()).length;
```

```ts
// mobile/src/screens/dashboard/OverviewScreen.tsx:184
cashflowAverage: data.transactions.length ? data.summary.net / data.transactions.length : 0,
```

## 5. Transaction Created / Edited / Deleted

### User Creates Transaction

User screen sends decimal amount:

```ts
// mobile/src/screens/transactions/AddTransactionScreen.tsx:199
await dispatch(createTransaction({
  account_id: accountId || undefined,
  to_account_id: type === 'transfer' ? toAccountId : undefined,
  category_id: categoryId || undefined,
  type,
  amount: amountNumber,
  description: description.trim() || undefined,
  note: note.trim() || undefined,
  date: new Date(`${date}T00:00:00.000Z`).toISOString(),
  tags,
  recurring,
  recurring_interval: recurring ? interval : undefined,
})).unwrap();
```

Thunk calls API:

```ts
// mobile/src/store/slices/transactionsSlice.ts:173
export const createTransaction = createAsyncThunk<Transaction | Transaction[], CreateTransactionData, { rejectValue: string }>(
  'transactions/createTransaction',
  async (data, { rejectWithValue }) => {
    try {
      const response = await api.post<Transaction | { transactions: Transaction[] }>('/api/transactions', data);
```

Backend validates, converts, inserts, mutates balances:

```js
// backend/src/controllers/transactionController.js:182
function createTransaction(req, res, next) {
  try {
    const account = req.body.account_id
      ? getOwnedAccount(req.body.account_id, req.user.id)
      : getOrCreateDefaultCashAccount(req.user.id);
```

```js
// backend/src/controllers/transactionController.js:192
assertTransactionAmount(Number(req.body.amount));
const amount = amountToCents(req.body.amount, { allowZero: false });
const transactionDate = validateTransactionDate(req.body.date);
```

```js
// backend/src/controllers/transactionController.js:227
insertTransaction(sourceTx); insertTransaction(destTx);
updateBalance(account.id, req.user.id, -amount); updateBalance(toAccount.id, req.user.id, amount);
```

```js
// backend/src/controllers/transactionController.js:234
assertBalanceAllowed(account, balanceDelta(base));
insertTransaction(base);
updateBalance(account.id, req.user.id, balanceDelta(base));
```

After commit:

```js
// backend/src/controllers/transactionController.js:243
const hydrated = getTransactionsWithDetails(created.map((transaction) => transaction.id), req.user.id);
created.forEach((transaction) => notifyBudgetOverspendIfNeeded(req.user.id, transaction));
```

### User Edits Transaction

```ts
// mobile/src/screens/transactions/EditTransactionScreen.tsx:93
await dispatch(updateTransaction({
  id: transaction.id,
  data: {
    amount: amountNumber,
    description: description.trim() || undefined,
    note: note.trim() || undefined,
    category_id: categoryId || undefined,
    date: new Date(`${date}T00:00:00.000Z`).toISOString(),
    tags,
  },
})).unwrap();
```

```ts
// mobile/src/store/slices/transactionsSlice.ts:201
export const updateTransaction = createAsyncThunk<Transaction, { id: string; data: UpdateTransactionData }, { rejectValue: string }>(
  'transactions/updateTransaction',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await api.put<Transaction>(`/api/transactions/${id}`, data);
```

Backend blocks type changes, converts amount, applies delta:

```js
// backend/src/controllers/transactionController.js:303
if (Object.prototype.hasOwnProperty.call(req.body, 'type')) {
  logger.warn('Attempted immutable transaction update', { userId: req.user.id, transactionId: req.params.id });
  audit(req, 'TRANSACTION_IMMUTABLE_UPDATE_ATTEMPTED', 'transaction', req.params.id, null, { type: req.body.type });
  return res.status(400).json({ error: 'type cannot be changed after creation' });
}
```

```js
// backend/src/controllers/transactionController.js:315
if (amountChanged) {
  assertTransactionAmount(Number(req.body.amount));
  nextAmount = amountToCents(req.body.amount, { allowZero: false });
}
```

Transfer amount edit:

```js
// backend/src/controllers/transactionController.js:337
const related = getRelatedTransferTransactions(req.user.id, groupId);
if (related.length !== 2) {
  logger.warn('Transfer amount update blocked because group is incomplete', { userId: req.user.id, transactionId: oldTx.id, transferGroupId: groupId, relatedCount: related.length });
  throw Object.assign(new Error('Transfer group is incomplete; both sides must be present before updating amount.'), { statusCode: 409 });
}
```

```js
// backend/src/controllers/transactionController.js:350
for (const item of related) {
  const delta = balanceDelta({ ...item, amount: nextAmount }) - balanceDelta(item);
  updateBalance(item.account_id, req.user.id, delta);
}
```

Single transaction amount edit:

```js
// backend/src/controllers/transactionController.js:359
const account = getOwnedAccount(oldTx.account_id, req.user.id);
if (!account) throw Object.assign(new Error('Transaction account is unavailable'), { statusCode: 409 });
const delta = balanceDelta({ ...oldTx, amount: nextAmount }) - balanceDelta(oldTx);
assertBalanceAllowed(account, delta);
updateBalance(oldTx.account_id, req.user.id, delta);
updates.amount = nextAmount;
```

Patch row:

```js
// backend/src/controllers/transactionController.js:369
if (Object.keys(updates).length) {
  const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
  db.prepare(`UPDATE transactions SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
}
```

### User Deletes Transaction

```ts
// mobile/src/screens/transactions/TransactionDetailScreen.tsx:63
await dispatch(deleteTransaction(route.params.id)).unwrap();
dispatch(fetchTransactions({ page: 1, limit: 20 }));
dispatch(refreshAccounts());
```

```ts
// mobile/src/store/slices/transactionsSlice.ts:218
export const deleteTransaction = createAsyncThunk<string, string, { rejectValue: string }>(
  'transactions/deleteTransaction',
  async (id, { rejectWithValue }) => {
    try {
      await api.delete(`/api/transactions/${id}`, { data: { confirm: true } });
```

Backend reverses balance deltas and hard deletes transaction rows:

```js
// backend/src/controllers/transactionController.js:383
function deleteTransaction(req, res, next) {
  try {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
```

```js
// backend/src/controllers/transactionController.js:403
db.transaction(() => {
  for (const item of related) {
    if (item.account_id) updateBalance(item.account_id, req.user.id, -balanceDelta(item));
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(item.id, req.user.id);
  }
```

### Admin Reads / Soft Deletes Transaction

Admin list:

```ts
// mobile/src/screens/admin/AdminTransactionsScreen.tsx:85
const response = await api.get<ListResponse<AdminTransaction>>('/api/admin/transactions', {
  params: {
    limit: 50,
    search: search.trim() || undefined,
    start_date: startDate || undefined,
    end_date: endDate || undefined,
    type: type === 'all' ? undefined : type,
    include_deleted: includeDeleted || undefined,
  },
});
```

Admin soft delete:

```ts
// mobile/src/screens/admin/AdminTransactionsScreen.tsx:105
async function softDeleteSelected() {
  if (!selected) return;
  try {
    await api.delete(`/api/admin/transactions/${selected.id}`, { data: { reason: deleteReason } });
```

Backend admin soft delete reverses balance but does not hard delete rows:

```js
// backend/src/controllers/adminController.js:1218
function adminSoftDeleteTransaction(req, res, next) {
  try {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND admin_deleted_at IS NULL').get(req.params.id);
```

```js
// backend/src/controllers/adminController.js:1229
db.transaction(() => {
  for (const item of related) {
    updateStoredBalance(item.account_id, item.user_id, -transactionDelta(item));
    db.prepare(`
      UPDATE transactions
      SET admin_deleted_at = ?, admin_deleted_by = ?, admin_delete_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(deletedAt, req.user.id, reason, deletedAt, item.id);
```

Admin balance correction creates a transaction and mutates balance:

```js
// backend/src/controllers/adminController.js:1346
const delta = targetBalance - Number(account.balance || 0);
if (Math.abs(delta) < 1) return res.status(400).json({ error: 'Account balance already matches target_balance' });
const now = nowIso();
const correction = {
  id: crypto.randomUUID(),
  user_id: req.params.id,
  account_id: account.id,
  category_id: null,
  type: delta >= 0 ? 'income' : 'expense',
  amount: Math.abs(delta),
```

```js
// backend/src/controllers/adminController.js:1370
db.transaction(() => {
  db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, category_id, type, amount, description, note, date,
      recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction,
      to_account_id, from_account_id, created_at, updated_at
    )
```

```js
// backend/src/controllers/adminController.js:1383
updateStoredBalance(account.id, req.params.id, delta);
```

## 6. Account Created / Deleted / Moved

### User Creates Account

Mobile sends no opening balance in the current screen, only overdraft limit:

```ts
// mobile/src/screens/accounts/AddAccountScreen.tsx:63
const account = await dispatch(createAccount({
  name: name.trim(),
  type,
  currency,
  color,
  icon,
  overdraft_limit: parsedOverdraftLimit,
})).unwrap();
```

```ts
// mobile/src/store/slices/accountsSlice.ts:88
export const createAccount = createAsyncThunk<Account, CreateAccountData, { rejectValue: string }>(
  'accounts/createAccount',
  async (data, { rejectWithValue }) => {
    try {
      const response = await api.post<Account>('/api/accounts', data);
```

Backend creates account and optional opening-balance transaction:

```js
// backend/src/controllers/accountController.js:96
function createAccount(req, res, next) {
  try {
    const initialBalance = amountToCents(req.body.balance || 0);
```

```js
// backend/src/controllers/accountController.js:120
db.transaction(() => {
  db.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, overdraft_limit, currency, color, icon, is_active, created_at, updated_at)
    VALUES (@id, @user_id, @name, @type, @balance, @overdraft_limit, @currency, @color, @icon, @is_active, @created_at, @updated_at)`).run(account);

  if (Math.abs(initialBalance) > 0.001) {
    db.prepare(`INSERT INTO transactions (id, user_id, account_id, category_id, type, amount, description, note, date, recurring, recurring_interval, receipt_path, tags, transfer_group_id, transfer_direction, created_at, updated_at)
```

### User Edits Account

```ts
// mobile/src/screens/accounts/EditAccountScreen.tsx:58
await dispatch(updateAccount({
  id: account.id,
  data: {
    name: name.trim(),
    currency,
    color,
    icon,
    overdraft_limit: parsedOverdraftLimit,
  },
})).unwrap();
```

Backend allows balance updates even though mobile does not currently expose them:

```js
// backend/src/controllers/accountController.js:173
const allowed = ['name', 'color', 'icon', 'currency', 'balance', 'overdraft_limit'];
const updates = {};
for (const field of allowed) {
  if (Object.prototype.hasOwnProperty.call(req.body, field)) {
    if (field === 'currency') updates[field] = req.body[field].toUpperCase();
    else if (field === 'overdraft_limit') updates[field] = Math.max(amountToCents(req.body[field] || 0), 0);
    else if (field === 'balance') updates[field] = amountToCents(req.body[field] || 0);
    else updates[field] = req.body[field];
  }
}
```

### User Deletes Account: Delete Transactions Or Move To Cash

Mobile supplies `transaction_action`:

```ts
// mobile/src/screens/accounts/AccountDetailScreen.tsx:97
const confirmDelete = async (transactionAction: DeleteAccountAction) => {
  if (!account) return;

  try {
    setDeletingAction(transactionAction);
    await dispatch(deleteAccount({ id: account.id, transactionAction })).unwrap();
```

```ts
// mobile/src/store/slices/accountsSlice.ts:129
export const deleteAccount = createAsyncThunk<string, { id: string; transactionAction: DeleteAccountAction }, { rejectValue: string }>(
  'accounts/deleteAccount',
  async ({ id, transactionAction }, { rejectWithValue }) => {
    try {
      await api.delete(`/api/accounts/${id}`, { params: { transaction_action: transactionAction } });
```

Backend demands a choice if active transactions exist:

```js
// backend/src/controllers/accountController.js:215
const transactionAction = req.query.transaction_action;
const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id).count;
if (transactionCount > 0 && !transactionAction) {
  return res.status(400).json({
    error: 'Choose whether to delete this account transactions or move them to Cash',
```

Delete-account transactions path:

```js
// backend/src/controllers/accountController.js:57
function deleteAccountTransactions(accountId, userId) {
  return db.transaction(() => {
    const transactions = transactionsForAccountDelete(accountId, userId);
    for (const transaction of transactions) {
      updateStoredBalance(transaction.account_id, userId, -transactionBalanceDelta(transaction));
      db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(transaction.id, userId);
    }
```

Move-to-cash path:

```js
// backend/src/controllers/accountController.js:78
const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
const movedDelta = direct.reduce((sum, transaction) => sum + transactionBalanceDelta(transaction), 0);
const updatedAt = nowIso();

db.prepare('UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ?')
  .run(cashAccount.id, updatedAt, accountId, userId);
db.prepare('UPDATE transactions SET from_account_id = ?, updated_at = ? WHERE from_account_id = ? AND user_id = ?')
  .run(cashAccount.id, updatedAt, accountId, userId);
db.prepare('UPDATE transactions SET to_account_id = ?, updated_at = ? WHERE to_account_id = ? AND user_id = ?')
  .run(cashAccount.id, updatedAt, accountId, userId);

updateStoredBalance(accountId, userId, -movedDelta);
updateStoredBalance(cashAccount.id, userId, movedDelta);
```

Finally soft-deactivate account:

```js
// backend/src/controllers/accountController.js:234
db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
```

### Admin Deletes Or Moves User Account

```ts
// mobile/src/screens/admin/UserDetailScreen.tsx:271
await api.delete(`/api/admin/users/${id}/accounts/${selectedAccountForDelete.id}`, {
  data: {
    reason: accountDeleteReason.trim(),
    transaction_action: accountTransactionAction,
  },
});
```

Backend defaults admin account deletion with transactions to `cash`:

```js
// backend/src/controllers/adminController.js:1291
const transactionAction = req.body.transaction_action || 'cash';
if (!['cash', 'delete'].includes(transactionAction)) {
  return res.status(400).json({ error: 'transaction_action must be cash or delete' });
}
```

Admin path hard-deletes the account after optional transaction move/delete:

```js
// backend/src/controllers/adminController.js:1300
db.transaction(() => {
  if (transactionCount > 0 && transactionAction === 'delete') {
    transactionResult = { action: 'delete', deleted: deleteAccountTransactions(req.params.accountId, req.params.id), moved: 0, cash_account_id: null };
  } else if (transactionCount > 0) {
    const result = moveAccountTransactionsToCash(req.params.accountId, req.params.id);
    transactionResult = { action: 'cash', deleted: 0, moved: result.moved, cash_account_id: result.cashAccountId };
  }
```

```js
// backend/src/controllers/adminController.js:1330
db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.accountId, req.params.id);
```

Admin can also close/reactivate without balance changes:

```js
// backend/src/controllers/adminController.js:1270
db.transaction(() => {
  db.prepare('UPDATE accounts SET is_active = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(isActive, updatedAt, req.params.accountId, req.params.id);
```

## 7. Budget Created / Evaluated / Deleted

### User Creates Budget

```ts
// mobile/src/screens/budget/BudgetsScreen.tsx:150
const createBudget = async () => {
  const parsedAmount = parsePositiveMoney(amount);
  if (!selectedCategory || parsedAmount === null) {
    showToast({ type: 'error', text1: 'Missing budget details', text2: 'Choose a category and enter an amount.' });
    return;
  }
```

```ts
// mobile/src/screens/budget/BudgetsScreen.tsx:158
await dispatch(createBudgetThunk({
  category_id: selectedCategory,
  amount: parsedAmount,
  period,
  start_date: new Date(startDate).toISOString(),
  end_date: endDate ? new Date(endDate).toISOString() : null,
})).unwrap();
```

```ts
// mobile/src/store/slices/budgetsSlice.ts:75
export const createBudget = createAsyncThunk<Budget, CreateBudgetData, { rejectValue: string }>(
  'budgets/createBudget',
  async (data, { rejectWithValue }) => {
    try {
      const response = await api.post<Budget>('/api/budgets', data);
```

Backend creates budget:

```js
// backend/src/controllers/budgetController.js:92
function createBudget(req, res, next) {
  try {
    if (!allowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    const dates = normalizeBudgetDates(req.body.period, req.body.start_date, req.body.end_date);
    assertNoBudgetOverlap(req.user.id, req.body.category_id, dates.start_date, dates.end_date);
```

```js
// backend/src/controllers/budgetController.js:97
const budget = {
  id: crypto.randomUUID(), user_id: req.user.id, category_id: req.body.category_id, amount: amountToCents(req.body.amount, { allowZero: false }),
  period: req.body.period, start_date: dates.start_date, end_date: dates.end_date,
  created_at: nowIso(), updated_at: null,
};
db.prepare(`INSERT INTO budgets (id, user_id, category_id, amount, period, start_date, end_date, created_at, updated_at)
  VALUES (@id, @user_id, @category_id, @amount, @period, @start_date, @end_date, @created_at, @updated_at)`).run(budget);
```

### Budget Evaluated

User budget list:

```js
// backend/src/controllers/budgetController.js:112
const total = db.prepare('SELECT COUNT(*) AS count FROM budgets WHERE user_id = ?').get(req.user.id).count;
const budgets = db.prepare(`SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = b.user_id AND t.category_id = b.category_id
```

User budget detail:

```js
// backend/src/controllers/budgetController.js:142
const breakdown = db.prepare(`SELECT strftime('%Y-W%W', date) AS week, COALESCE(SUM(amount), 0) AS spending
  FROM transactions WHERE user_id = ? AND category_id = ? AND type = 'expense'
  AND admin_deleted_at IS NULL
  AND datetime(date) >= datetime(?) AND (? IS NULL OR datetime(date) <= datetime(?, '+1 day', '-1 second'))
  GROUP BY week ORDER BY week`).all(req.user.id, budget.category_id, budget.start_date, budget.end_date, budget.end_date);
```

Mobile budget screen also recomputes aggregate display values from API values:

```ts
// mobile/src/screens/budget/BudgetsScreen.tsx:119
const totalBudgeted = activeBudgets.reduce((sum, budget) => sum + Number(budget.amount || 0), 0);
const totalSpent = activeBudgets.reduce((sum, budget) => sum + Number(budget.current_spending || 0), 0);
const remaining = totalBudgeted - totalSpent;
const totalRatio = totalBudgeted > 0 ? totalSpent / totalBudgeted : 0;
```

Budget overspend notification on transaction creation:

```js
// backend/src/controllers/transactionController.js:142
function notifyBudgetOverspendIfNeeded(userId, transaction) {
  if (transaction.type !== 'expense' || !transaction.category_id) return;
  const budget = db.prepare(`
    SELECT b.id, b.amount, c.name AS category_name,
      COALESCE((SELECT SUM(t.amount) FROM transactions t
```

```js
// backend/src/controllers/transactionController.js:162
const overBy = Number(budget.spent || 0) - Number(budget.amount || 0);
if (overBy <= 0) return;
```

### User Updates / Deletes Budget

```js
// backend/src/controllers/budgetController.js:158
function updateBudget(req, res, next) {
  try {
    const oldBudget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
```

```js
// backend/src/controllers/budgetController.js:166
if (Object.prototype.hasOwnProperty.call(updates, 'amount')) updates.amount = amountToCents(updates.amount, { allowZero: false });
```

```js
// backend/src/controllers/budgetController.js:184
const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
db.prepare(`UPDATE budgets SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
```

```js
// backend/src/controllers/budgetController.js:192
function deleteBudget(req, res, next) {
  try {
    const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
```

### Admin Budget Evaluation

Admin does not have direct budget create/update/delete endpoints. It evaluates budget performance:

```ts
// mobile/src/store/slices/adminSlice.ts:325
export const fetchUserBudgetPerformance = createAsyncThunk<BudgetPerformance[], string, { rejectValue: string }>('admin/fetchUserBudgetPerformance', async (id, { rejectWithValue }) => {
  try {
    const response = await api.get<{ data: BudgetPerformance[] }>(`/api/admin/users/${id}/budget-performance`);
```

```js
// backend/src/controllers/adminController.js:1016
const rows = db.prepare(`
  SELECT b.*, c.name AS category_name, c.color AS category_color,
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = b.user_id AND t.category_id = b.category_id
      AND t.type = 'expense' AND t.admin_deleted_at IS NULL AND datetime(t.date) >= datetime(b.start_date)
      AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date, '+1 day', '-1 second'))), 0) AS current_spending
  FROM budgets b
```

## 8. Interaction / Conflict Points

### Stored Balance vs Computed Current Balance

Stored `accounts.balance` is mutated during transactions, but `current_balance` is recomputed from transactions.

```js
// backend/src/utils/accountBalance.js:39
const difference = balance - currentBalance;
if (Math.abs(difference) > 0.01) {
  logger.warn('Account balance mismatch', {
    accountId: account.id,
    userId: account.user_id,
    balance,
    current_balance: currentBalance,
    difference,
```

Conflict: If `accounts.balance` is manually updated via account update, existing transactions are not adjusted.

```js
// backend/src/controllers/accountController.js:173
const allowed = ['name', 'color', 'icon', 'currency', 'balance', 'overdraft_limit'];
```

### Transfers Are Two Transaction Rows

Conflict: delete/update refuses incomplete transfer groups for user actions, but admin soft-delete only groups if `transfer_group_id` exists.

```js
// backend/src/controllers/transactionController.js:337
const related = getRelatedTransferTransactions(req.user.id, groupId);
if (related.length !== 2) {
  logger.warn('Transfer amount update blocked because group is incomplete', { userId: req.user.id, transactionId: oldTx.id, transferGroupId: groupId, relatedCount: related.length });
```

```js
// backend/src/controllers/adminController.js:1224
let related = [tx];
if (tx.type === 'transfer' && tx.transfer_group_id) {
  related = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND transfer_group_id = ? AND admin_deleted_at IS NULL').all(tx.user_id, tx.transfer_group_id);
}
```

### Budgets Depend On Non-Deleted Expense Transactions

Any transaction delete/soft-delete can reduce budget spending.

```js
// backend/src/controllers/budgetController.js:114
COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = b.user_id AND t.category_id = b.category_id
  AND t.type = 'expense' AND t.admin_deleted_at IS NULL AND datetime(t.date) >= datetime(b.start_date)
```

### Account Delete Can Delete Or Move Transfer Counterparts

`transactionsForAccountDelete` expands direct account transactions to include related transfer rows from other accounts.

```js
// backend/src/controllers/accountController.js:40
function transactionsForAccountDelete(accountId, userId) {
  const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
  const transferGroupIds = Array.from(new Set(direct.map((tx) => tx.transfer_group_id).filter(Boolean)));
  if (!transferGroupIds.length) return direct;
```

### Default Cash Creation Can Affect Account Deletion / No Account Transactions

```js
// backend/src/controllers/transactionController.js:184
const account = req.body.account_id
  ? getOwnedAccount(req.body.account_id, req.user.id)
  : getOrCreateDefaultCashAccount(req.user.id);
```

```js
// backend/src/controllers/accountController.js:70
const cashAccount = getOrCreateDefaultCashAccount(userId);
if (!cashAccount) {
  throw Object.assign(new Error('Default cash account is unavailable'), { statusCode: 500 });
}
```

## 9. Inconsistent / Duplicated / Context-Dependent Data Paths

### User Delete Is Hard Delete; Admin Transaction Delete Is Soft Delete

```js
// backend/src/controllers/transactionController.js:405
if (item.account_id) updateBalance(item.account_id, req.user.id, -balanceDelta(item));
db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(item.id, req.user.id);
```

```js
// backend/src/controllers/adminController.js:1232
db.prepare(`
  UPDATE transactions
  SET admin_deleted_at = ?, admin_deleted_by = ?, admin_delete_reason = ?, updated_at = ?
  WHERE id = ?
`).run(deletedAt, req.user.id, reason, deletedAt, item.id);
```

### User Account Delete Soft-Deactivates; Admin Account Delete Hard-Deletes

```js
// backend/src/controllers/accountController.js:234
db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
```

```js
// backend/src/controllers/adminController.js:1330
db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.accountId, req.params.id);
```

### Admin User Summary Uses Stored Balance, Not Computed Current Balance

```js
// backend/src/controllers/adminController.js:586
total_account_balance: db.prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM accounts WHERE user_id = ? AND is_active = 1').get(req.params.id).total,
```

User account list exposes both stored and computed:

```js
// backend/src/controllers/accountController.js:149
const accounts = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
  FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
```

### Admin Reports Include Inactive Users And Deleted Users Differently

Admin dashboard transaction total includes all transactions, including admin-deleted rows:

```js
// backend/src/controllers/adminController.js:451
const transactionTotals = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS sum FROM transactions').get();
```

Advanced reports exclude admin-deleted rows:

```js
// backend/src/controllers/adminController.js:1668
FROM transactions
WHERE admin_deleted_at IS NULL
```

### Transfer Display In TransactionListItem Shows Transfers As Expenses

```ts
// mobile/src/components/common/TransactionListItem.tsx:27
const isIncome = transaction.type === 'income';
const color = isIncome ? theme.colors.success : theme.colors.danger;
```

```ts
// mobile/src/components/common/TransactionListItem.tsx:50
<Text style={[styles.amount, { color }]}>{isIncome ? '+' : '-'}{formatCurrency(transaction.amount)}</Text>
```

### Mobile Account Create Does Not Send `balance`

Backend supports opening-balance transactions; the current add-account screen only sends overdraft limit.

```ts
// mobile/src/screens/accounts/AddAccountScreen.tsx:63
const account = await dispatch(createAccount({
  name: name.trim(),
  type,
  currency,
  color,
  icon,
  overdraft_limit: parsedOverdraftLimit,
})).unwrap();
```

```js
// backend/src/controllers/accountController.js:98
const initialBalance = amountToCents(req.body.balance || 0);
```

### Backend Account Routes Disallow Negative Balances, But Controller Has Overdraft Logic

Route validation:

```js
// backend/src/routes/accountRoutes.js:31
moneyFormat('balance', { min: 0, message: 'balance must be a non-negative number' }),
moneyFormat('overdraft_limit', { min: 0, message: 'overdraft_limit must be a non-negative number' }),
```

Controller logic allows checking/savings/cash balances down to `-overdraft_limit` if it ever receives a negative value:

```js
// backend/src/controllers/accountController.js:101
if (hasOverdraftLimit && NON_NEGATIVE_ACCOUNT_TYPES.has(req.body.type) && initialBalance < -overdraftLimit) {
  return res.status(400).json({ error: 'Opening balance exceeds the overdraft limit for this account type' });
}
```

### Budget End-Date Filtering Differs In Overspend Notification

Budget list/detail include the whole end day:

```js
// backend/src/controllers/budgetController.js:116
AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date, '+1 day', '-1 second'))), 0) AS current_spending
```

Overspend notification does not add `+1 day -1 second`:

```js
// backend/src/controllers/transactionController.js:151
AND datetime(t.date) >= datetime(b.start_date)
AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date))), 0) AS spent
```

### Recurring Processor Amount Already Assumes Cents

Recurring rows store `amount INTEGER` cents; processor inserts `Number(rule.amount)` directly and logs/pushes with `toFixed(2)` without cents conversion.

```js
// backend/src/utils/recurringProcessor.js:107
amount: Number(rule.amount),
```

```js
// backend/src/utils/recurringProcessor.js:154
`Recurring payment: ${rule.description || 'Recurring transaction'} ${Number(rule.amount).toFixed(2)}`,
```

## 10. Main Gotchas

1. `accounts.balance` is stored and mutated, while `current_balance` is recalculated from transactions. Mismatches are only logged.

```js
// backend/src/utils/accountBalance.js:40
if (Math.abs(difference) > 0.01) {
  logger.warn('Account balance mismatch', {
```

2. Direct account balance edits can desynchronize transaction-derived balance.

```js
// backend/src/controllers/accountController.js:201
const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
db.prepare(`UPDATE accounts SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
```

3. Admin soft-deleted transactions remain in the table. User transaction lists exclude them, but admin can include them, and some admin aggregate endpoints include all rows.

```js
// backend/src/controllers/adminController.js:1166
if (req.query.admin_deleted === 'true') where.push('t.admin_deleted_at IS NOT NULL');
else if (req.query.admin_deleted === 'false') where.push('t.admin_deleted_at IS NULL');
else if (req.query.include_deleted !== 'true') where.push('t.admin_deleted_at IS NULL');
```

4. Admin user hard delete archives money totals using raw stored sums.

```js
// backend/src/controllers/adminController.js:815
account_count: archive.summary.account_count,
transaction_count: archive.summary.transaction_count,
budget_count: archive.summary.budget_count,
total_account_balance: archive.summary.total_account_balance,
transaction_total: archive.summary.transaction_total,
```

5. User-side data deletion removes all finance rows and recreates only a default cash account.

```js
// backend/src/controllers/authController.js:991
db.transaction(() => {
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM budgets WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM accounts WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM categories WHERE user_id = ?').run(req.user.id);
  const defaultAccount = createDefaultCashAccount(req.user.id);
```

6. Audit serialization redacts money values, so audit logs do not preserve amounts in readable form.

```js
// backend/src/utils/audit.js:1
const SENSITIVE_KEY_PATTERN = /(password|passcode|token|secret|authorization|cookie|hash|jwt)/i;
const PRIVATE_TEXT_KEYS = new Set(['description', 'note', 'receipt_path', 'tags', 'full_name']);
const MONEY_KEYS = new Set(['amount', 'balance', 'current_balance', 'transaction_total', 'total_volume']);
```

```js
// backend/src/utils/audit.js:21
if (MONEY_KEYS.has(normalizedKey)) return '[REDACTED_AMOUNT]';
```

7. Offline mobile optimistic records keep decimal display amounts and may not update related account/budget state until sync/reload.

```ts
// mobile/src/store/slices/transactionsSlice.ts:184
if (isNetworkError(error)) {
  await enqueue({ method: 'POST', url: '/api/transactions', data, description: 'Create transaction' });
  showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
  return {
    ...data,
```

8. User and admin account deletion differ: user soft-deactivates accounts; admin hard-deletes accounts.

```js
// backend/src/controllers/accountController.js:234
db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
```

```js
// backend/src/controllers/adminController.js:1330
db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.accountId, req.params.id);
```

9. The mobile budget UI recomputes total budget use for the visible month range from the API budget totals, but those API totals are for each budget's stored start/end range, not necessarily the currently selected calendar month.

```ts
// mobile/src/screens/budget/BudgetsScreen.tsx:93
const activeBudgets = useMemo(() => budgets.filter((budget) => isBudgetActiveForRange(budget, start, end)), [budgets, start, end]);
```

```ts
// mobile/src/screens/budget/BudgetsScreen.tsx:119
const totalBudgeted = activeBudgets.reduce((sum, budget) => sum + Number(budget.amount || 0), 0);
const totalSpent = activeBudgets.reduce((sum, budget) => sum + Number(budget.current_spending || 0), 0);
```

10. Transfer list display can make transfers look like expenses because only `income` is treated as positive.

```ts
// mobile/src/components/common/TransactionListItem.tsx:50
<Text style={[styles.amount, { color }]}>{isIncome ? '+' : '-'}{formatCurrency(transaction.amount)}</Text>
```

