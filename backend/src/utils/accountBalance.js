const { db } = require('../../database/db');
const logger = require('./logger');

function transferGroupLike(alias) {
  return `${alias}.transfer_group_id IS NOT NULL`;
}

function transferDestinationPredicate(alias) {
  return `${alias}.transfer_direction = 'destination'`;
}

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

function getAccountBalanceSnapshot(accountId, userId) {
  return db.prepare(`SELECT a.id, a.user_id, a.balance, ${accountCurrentBalanceExpr('a')} AS current_balance
    FROM accounts a WHERE a.id = ? AND a.user_id = ?`).get(accountId, userId);
}

function warnIfAccountBalanceMismatch(account, context = {}) {
  if (!account) return;

  const balance = Number(account.balance);
  const currentBalance = Number(account.current_balance);
  if (!Number.isFinite(balance) || !Number.isFinite(currentBalance)) return;

  const difference = balance - currentBalance;
  if (Math.abs(difference) > 0.01) {
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

module.exports = {
  accountCurrentBalanceExpr,
  getAccountBalanceSnapshot,
  transferDestinationPredicate,
  transferGroupLike,
  warnIfAccountBalanceMismatch,
};
