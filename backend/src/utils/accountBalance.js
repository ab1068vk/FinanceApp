const { db } = require('../../database/db');
const logger = require('./logger');
const crypto = require('crypto');

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

function nowIso() {
  return new Date().toISOString();
}

function activeAccountBalanceRows() {
  return db.prepare(`
    SELECT a.id, a.user_id, a.balance, ${accountCurrentBalanceExpr('a')} AS current_balance
    FROM accounts a
    WHERE a.is_active = 1
  `).all();
}

function notifyAdminsOfBalanceDrift(drift) {
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all();
  if (!admins.length) return 0;

  const insertNotification = db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const createdAt = nowIso();
  for (const admin of admins) {
    insertNotification.run(
      crypto.randomUUID(),
      admin.id,
      'account-balance-drift',
      'Account balance drift detected',
      `Account ${drift.account_id} has a stored balance that differs from its transaction-derived balance.`,
      JSON.stringify({
        account_id: drift.account_id,
        affected_user_id: drift.user_id,
        stored_balance: drift.stored_balance,
        derived_balance: drift.derived_balance,
        difference: drift.difference,
        source: drift.source,
        detected_at: drift.detected_at,
      }),
      createdAt
    );
  }
  return admins.length;
}

function flagBalanceDrift(drift) {
  const existing = db.prepare(`
    SELECT *
    FROM account_balance_drifts
    WHERE account_id = ? AND status = 'open'
  `).get(drift.account_id);
  const shouldNotify = !existing
    || Number(existing.stored_balance) !== drift.stored_balance
    || Number(existing.derived_balance) !== drift.derived_balance
    || Number(existing.difference) !== drift.difference;

  db.prepare(`
    INSERT INTO account_balance_drifts (
      id, account_id, user_id, stored_balance, derived_balance, difference,
      status, source, detected_at, repaired_at, updated_at
    )
    VALUES (@id, @account_id, @user_id, @stored_balance, @derived_balance, @difference,
      'open', @source, @detected_at, NULL, @updated_at)
    ON CONFLICT(account_id) WHERE status = 'open' DO UPDATE SET
      user_id = excluded.user_id,
      stored_balance = excluded.stored_balance,
      derived_balance = excluded.derived_balance,
      difference = excluded.difference,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run({
    id: existing?.id || crypto.randomUUID(),
    account_id: drift.account_id,
    user_id: drift.user_id,
    stored_balance: drift.stored_balance,
    derived_balance: drift.derived_balance,
    difference: drift.difference,
    source: drift.source,
    detected_at: drift.detected_at,
    updated_at: drift.updated_at,
  });

  return shouldNotify ? notifyAdminsOfBalanceDrift(drift) : 0;
}

function markBalanceDriftRepaired(accountId, repairedAt) {
  db.prepare(`
    UPDATE account_balance_drifts
    SET status = 'repaired', repaired_at = ?, updated_at = ?
    WHERE account_id = ? AND status = 'open'
  `).run(repairedAt, repairedAt, accountId);
}

function reconcileAccountBalances({ autoRepair = false, maxAutoRepairCents = 0, source = 'manual' } = {}) {
  const maxRepair = Math.max(Number(maxAutoRepairCents) || 0, 0);
  const rows = activeAccountBalanceRows();
  const drifts = [];
  let repaired = 0;
  let notifications = 0;

  db.transaction(() => {
    for (const row of rows) {
      const storedBalance = Number(row.balance);
      const derivedBalance = Number(row.current_balance);
      if (!Number.isFinite(storedBalance) || !Number.isFinite(derivedBalance)) continue;

      const difference = storedBalance - derivedBalance;
      if (Math.abs(difference) === 0) continue;

      const timestamp = nowIso();
      const drift = {
        account_id: row.id,
        user_id: row.user_id,
        stored_balance: storedBalance,
        derived_balance: derivedBalance,
        difference,
        source,
        detected_at: timestamp,
        updated_at: timestamp,
        repaired: false,
      };

      logger.error('Account balance drift detected', drift);
      notifications += flagBalanceDrift(drift);

      const canRepair = autoRepair && Math.abs(difference) <= maxRepair;
      if (canRepair) {
        db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .run(derivedBalance, timestamp, row.id, row.user_id);
        markBalanceDriftRepaired(row.id, timestamp);
        drift.repaired = true;
        repaired += 1;
        logger.error('Account balance drift auto-repaired', drift);
      }

      drifts.push(drift);
    }
  })();

  return {
    checked: rows.length,
    drift_count: drifts.length,
    repaired_count: repaired,
    notification_count: notifications,
    auto_repair: Boolean(autoRepair),
    max_auto_repair_cents: maxRepair,
    drifts,
  };
}

module.exports = {
  accountCurrentBalanceExpr,
  getAccountBalanceSnapshot,
  reconcileAccountBalances,
  transferDestinationPredicate,
  transferGroupLike,
  warnIfAccountBalanceMismatch,
};
