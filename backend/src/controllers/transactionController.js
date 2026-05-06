const crypto = require('crypto');
const { db } = require('../../database/db');
const logger = require('../utils/logger');
const { serializeAuditValue } = require('../utils/audit');
const { clientIp } = require('../utils/clientIp');
const {
  getAccountBalanceSnapshot,
  warnIfAccountBalanceMismatch,
} = require('../utils/accountBalance');
const { getOrCreateDefaultCashAccount } = require('../utils/defaultAccount');
const { sendPushNotification } = require('../utils/pushNotifications');

const MAX_TRANSACTION_AMOUNT = 100000000;
const DEFAULT_TRANSACTION_LIST_LIMIT = 50;
const MAX_TRANSACTION_LIST_LIMIT = 200;
const NON_NEGATIVE_ACCOUNT_TYPES = new Set(['checking', 'savings', 'cash']);

function nowIso() { return new Date().toISOString(); }
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
function audit(req, action, entityType, entityId, oldValue = null, newValue = null) {
  db.prepare(`INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), req.user.id, action, entityType, entityId,
    serializeAuditValue(oldValue),
    serializeAuditValue(newValue),
    clientIp(req), req.get('user-agent') || null, nowIso()
  );
}
function getOwnedAccount(id, userId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(id, userId);
}
function getAllowedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId);
}
function sanitizeText(value) {
  if (typeof value !== 'string') return null;
  const sanitized = value.trim();
  return sanitized || null;
}
function parseTags(tags) {
  if (!tags) return [];
  return Array.isArray(tags) ? tags.map(sanitizeText).filter(Boolean) : [];
}
function getTransferGroupId(transaction) {
  return transaction.transfer_group_id || null;
}
function getTransferDirection(transaction) {
  return transaction.transfer_direction || null;
}

function balanceDelta(transaction) {
  if (transaction.type === 'income') return transaction.amount;
  if (transaction.type === 'expense') return -transaction.amount;
  if (transaction.type === 'transfer') {
    return getTransferDirection(transaction) === 'destination' ? transaction.amount : -transaction.amount;
  }
  return 0;
}

function overdraftLimit(account) {
  if (account?.overdraft_limit === null || account?.overdraft_limit === undefined) return null;
  return Math.max(Number(account.overdraft_limit || 0), 0);
}

function assertTransactionAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TRANSACTION_AMOUNT) {
    throw Object.assign(new Error(`amount must be greater than 0 and no more than ${MAX_TRANSACTION_AMOUNT}`), { statusCode: 400 });
  }
  if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
    throw Object.assign(new Error('amount must be a finite number with no more than 2 decimal places'), { statusCode: 400 });
  }
}

function assertBalanceAllowed(account, delta) {
  if (!account || !NON_NEGATIVE_ACCOUNT_TYPES.has(account.type)) return;
  const limit = overdraftLimit(account);
  if (limit === null) return;
  const nextBalance = Number(account.balance || 0) + delta;
  if (nextBalance < -limit) {
    throw Object.assign(new Error('Transaction would exceed the overdraft limit for this account'), { statusCode: 400 });
  }
}

function updateBalance(accountId, userId, delta) {
  if (!db.inTransaction) {
    logger.warn('Account balance updated outside transaction', { accountId, userId, delta });
  }
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(delta, nowIso(), accountId, userId);
}
function insertTransaction(tx) {
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
}

function getTransactionWithDetails(id, userId) {
  return db.prepare(`SELECT t.*, c.name AS category_name, a.name AS account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ? AND t.admin_deleted_at IS NULL`).get(id, userId);
}

function getTransactionsWithDetails(ids, userId) {
  return ids.map((id) => getTransactionWithDetails(id, userId)).filter(Boolean);
}

function checkAccountConsistency(accountId, userId, source) {
  if (!accountId) return;
  warnIfAccountBalanceMismatch(getAccountBalanceSnapshot(accountId, userId), { source });
}

function notifyBudgetOverspendIfNeeded(userId, transaction) {
  if (transaction.type !== 'expense' || !transaction.category_id) return;
  const budget = db.prepare(`
    SELECT b.id, b.amount, c.name AS category_name,
      COALESCE((SELECT SUM(t.amount) FROM transactions t
        WHERE t.user_id = b.user_id
          AND t.category_id = b.category_id
          AND t.type = 'expense'
          AND datetime(t.date) >= datetime(b.start_date)
          AND (b.end_date IS NULL OR datetime(t.date) <= datetime(b.end_date))), 0) AS spent
    FROM budgets b
    LEFT JOIN categories c ON c.id = b.category_id
    WHERE b.user_id = ?
      AND b.category_id = ?
      AND datetime(?) >= datetime(b.start_date)
      AND (b.end_date IS NULL OR datetime(?) <= datetime(b.end_date))
    ORDER BY b.created_at DESC
    LIMIT 1
  `).get(userId, transaction.category_id, transaction.date, transaction.date);
  if (!budget) return;
  const overBy = Number(budget.spent || 0) - Number(budget.amount || 0);
  if (overBy <= 0) return;
  void sendPushNotification(
    userId,
    `Budget exceeded: ${budget.category_name || 'Category'} is over by ${overBy.toFixed(2)}`,
    `${budget.category_name || 'This budget'} has exceeded its limit.`,
    { type: 'budget_overspend', budgetId: budget.id, overBy }
  ).catch((pushError) => logger.warn('Budget overspend push failed', { userId, error: pushError.message }));
}

function getRelatedTransferTransactions(userId, groupId) {
  return db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ? AND transfer_group_id = ?
      AND admin_deleted_at IS NULL
    ORDER BY created_at ASC
  `).all(userId, groupId);
}

