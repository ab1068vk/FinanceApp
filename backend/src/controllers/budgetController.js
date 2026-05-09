const crypto = require('crypto');
const { db } = require('../../database/db');
const { serializeAuditValue } = require('../utils/audit');
const { clientIp } = require('../utils/clientIp');
const { amountToCents, serializeMoney } = require('../utils/money');
const { pagination, paginationMeta } = require('../utils/pagination');

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
function allowedCategory(id, userId) {
  // FIX: 3
  return db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND is_active = 1').get(id, userId);
}
function validateBudgetPeriodRange(period, startDate, endDate) {
  if (!endDate) return;
  const endOfUtcDay = (date) => new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23,
    59,
    59,
    999
  ));
  const addUtcMonthsEndOfDay = (date, months) => {
    const targetYear = date.getUTCFullYear();
    const targetMonth = date.getUTCMonth() + months;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const targetDay = Math.min(date.getUTCDate(), lastDay);
    return new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999));
  };
  const exclusiveUpperBounds = {
    weekly: endOfUtcDay(new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate() + 7))),
    monthly: addUtcMonthsEndOfDay(startDate, 1),
    yearly: addUtcMonthsEndOfDay(startDate, 12),
  };
  const inclusiveUpperBound = exclusiveUpperBounds[period];

  if (inclusiveUpperBound && endDate > inclusiveUpperBound) {
    throw Object.assign(new Error(`${period} budget date range cannot span more than one ${period === 'weekly' ? 'week' : period === 'monthly' ? 'month' : 'year'}`), { statusCode: 400 });
  }
}

function normalizeBudgetDates(period, startDateValue, endDateValue = null) {
  const startDate = new Date(startDateValue);
  const endDate = endDateValue ? new Date(endDateValue) : null;

  if (Number.isNaN(startDate.getTime())) {
    throw Object.assign(new Error(`Invalid date: ${startDateValue}`), { statusCode: 400 });
  }
  if (endDate && Number.isNaN(endDate.getTime())) {
    throw Object.assign(new Error(`Invalid date: ${endDateValue}`), { statusCode: 400 });
  }
  if (endDate && startDate > endDate) {
    throw Object.assign(new Error('end_date must be after start_date'), { statusCode: 400 });
  }
  validateBudgetPeriodRange(period, startDate, endDate);

  return {
    start_date: startDate.toISOString(),
    end_date: endDate ? endDate.toISOString() : null,
  };
}

function overlappingBudget(userId, categoryId, startDate, endDate, excludeId = null) {
  const params = {
    user_id: userId,
    category_id: categoryId,
    start_date: startDate,
    end_date: endDate || '9999-12-31T23:59:59.999Z',
    exclude_id: excludeId,
  };
  return db.prepare(`
    SELECT id
    FROM budgets
    WHERE user_id = @user_id
      AND category_id = @category_id
      AND (@exclude_id IS NULL OR id != @exclude_id)
      AND datetime(start_date) <= datetime(@end_date)
      AND datetime(COALESCE(end_date, '9999-12-31T23:59:59.999Z')) >= datetime(@start_date)
    LIMIT 1
  `).get(params);
}

function assertNoBudgetOverlap(userId, categoryId, startDate, endDate, excludeId = null) {
  if (overlappingBudget(userId, categoryId, startDate, endDate, excludeId)) {
    throw Object.assign(new Error('Budget date range overlaps an existing budget for this category'), { statusCode: 409 });
  }
}

function budgetPercentUsed(amountValue, currentValue) {
  const amount = Number(amountValue || 0);
  const currentSpending = Number(currentValue || 0);
  if (!Number.isFinite(currentSpending) || !Number.isFinite(amount) || amount === 0) {
    return 0;
  }
  if (amount === 0) return currentSpending > 0 ? 100 : 0;
  return Math.round((currentSpending / amount) * 10000) / 100;
}

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
      audit(req, 'BUDGET_CREATED', 'budget', budget.id, null, budget);
    })();
    return res.status(201).json(serializeMoney(budget));
  } catch (error) { return next(error); }
}

function getBudgets(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const total = db.prepare('SELECT COUNT(*) AS count FROM budgets WHERE user_id = ?').get(req.user.id).count;
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
    }));
    return res.json({ data: serializeMoney(data), pagination: paginationMeta(page, limit, total) });
  } catch (error) { return next(error); }
}

function getBudget(req, res, next) {
  try {
    const budget = db.prepare(`SELECT b.*, c.name AS category_name FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.id = ? AND b.user_id = ?`).get(req.params.id, req.user.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });

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
      weekly_breakdown: breakdown,
    }));
  } catch (error) { return next(error); }
}

function updateBudget(req, res, next) {
  try {
    const oldBudget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!oldBudget) return res.status(404).json({ error: 'Budget not found' });
    if (req.body.category_id && !allowedCategory(req.body.category_id, req.user.id)) return res.status(400).json({ error: 'category_id is invalid' });
    const allowed = ['amount', 'category_id', 'period', 'start_date', 'end_date'];
    const updates = {};
    for (const field of allowed) if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = req.body[field];
    if (Object.prototype.hasOwnProperty.call(updates, 'amount')) updates.amount = amountToCents(updates.amount, { allowZero: false });
    const nextStartDate = Object.prototype.hasOwnProperty.call(updates, 'start_date') ? updates.start_date : oldBudget.start_date;
    const nextEndDate = Object.prototype.hasOwnProperty.call(updates, 'end_date') ? updates.end_date : oldBudget.end_date;
    const nextPeriod = Object.prototype.hasOwnProperty.call(updates, 'period') ? updates.period : oldBudget.period;
    if (Object.prototype.hasOwnProperty.call(updates, 'start_date') || Object.prototype.hasOwnProperty.call(updates, 'end_date') || Object.prototype.hasOwnProperty.call(updates, 'period')) {
      const dates = normalizeBudgetDates(nextPeriod, nextStartDate, nextEndDate);
      if (Object.prototype.hasOwnProperty.call(updates, 'start_date')) updates.start_date = dates.start_date;
      if (Object.prototype.hasOwnProperty.call(updates, 'end_date')) updates.end_date = dates.end_date;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    let newBudget;
    db.transaction(() => {
      assertNoBudgetOverlap(
        req.user.id,
        Object.prototype.hasOwnProperty.call(updates, 'category_id') ? updates.category_id : oldBudget.category_id,
        Object.prototype.hasOwnProperty.call(updates, 'start_date') ? updates.start_date : oldBudget.start_date,
        Object.prototype.hasOwnProperty.call(updates, 'end_date') ? updates.end_date : oldBudget.end_date,
        req.params.id
      );
      db.prepare(`UPDATE budgets SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
      newBudget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      audit(req, 'BUDGET_UPDATED', 'budget', req.params.id, oldBudget, newBudget);
    })();
    return res.json(serializeMoney(newBudget));
  } catch (error) { return next(error); }
}

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

module.exports = { createBudget, getBudgets, getBudget, updateBudget, deleteBudget };
