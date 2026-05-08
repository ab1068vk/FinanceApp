const crypto = require('crypto');
const { db } = require('../../database/db');
const logger = require('./logger');
const { sendPushNotification } = require('./pushNotifications');

const NON_NEGATIVE_ACCOUNT_TYPES = new Set(['checking', 'savings', 'cash']);

function nowIso() {
  return new Date().toISOString();
}

function dateOnly(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function addFrequency(dateString, frequency) {
  const date = new Date(`${dateString.slice(0, 10)}T00:00:00.000Z`);
  if (frequency === 'daily') date.setUTCDate(date.getUTCDate() + 1);
  else if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (frequency === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else throw new Error(`Unsupported recurring frequency: ${frequency}`);
  return date.toISOString().slice(0, 10);
}

function transactionTypeForRule(rule) {
  if (rule.category_type === 'income') return 'income';
  return 'expense';
}

function balanceDelta(rule) {
  return transactionTypeForRule(rule) === 'income' ? Number(rule.amount) : -Number(rule.amount);
}

function overdraftLimit(account) {
  if (account.overdraft_limit === null || account.overdraft_limit === undefined) return null;
  return Math.max(Number(account.overdraft_limit || 0), 0);
}

function wouldBreachOverdraft(rule) {
  if (!NON_NEGATIVE_ACCOUNT_TYPES.has(rule.account_type)) return false;
  const limit = overdraftLimit(rule);
  if (limit === null) return false;
  return Number(rule.account_balance || 0) + balanceDelta(rule) < -limit;
}

function createSkipNotification(rule, today, reason) {
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, data_json, created_at)
    VALUES (?, ?, 'recurring-transaction-skipped', ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    rule.user_id,
    'Recurring transaction skipped',
    `Recurring transaction "${rule.description || 'Untitled'}" was skipped because ${reason}.`,
    JSON.stringify({ recurring_transaction_id: rule.id, account_id: rule.account_id, due_date: today, reason }),
    nowIso()
  );
}

function dueRules(today) {
  return db.prepare(`
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
      AND (rt.last_processed_date IS NULL OR rt.last_processed_date < ?)
    ORDER BY rt.next_due_date ASC, rt.created_at ASC
  `).all(today, today);
}

function processRule(rule, today) {
  const nextDueDate = addFrequency(rule.next_due_date, rule.frequency);
  const processedAt = nowIso();

  if (wouldBreachOverdraft(rule)) {
    db.transaction(() => {
      createSkipNotification(rule, today, 'it would exceed the account overdraft limit');
      db.prepare(`
        UPDATE recurring_transactions
        SET last_processed_date = ?, next_due_date = ?
        WHERE id = ?
      `).run(today, nextDueDate, rule.id);
    })();
    logger.warn('Recurring transaction skipped for overdraft limit', {
      ruleId: rule.id,
      userId: rule.user_id,
      accountId: rule.account_id,
      nextDueDate,
    });
    return { status: 'skipped', rule_id: rule.id, next_due_date: nextDueDate };
  }

  const transaction = {
    id: crypto.randomUUID(),
    user_id: rule.user_id,
    account_id: rule.account_id,
    category_id: rule.category_id,
    type: transactionTypeForRule(rule),
    amount: Number(rule.amount),
    description: rule.description,
    note: null,
    date: `${today}T00:00:00.000Z`,
    recurring: 0,
    recurring_interval: null,
    receipt_path: null,
    tags: JSON.stringify(['recurring']),
    transfer_group_id: null,
    transfer_direction: null,
    to_account_id: null,
    from_account_id: null,
    created_at: processedAt,
    updated_at: null,
  };

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
  })();

  logger.info('Recurring transaction processed', {
    ruleId: rule.id,
    transactionId: transaction.id,
    userId: rule.user_id,
    accountId: rule.account_id,
    nextDueDate,
  });
  void sendPushNotification(
    rule.user_id,
    `Recurring payment: ${rule.description || 'Recurring transaction'} ${(Number(rule.amount) / 100).toFixed(2)}`,
    `${rule.description || 'Recurring transaction'} posted to your account.`,
    { type: 'recurring_transaction', transactionId: transaction.id }
  ).catch((pushError) => logger.warn('Recurring transaction push failed', { userId: rule.user_id, error: pushError.message }));
  return { status: 'processed', rule_id: rule.id, transaction_id: transaction.id, next_due_date: nextDueDate };
}

function processRecurringTransactions(runDate = new Date()) {
  const today = dateOnly(runDate);
  const rules = dueRules(today);
  const results = [];

  for (const rule of rules) {
    try {
      results.push(processRule(rule, today));
    } catch (error) {
      logger.error('Recurring transaction rule failed', {
        ruleId: rule.id,
        userId: rule.user_id,
        error: error.message,
      });
      results.push({ status: 'failed', rule_id: rule.id, error: error.message });
    }
  }

  logger.info('Recurring transaction processor completed', {
    runDate: today,
    due: rules.length,
    processed: results.filter((result) => result.status === 'processed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  });
  return results;
}

module.exports = {
  addFrequency,
  processRecurringTransactions,
};