function createTransaction(req, res, next) {
  try {
    const account = req.body.account_id
      ? getOwnedAccount(req.body.account_id, req.user.id)
      : getOrCreateDefaultCashAccount(req.user.id);
    if (!account) return res.status(400).json({ error: 'account_id must belong to the authenticated user' });
    const categoryId = req.body.category_id || null;
    if (categoryId && !getAllowedCategory(categoryId, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    if (req.body.type !== 'transfer' && !categoryId) return res.status(400).json({ error: 'category_id is required' });

    const amount = Number(req.body.amount);
    assertTransactionAmount(amount);
    const transactionDate = validateTransactionDate(req.body.date);
    const createdAt = nowIso();
    const base = {
      id: crypto.randomUUID(), user_id: req.user.id, account_id: account.id, category_id: categoryId,
      type: req.body.type, amount, description: sanitizeText(req.body.description), note: sanitizeText(req.body.note),
      date: transactionDate, recurring: req.body.recurring ? 1 : 0,
      recurring_interval: req.body.recurring_interval || null, receipt_path: req.body.receipt_path || null,
      tags: JSON.stringify(parseTags(req.body.tags)), transfer_group_id: null, transfer_direction: null,
      to_account_id: null, from_account_id: null, created_at: createdAt, updated_at: null,
    };

    const created = [];
    db.transaction(() => {
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
        checkAccountConsistency(account.id, req.user.id, 'createTransfer');
        checkAccountConsistency(toAccount.id, req.user.id, 'createTransfer');
        audit(req, 'TRANSACTION_CREATED', 'transaction', sourceTx.id, null, { source: sourceTx, destination: destTx });
        created.push(sourceTx, destTx);
      } else {
        assertBalanceAllowed(account, balanceDelta(base));
        insertTransaction(base);
        updateBalance(account.id, req.user.id, balanceDelta(base));
        checkAccountConsistency(account.id, req.user.id, 'createTransaction');
        audit(req, 'TRANSACTION_CREATED', 'transaction', base.id, null, base);
        created.push(base);
      }
    })();

    const hydrated = getTransactionsWithDetails(created.map((transaction) => transaction.id), req.user.id);
    created.forEach((transaction) => notifyBudgetOverspendIfNeeded(req.user.id, transaction));
    if (amount >= Number(process.env.LARGE_TRANSACTION_AMOUNT || 1000)) {
      void sendPushNotification(
        req.user.id,
        `Large transaction: ${amount} on ${account.name}`,
        base.description || 'A large transaction was recorded.',
        { type: 'large_transaction', transactionId: created[0]?.id }
      ).catch((pushError) => logger.warn('Large transaction push failed', { userId: req.user.id, error: pushError.message }));
    }
    return res.status(201).json(base.type === 'transfer' ? { transactions: hydrated } : hydrated[0]);
  } catch (error) { return next(error); }
}

function getTransactions(req, res, next) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_TRANSACTION_LIST_LIMIT, 1), MAX_TRANSACTION_LIST_LIMIT);
    const offset = (page - 1) * limit;
    const where = ['t.user_id = ?', 't.admin_deleted_at IS NULL'];
    const params = [req.user.id];
    for (const [key, column] of [['account_id', 't.account_id'], ['category_id', 't.category_id'], ['type', 't.type']]) {
      if (req.query[key]) { where.push(`${column} = ?`); params.push(req.query[key]); }
    }
    if (req.query.start_date) { where.push('t.date >= ?'); params.push(rangeStartIso(req.query.start_date)); }
    if (req.query.end_date) { where.push('t.date <= ?'); params.push(rangeEndIso(req.query.end_date)); }
    if (req.query.min_amount) { where.push('t.amount >= ?'); params.push(Number(req.query.min_amount)); }
    if (req.query.max_amount) { where.push('t.amount <= ?'); params.push(Number(req.query.max_amount)); }
    if (req.query.search) {
      const search = `%${req.query.search.toLowerCase()}%`;
      where.push('(LOWER(COALESCE(t.description, \'\')) LIKE ? OR LOWER(COALESCE(t.note, \'\')) LIKE ? OR LOWER(COALESCE(t.tags, \'\')) LIKE ?)');
      params.push(search, search, search);
    }
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${whereSql}`).get(...params).count;
    const transactions = db.prepare(`SELECT t.*, c.name AS category_name, a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
      WHERE ${whereSql}
      ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return res.json({ data: transactions, pagination: paginationMeta(page, limit, total) });
  } catch (error) { return next(error); }
}

