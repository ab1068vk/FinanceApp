const crypto = require('crypto');
const { db } = require('../../database/db');
const logger = require('../utils/logger');
const { serializeAuditValue } = require('../utils/audit');
const { clientIp } = require('../utils/clientIp');
const { accountCurrentBalanceExpr, warnIfAccountBalanceMismatch } = require('../utils/accountBalance');
const { getOrCreateDefaultCashAccount } = require('../utils/defaultAccount');
const { amountToCents, computeBalanceDelta, serializeMoney } = require('../utils/money');
const { pagination, paginationMeta } = require('../utils/pagination');

const NON_NEGATIVE_ACCOUNT_TYPES = new Set(['checking', 'savings', 'cash']);

function nowIso() { return new Date().toISOString(); }
function audit(req, action, entityType, entityId, oldValue = null, newValue = null) {
  db.prepare(`INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), req.user.id, action, entityType, entityId,
    serializeAuditValue(oldValue),
    serializeAuditValue(newValue),
    clientIp(req), req.get('user-agent') || null, nowIso()
  );
}

const balanceExpr = accountCurrentBalanceExpr('accounts');

function normalizeOverdraftLimit(value) {
  if (value === null || value === '' || value === false) return null;
  return Math.max(amountToCents(value), 0);
}

function updateStoredBalance(accountId, userId, delta) {
  if (!db.inTransaction) {
    logger.warn('Account balance updated outside transaction', { accountId, userId, delta });
  }
  db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(delta, nowIso(), accountId, userId);
}

function transactionsForAccountDelete(accountId, userId) {
  const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
  const transferGroupIds = Array.from(new Set(direct.map((tx) => tx.transfer_group_id).filter(Boolean)));
  if (!transferGroupIds.length) return direct;

  const placeholders = transferGroupIds.map(() => '?').join(', ');
  const transferRows = db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ? AND transfer_group_id IN (${placeholders})
      AND admin_deleted_at IS NULL
  `).all(userId, ...transferGroupIds);

  const byId = new Map();
  [...direct, ...transferRows].forEach((tx) => byId.set(tx.id, tx));
  return Array.from(byId.values());
}

function deleteAccountTransactions(accountId, userId) {
  return db.transaction(() => {
    const transactions = transactionsForAccountDelete(accountId, userId);
    for (const transaction of transactions) {
      updateStoredBalance(transaction.account_id, userId, -computeBalanceDelta(transaction));
      db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(transaction.id, userId);
    }
    return transactions.length;
  })();
}

function moveAccountTransactionsToCash(accountId, userId) {
  return db.transaction(() => {
    const cashAccount = getOrCreateDefaultCashAccount(userId);
    if (!cashAccount) {
      throw Object.assign(new Error('Default cash account is unavailable'), { statusCode: 500 });
    }
    if (cashAccount.id === accountId) {
      throw Object.assign(new Error('The default cash account cannot be attached to itself'), { statusCode: 400 });
    }

    const direct = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').all(accountId, userId);
    const movedDelta = direct.reduce((sum, transaction) => sum + computeBalanceDelta(transaction), 0);
    const updatedAt = nowIso();

    // FIX: 5
    db.prepare('UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
      .run(cashAccount.id, updatedAt, accountId, userId);
    db.prepare('UPDATE transactions SET from_account_id = ?, updated_at = ? WHERE from_account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
      .run(cashAccount.id, updatedAt, accountId, userId);
    db.prepare('UPDATE transactions SET to_account_id = ?, updated_at = ? WHERE to_account_id = ? AND user_id = ? AND admin_deleted_at IS NULL')
      .run(cashAccount.id, updatedAt, accountId, userId);

    updateStoredBalance(accountId, userId, -movedDelta);
    updateStoredBalance(cashAccount.id, userId, movedDelta);

    return { moved: direct.length, cashAccountId: cashAccount.id };
  })();
}

function createAccount(req, res, next) {
  try {
    const initialBalance = amountToCents(req.body.balance || 0, { allowNegative: true });
    // FIX: 9
    const hasOverdraftLimit = Object.prototype.hasOwnProperty.call(req.body, 'overdraft_limit');
    const overdraftLimit = hasOverdraftLimit ? normalizeOverdraftLimit(req.body.overdraft_limit) : null;
    if (overdraftLimit !== null && NON_NEGATIVE_ACCOUNT_TYPES.has(req.body.type) && initialBalance < -overdraftLimit) {
      return res.status(400).json({ error: 'Opening balance exceeds the overdraft limit for this account type' });
    }
    const createdAt = nowIso();
    const account = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      name: req.body.name.trim(),
      type: req.body.type,
      balance: initialBalance,
      overdraft_limit: overdraftLimit,
      currency: req.body.currency.toUpperCase(),
      color: req.body.color,
      icon: req.body.icon || null,
      is_active: 1,
      created_at: createdAt,
      updated_at: null,
    };

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
          createdAt,
          JSON.stringify(['opening-balance']),
          createdAt
        );
      }

      audit(req, 'ACCOUNT_CREATED', 'account', account.id, null, account);
    })();
    return res.status(201).json(serializeMoney(account));
  } catch (error) { return next(error); }
}