function getTransaction(req, res, next) {
  try {
    const tx = db.prepare(`SELECT t.*, c.name AS category_name, a.name AS account_name FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
      WHERE t.id = ? AND t.user_id = ? AND t.admin_deleted_at IS NULL`).get(req.params.id, req.user.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    return res.json(tx);
  } catch (error) { return next(error); }
}

function updateTransaction(req, res, next) {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'type')) {
      logger.warn('Attempted immutable transaction update', { userId: req.user.id, transactionId: req.params.id });
      audit(req, 'TRANSACTION_IMMUTABLE_UPDATE_ATTEMPTED', 'transaction', req.params.id, null, { type: req.body.type });
      return res.status(400).json({ error: 'type cannot be changed after creation' });
    }
    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
    if (!oldTx) return res.status(404).json({ error: 'Transaction not found' });
    if (req.body.category_id && !getAllowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    const allowed = ['description', 'note', 'category_id', 'date', 'tags', 'receipt_path'];
    const updates = {};
    let nextAmount;
    const amountChanged = Object.prototype.hasOwnProperty.call(req.body, 'amount');
    if (amountChanged) {
      nextAmount = Number(req.body.amount);
      assertTransactionAmount(nextAmount);
    }
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        if (field === 'tags') updates[field] = JSON.stringify(parseTags(req.body[field]));
        else if (field === 'description' || field === 'note') updates[field] = sanitizeText(req.body[field]);
        else updates[field] = req.body[field];
      }
    }
    if (updates.date) updates.date = validateTransactionDate(updates.date);
    if (!Object.keys(updates).length && !amountChanged) return res.status(400).json({ error: 'No allowed fields provided' });
    updates.updated_at = nowIso();
    const accountsToCheck = new Set();

    db.transaction(() => {
      if (amountChanged) {
        if (oldTx.type === 'transfer') {
          const groupId = getTransferGroupId(oldTx);
          if (!groupId) throw Object.assign(new Error('Transfer group is missing; cannot safely update amount.'), { statusCode: 409 });

          const related = getRelatedTransferTransactions(req.user.id, groupId);
          if (related.length !== 2) {
            logger.warn('Transfer amount update blocked because group is incomplete', { userId: req.user.id, transactionId: oldTx.id, transferGroupId: groupId, relatedCount: related.length });
            throw Object.assign(new Error('Transfer group is incomplete; both sides must be present before updating amount.'), { statusCode: 409 });
          }

          for (const item of related) {
            const account = getOwnedAccount(item.account_id, req.user.id);
            if (!account) throw Object.assign(new Error('Transfer account is unavailable'), { statusCode: 409 });
            const delta = balanceDelta({ ...item, amount: nextAmount }) - balanceDelta(item);
            assertBalanceAllowed(account, delta);
          }

          for (const item of related) {
            const delta = balanceDelta({ ...item, amount: nextAmount }) - balanceDelta(item);
            updateBalance(item.account_id, req.user.id, delta);
          }

          db.prepare('UPDATE transactions SET amount = ?, updated_at = ? WHERE user_id = ? AND transfer_group_id = ? AND admin_deleted_at IS NULL')
            .run(nextAmount, updates.updated_at, req.user.id, groupId);
          related.forEach((item) => checkAccountConsistency(item.account_id, req.user.id, 'updateTransferAmount'));
        } else {
          const account = getOwnedAccount(oldTx.account_id, req.user.id);
          if (!account) throw Object.assign(new Error('Transaction account is unavailable'), { statusCode: 409 });
          const delta = balanceDelta({ ...oldTx, amount: nextAmount }) - balanceDelta(oldTx);
          assertBalanceAllowed(account, delta);
          updateBalance(oldTx.account_id, req.user.id, delta);
          updates.amount = nextAmount;
          accountsToCheck.add(oldTx.account_id);
        }
      }

      if (Object.keys(updates).length) {
        const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
        db.prepare(`UPDATE transactions SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
      }

      accountsToCheck.forEach((accountId) => checkAccountConsistency(accountId, req.user.id, 'updateTransactionAmount'));
    })();

    const newTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
    audit(req, 'TRANSACTION_UPDATED', 'transaction', req.params.id, oldTx, newTx);
    return res.json(newTx);
  } catch (error) { return next(error); }
}

function deleteTransaction(req, res, next) {
  try {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    let related = [tx];
    if (tx.type === 'transfer') {
      const groupId = getTransferGroupId(tx);
      if (!groupId) {
        return res.status(409).json({ error: 'Transfer group is missing; cannot safely delete transfer.' });
      } else {
        related = getRelatedTransferTransactions(req.user.id, groupId);
      }
      if (related.length !== 2) {
        logger.warn('Transfer delete blocked because group is incomplete', { userId: req.user.id, transactionId: tx.id, transferGroupId: groupId, relatedCount: related.length });
        return res.status(409).json({ error: 'Transfer group is incomplete; both sides must be present before deletion.' });
      }
    }

    const affectedAccountIds = Array.from(new Set(related.map((item) => item.account_id).filter(Boolean)));
    db.transaction(() => {
      for (const item of related) {
        if (item.account_id) updateBalance(item.account_id, req.user.id, -balanceDelta(item));
        db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(item.id, req.user.id);
      }
      affectedAccountIds.forEach((accountId) => checkAccountConsistency(accountId, req.user.id, 'deleteTransaction'));
      audit(req, 'TRANSACTION_DELETED', 'transaction', req.params.id, related, null);
    })();
    return res.json({ success: true, deleted: related.length });
  } catch (error) { return next(error); }
}

function getTransactionSummary(req, res, next) {
  try {
    const where = ['t.user_id = ?', 't.admin_deleted_at IS NULL'];
    const params = [req.user.id];
    if (req.query.start_date) { where.push('t.date >= ?'); params.push(rangeStartIso(req.query.start_date)); }
    if (req.query.end_date) { where.push('t.date <= ?'); params.push(rangeEndIso(req.query.end_date)); }
    const whereSql = where.join(' AND ');

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS total_expense
      FROM transactions t WHERE ${whereSql}
    `).get(...params);

    const grouped = db.prepare(`
      SELECT c.id AS category_id,
             COALESCE(c.name, 'Uncategorized') AS category_name,
             t.type,
             COALESCE(SUM(t.amount), 0) AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${whereSql} AND t.type != 'transfer'
      GROUP BY c.id, c.name, t.type
      ORDER BY total DESC
    `).all(...params);

    return res.json({
      total_income: totals.total_income,
      total_expense: totals.total_expense,
      net: totals.total_income - totals.total_expense,
      grouped_by_category: grouped,
    });
  } catch (error) { return next(error); }
}

function validateTransactionDate(value) {
  const date = new Date(value);
  const now = new Date();
  const minDate = new Date(now);
  minDate.setFullYear(now.getFullYear() - 50);
  const maxDate = new Date(now);
  maxDate.setFullYear(now.getFullYear() + 5);

  if (date < minDate || date > maxDate) {
    throw Object.assign(new Error('Transaction date must be within the last 50 years and no more than 5 years in the future'), { statusCode: 400 });
  }
  return date.toISOString();
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function uniqueIds(ids) {
  return Array.from(new Set((ids || []).filter(Boolean)));
}

function collectTransactionsForBulkDelete(userId, ids) {
  const requestedIds = uniqueIds(ids);
  const rows = db.prepare(`SELECT * FROM transactions WHERE user_id = ? AND admin_deleted_at IS NULL AND id IN (${placeholders(requestedIds)})`).all(userId, ...requestedIds);
  if (rows.length !== requestedIds.length) {
    throw Object.assign(new Error('One or more transactions were not found'), { statusCode: 404 });
  }

  const relatedById = new Map();
  for (const tx of rows) {
    if (tx.type !== 'transfer') {
      relatedById.set(tx.id, tx);
      continue;
    }

    const groupId = getTransferGroupId(tx);
    if (!groupId) {
      throw Object.assign(new Error('Transfer group is missing; cannot safely delete transfer.'), { statusCode: 409 });
    }
    const related = getRelatedTransferTransactions(userId, groupId);
    if (related.length !== 2) {
      logger.warn('Bulk transfer delete blocked because group is incomplete', { userId, transactionId: tx.id, transferGroupId: groupId, relatedCount: related.length });
      throw Object.assign(new Error('Transfer group is incomplete; both sides must be present before deletion.'), { statusCode: 409 });
    }
    related.forEach((item) => relatedById.set(item.id, item));
  }

  return Array.from(relatedById.values());
}

function bulkDeleteTransactions(req, res, next) {
  try {
    const related = collectTransactionsForBulkDelete(req.user.id, req.body.transaction_ids);
    const affectedAccountIds = Array.from(new Set(related.map((item) => item.account_id).filter(Boolean)));

    db.transaction(() => {
      for (const item of related) {
        if (item.account_id) updateBalance(item.account_id, req.user.id, -balanceDelta(item));
        db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(item.id, req.user.id);
      }
      affectedAccountIds.forEach((accountId) => checkAccountConsistency(accountId, req.user.id, 'bulkDeleteTransactions'));
      audit(req, 'TRANSACTIONS_BULK_DELETED', 'transaction', null, related, null);
    })();

    return res.json({ success: true, deleted: related.length });
  } catch (error) {
    return next(error);
  }
}

function bulkUpdateTransactionCategory(req, res, next) {
  try {
    const ids = uniqueIds(req.body.transaction_ids);
    if (!getAllowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });

    const existing = db.prepare(`SELECT id, category_id FROM transactions WHERE user_id = ? AND admin_deleted_at IS NULL AND id IN (${placeholders(ids)})`).all(req.user.id, ...ids);
    if (existing.length !== ids.length) return res.status(404).json({ error: 'One or more transactions were not found' });

    const updatedAt = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET category_id = ?, updated_at = ? WHERE user_id = ? AND admin_deleted_at IS NULL AND id IN (${placeholders(ids)})`)
        .run(req.body.category_id, updatedAt, req.user.id, ...ids);
      audit(req, 'TRANSACTIONS_BULK_UPDATED', 'transaction', null, existing, { transaction_ids: ids, category_id: req.body.category_id });
    })();

    return res.json({ success: true, updated: ids.length });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createTransaction,
  getTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  bulkDeleteTransactions,
  bulkUpdateTransactionCategory,
  getTransactionSummary,
};