function getAccounts(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ? AND is_active = 1').get(req.user.id).count;
    const accounts = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
      FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
    accounts.forEach((account) => warnIfAccountBalanceMismatch(account, { source: 'getAccounts' }));
    return res.json({ data: serializeMoney(accounts), pagination: paginationMeta(page, limit, total) });
  } catch (error) { return next(error); }
}

function getAccount(req, res, next) {
  try {
    const account = db.prepare(`SELECT accounts.*, ${balanceExpr} AS current_balance
      FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1`).get(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    warnIfAccountBalanceMismatch(account, { source: 'getAccount' });
    account.recent_transactions = db.prepare(`SELECT * FROM transactions
      WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 5`).all(req.params.id, req.user.id);
    return res.json(serializeMoney(account));
  } catch (error) { return next(error); }
}

function updateAccount(req, res, next) {
  try {
    const oldAccount = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.id, req.user.id);
    if (!oldAccount) return res.status(404).json({ error: 'Account not found' });

    const allowed = ['name', 'color', 'icon', 'currency', 'overdraft_limit'];
    const updates = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        if (field === 'currency') updates[field] = req.body[field].toUpperCase();
        else if (field === 'overdraft_limit') updates[field] = normalizeOverdraftLimit(req.body[field]);
        else updates[field] = req.body[field];
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'overdraft_limit') && updates.overdraft_limit !== null && NON_NEGATIVE_ACCOUNT_TYPES.has(oldAccount.type)) {
      const current = db.prepare(`SELECT ${balanceExpr} AS current_balance FROM accounts WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
      const balanceToValidate = Number(current?.current_balance || 0);
      if (balanceToValidate < -updates.overdraft_limit) {
        return res.status(400).json({ error: 'Current balance exceeds the requested overdraft limit' });
      }
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });

    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    let newAccount;
    db.transaction(() => {
      db.prepare(`UPDATE accounts SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
      newAccount = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      audit(req, 'ACCOUNT_UPDATED', 'account', req.params.id, oldAccount, newAccount);
    })();
    return res.json(serializeMoney(newAccount));
  } catch (error) { return next(error); }
}

function deleteAccount(req, res, next) {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1').get(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const transactionAction = req.query.transaction_action;
    const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND user_id = ? AND admin_deleted_at IS NULL').get(req.params.id, req.user.id).count;
    if (transactionCount > 0 && !transactionAction) {
      return res.status(400).json({
        error: 'Choose whether to delete this account transactions or move them to Cash',
        transaction_count: transactionCount,
        actions: ['delete', 'cash'],
      });
    }

    let transactionResult = { action: 'none', deleted: 0, moved: 0, cash_account_id: null };
    db.transaction(() => {
      if (transactionAction === 'delete') {
        transactionResult = { action: 'delete', deleted: deleteAccountTransactions(req.params.id, req.user.id), moved: 0, cash_account_id: null };
      } else if (transactionAction === 'cash') {
        const result = moveAccountTransactionsToCash(req.params.id, req.user.id);
        transactionResult = { action: 'cash', deleted: 0, moved: result.moved, cash_account_id: result.cashAccountId };
      }

      db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
      audit(req, 'ACCOUNT_DELETED', 'account', req.params.id, account, { ...account, is_active: 0, transaction_result: transactionResult });
    })();

    return res.json({ success: true, transactions: transactionResult });
  } catch (error) { return next(error); }
}

module.exports = { createAccount, getAccounts, getAccount, updateAccount, deleteAccount };
