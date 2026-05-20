const express = require('express');
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const net = require('net');
const adminController = require('../controllers/adminController');
const { requireAuth, requireAdmin, requireAdminScope } = require('../middleware/auth');
const { validate } = require('../middleware/validateRequest');
const { assertSafeWebhookUrl } = require('../utils/urlSafety');

const router = express.Router();
const roles = ['user', 'admin'];
const transactionTypes = ['income', 'expense', 'transfer'];
const bulkUserActions = ['activate', 'deactivate', 'force_password_reset'];
const categoryTypes = ['income', 'expense'];
const confirmationTokens = new Map();

function requireConfirmation(action) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const provided = req.body?.confirmation_token || req.get('x-confirmation-token');
    const key = `${req.user.id}:${action}:${provided}`;
    const record = provided ? confirmationTokens.get(key) : null;
    if (record && record.expiresAt > Date.now()) {
      confirmationTokens.delete(key);
      return next();
    }

    const token = crypto.randomBytes(24).toString('hex');
    confirmationTokens.set(`${req.user.id}:${action}:${token}`, { expiresAt: Date.now() + 60 * 1000 });
    return res.status(202).json({
      requires_confirmation: true,
      confirmation_token: token,
      expires_in_seconds: 60,
      action,
    });
  };
}

const isIsoDate = (value) => !Number.isNaN(Date.parse(value));
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');
const decimalMoney = (chain, field) => chain
  .isFloat({ min: 0 })
  .withMessage(`${field} must be a non-negative number`)
  .bail()
  .custom((value) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error(`${field} must have at most 2 decimal places`);
    }
    return true;
  });
const signedDecimalMoney = (chain, field) => chain
  .isFloat()
  .withMessage(`${field} must be a number`)
  .bail()
  .custom((value) => {
    if (!/^-?\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error(`${field} must have at most 2 decimal places`);
    }
    return true;
  });
const paging = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be between 1 and 200'),
  query('page_size').optional().isInt({ min: 1, max: 200 }).withMessage('page_size must be between 1 and 200'),
];
const exportPaging = [
  query('limit').optional().isInt({ min: 1, max: 50000 }).withMessage('limit must be between 1 and 50000'),
  query('cursor').optional().isString().isLength({ max: 1000 }).withMessage('cursor must be up to 1000 characters'),
];
const transactionFilters = [
  query('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
  query('account_id').optional().isUUID().withMessage('account_id must be a valid UUID'),
  query('category_id').optional().isUUID().withMessage('category_id must be a valid UUID'),
  query('type').optional().isIn(transactionTypes).withMessage(`type must be one of: ${transactionTypes.join(', ')}`),
  query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
  query('date_from').optional().custom(isIsoDate).withMessage('date_from must be a valid ISO date'),
  query('date_to').optional().custom(isIsoDate).withMessage('date_to must be a valid ISO date'),
  decimalMoney(query('min_amount').optional(), 'min_amount'),
  decimalMoney(query('max_amount').optional(), 'max_amount'),
  query('include_deleted').optional().isBoolean().withMessage('include_deleted must be boolean'),
  query('admin_deleted').optional().isBoolean().withMessage('admin_deleted must be boolean'),
  query('search').optional().isString().isLength({ max: 100 }).withMessage('search must be up to 100 characters'),
  ...paging,
];
const userTransactionFilters = [
  // user_id query is intentionally not supported here; use path :id
  query('account_id').optional().isUUID().withMessage('account_id must be a valid UUID'),
  query('category_id').optional().isUUID().withMessage('category_id must be a valid UUID'),
  query('type').optional().isIn(transactionTypes).withMessage(`type must be one of: ${transactionTypes.join(', ')}`),
  query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
  query('date_from').optional().custom(isIsoDate).withMessage('date_from must be a valid ISO date'),
  query('date_to').optional().custom(isIsoDate).withMessage('date_to must be a valid ISO date'),
  decimalMoney(query('min_amount').optional(), 'min_amount'),
  decimalMoney(query('max_amount').optional(), 'max_amount'),
  query('include_deleted').optional().isBoolean().withMessage('include_deleted must be boolean'),
  query('admin_deleted').optional().isBoolean().withMessage('admin_deleted must be boolean'),
  query('search').optional().isString().isLength({ max: 100 }).withMessage('search must be up to 100 characters'),
  ...paging,
];
const optionalUrl = (value) => value === '' || /^https?:\/\//i.test(String(value || ''));
function isIpOrCidr(value) {
  const raw = String(value || '');
  const [address, prefix, extra] = raw.split('/');
  if (extra !== undefined) return false;
  const version = net.isIP(address);
  if (!version) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const prefixNumber = Number(prefix);
  return version === 4 ? prefixNumber >= 0 && prefixNumber <= 32 : prefixNumber >= 0 && prefixNumber <= 128;
}
const systemConfigRules = [
  body('max_accounts_per_user').optional().isInt({ min: 1, max: 1000 }).withMessage('max_accounts_per_user must be 1-1000').toInt(),
  body('default_currency')
    .optional()
    .isString().trim().matches(/^[A-Za-z]{3}$/).withMessage('default_currency must be a 3-letter currency code')
    .customSanitizer((value) => String(value).toUpperCase()),
  body('date_format')
    .optional()
    .isString()
    .isLength({ max: 40 }).withMessage('date_format must be up to 40 characters')
    .matches(/^[YMDHhmsAa\s/\-.,[\]]+$/).withMessage('date_format contains invalid characters'),
  body('lockout_attempts').optional().isInt({ min: 1, max: 20 }).withMessage('lockout_attempts must be 1-20').toInt(),
  body('lockout_minutes').optional().isInt({ min: 1, max: 1440 }).withMessage('lockout_minutes must be 1-1440').toInt(),
  body('password_requires_special').optional().isBoolean().withMessage('password_requires_special must be boolean').toBoolean(),
  body('password_min_length').optional().isInt({ min: 8, max: 128 }).withMessage('password_min_length must be 8-128').toInt(),
  body('password_reset_url').optional().isString().isLength({ max: 500 }).withMessage('password_reset_url must be up to 500 characters').bail().custom(optionalUrl).withMessage('password_reset_url must be an http(s) URL or empty'),
  body('webhook_timeout_ms').optional().isInt({ min: 100, max: 30000 }).withMessage('webhook_timeout_ms must be 100-30000').toInt(),
  body('audit_retention_months').optional().isInt({ min: 1, max: 120 }).withMessage('audit_retention_months must be 1-120').toInt(),
];
const passwordRules = body('temporary_password')
  .optional({ values: 'falsy' })
  .isString().withMessage('temporary_password must be a string').bail()
  .isLength({ min: 8 }).withMessage('temporary_password must be at least 8 characters long').bail()
  .matches(/[A-Z]/).withMessage('temporary_password must contain at least one uppercase letter').bail()
  .matches(/[0-9]/).withMessage('temporary_password must contain at least one number').bail()
  .matches(/[^A-Za-z0-9]/).withMessage('temporary_password must contain at least one special character');

const adminLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please try again later.' },
});
const destructiveAdminLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many destructive admin requests, please try again later.' },
});

router.use(requireAuth, requireAdmin, adminLimiter);
router.get('/dashboard', adminController.getDashboardStats);
router.get('/transactions', transactionFilters, validate, adminController.getAllTransactions);
router.get('/transactions/:id', idParam, validate, adminController.getAdminTransaction);
router.delete('/transactions/:id', destructiveAdminLimiter, requireAdminScope('write:transactions'), [
  idParam,
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.adminSoftDeleteTransaction);
router.get('/default-categories', adminController.listDefaultCategories);
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
  idParam,
  body('name').optional().isString().trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('type').optional().isIn(categoryTypes).withMessage(`type must be one of: ${categoryTypes.join(', ')}`),
  body('icon').optional().isString().isLength({ max: 50 }).withMessage('icon must be up to 50 characters'),
  body('color').optional().isString().isLength({ max: 20 }).withMessage('color must be up to 20 characters').matches(/^#[0-9A-Fa-f]{3,8}$/).withMessage('color must be a valid hex color'),
  body('is_default').optional().isBoolean().withMessage('is_default must be boolean'),
  body('is_system').optional().isBoolean().withMessage('is_system must be boolean'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('sort_order').optional().isInt({ min: 0, max: 10000 }).withMessage('sort_order must be 0-10000'),
], validate, adminController.updateDefaultCategory);
router.delete('/default-categories/:id', idParam, validate, adminController.deleteDefaultCategory);
router.post('/default-categories/push', adminController.pushDefaultCategories);
router.post('/users/bulk', [
  body('user_ids').isArray({ min: 1 }).withMessage('user_ids must be a non-empty array'),
  body('user_ids.*').isUUID().withMessage('each user id must be a UUID'),
  body('action').isIn(bulkUserActions).withMessage(`action must be one of: ${bulkUserActions.join(', ')}`),
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.bulkUpdateUsers);
router.get('/audit-retention', adminController.getAuditRetention);
router.post('/audit-retention/purge', destructiveAdminLimiter, requireAdminScope('db:maintenance'), requireConfirmation('audit_log_purge'), [
  body('before').custom(isIsoDate).withMessage('before must be a valid ISO date'),
], validate, adminController.purgeAuditLogs);
router.get('/system-config', adminController.getSystemConfig);
router.put('/system-config', systemConfigRules, validate, adminController.updateSystemConfig);
router.post('/database/integrity-check', adminController.runIntegrityCheck);
router.post('/database/vacuum', destructiveAdminLimiter, requireAdminScope('db:maintenance'), requireConfirmation('db_vacuum'), adminController.vacuumDatabase);
router.get('/database/backup', requireAdminScope('db:backup'), adminController.downloadDatabaseBackup);
router.get('/reports', adminController.getReports);
router.get('/reports/export', [
  query('type').optional().isIn(['monthly', 'categories']).withMessage('type must be monthly or categories'),
], validate, adminController.exportReportCsv);
router.get('/announcements', adminController.listAnnouncements);
router.post('/announcements', requireAdminScope('write:announcements'), [
  body('title').isString().trim().isLength({ min: 1, max: 120 }).withMessage('title must be 1-120 characters'),
  body('body').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('body must be 1-1000 characters'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('starts_at').optional({ nullable: true }).custom(isIsoDate).withMessage('starts_at must be a valid ISO date'),
  body('ends_at').optional({ nullable: true }).custom(isIsoDate).withMessage('ends_at must be a valid ISO date'),
], validate, adminController.createAnnouncement);
router.put('/announcements/:id', [
  idParam,
  body('title').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('title must be 1-120 characters'),
  body('body').optional().isString().trim().isLength({ min: 1, max: 1000 }).withMessage('body must be 1-1000 characters'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('starts_at').optional({ nullable: true }).custom(isIsoDate).withMessage('starts_at must be a valid ISO date'),
  body('ends_at').optional({ nullable: true }).custom(isIsoDate).withMessage('ends_at must be a valid ISO date'),
], validate, adminController.updateAnnouncement);
router.delete('/announcements/:id', idParam, validate, adminController.deleteAnnouncement);
router.get('/api-tokens', adminController.listApiTokens);
router.get('/token-scopes', adminController.getTokenScopes);
router.post('/api-tokens', [
  body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('name must be 1-100 characters'),
  body('scopes').optional().isArray({ min: 1, max: 20 }).withMessage('scopes must be an array'),
  body('scopes.*').optional().isString().isLength({ min: 1, max: 80 }).withMessage('scope must be 1-80 characters'),
], validate, adminController.createApiToken);
router.delete('/api-tokens/:id', idParam, validate, adminController.revokeApiToken);
router.get('/webhooks', adminController.listWebhooks);
router.post('/webhooks', [
  body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('name must be 1-100 characters'),
  body('url').custom(assertSafeWebhookUrl),
  body('event').isString().trim().isLength({ min: 1, max: 100 }).withMessage('event must be 1-100 characters'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('secret').optional().isString().isLength({ max: 200 }).withMessage('secret must be up to 200 characters'),
], validate, adminController.createWebhook);
router.put('/webhooks/:id', [
  idParam,
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('name must be 1-100 characters'),
  body('url').optional().custom(assertSafeWebhookUrl),
  body('event').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('event must be 1-100 characters'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  body('secret').optional().isString().isLength({ max: 200 }).withMessage('secret must be up to 200 characters'),
], validate, adminController.updateWebhook);
router.get('/webhooks/:id/deliveries', idParam, validate, adminController.listWebhookDeliveries);
router.get('/security-blocks', adminController.getSecurityBlocks);
router.post('/security-blocks', [
  body('ip')
    .isString()
    .isLength({ min: 3, max: 80 }).withMessage('ip must be 3-80 characters')
    .custom(isIpOrCidr).withMessage('ip must be a valid IPv4, IPv6, or CIDR address'),
  body('duration_minutes').optional().isInt({ min: 1, max: 1440 }).withMessage('duration_minutes must be 1-1440'),
], validate, adminController.blockSecurityAddress);
router.delete('/security-blocks/:ip', param('ip').isString().isLength({ min: 3, max: 80 }), validate, adminController.clearSecurityAddress);
router.get('/deleted-users', [
  query('search').optional().isString().isLength({ max: 100 }).withMessage('search must be up to 100 characters'),
  query('date_from').optional().custom(isIsoDate).withMessage('date_from must be a valid ISO date'),
  query('date_to').optional().custom(isIsoDate).withMessage('date_to must be a valid ISO date'),
  query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
  ...paging,
], validate, adminController.getDeletedUsers);
router.get('/deleted-users/:id', idParam, validate, adminController.getDeletedUser);
router.get('/users', [
  query('role').optional().isIn(roles).withMessage(`role must be one of: ${roles.join(', ')}`),
  query('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
  query('search').optional().isString().isLength({ max: 100 }).withMessage('search must be up to 100 characters'),
  ...paging,
], validate, adminController.getUsers);
router.get('/users/:id/sessions', [idParam, ...paging], validate, adminController.getUserSessions);
router.get('/users/:id', idParam, validate, adminController.getUser);
router.get('/users/:id/spending-by-category', [idParam, query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'), query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date')], validate, adminController.getUserSpendingByCategory);
router.get('/users/:id/login-history', [idParam, query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'), query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date'), ...paging], validate, adminController.getUserLoginHistory);
router.get('/users/:id/budget-performance', idParam, validate, adminController.getUserBudgetPerformance);
router.get('/users/:id/accounts', idParam, validate, adminController.getUserAccounts);
router.put('/users/:id/accounts/:accountId/status', [
  idParam,
  param('accountId').isUUID().withMessage('accountId must be a valid UUID'),
  body('is_active').isBoolean().withMessage('is_active must be boolean'),
  body('reason').optional().isString().isLength({ max: 500 }).withMessage('reason must be up to 500 characters'),
], validate, adminController.updateUserAccountStatus);
router.delete('/users/:id/accounts/:accountId', [
  idParam,
  param('accountId').isUUID().withMessage('accountId must be a valid UUID'),
  body('reason').isString().trim().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
  body('transaction_action').optional().isIn(['cash', 'delete']).withMessage('transaction_action must be cash or delete'),
], validate, adminController.deleteUserAccount);
router.post('/users/:id/accounts/:accountId/correction', requireConfirmation('balance_correction'), [
  idParam,
  param('accountId').isUUID().withMessage('accountId must be a valid UUID'),
  signedDecimalMoney(body('target_balance').notEmpty(), 'target_balance'),
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.createAccountBalanceCorrection);
router.get('/users/:id/export', [idParam, ...exportPaging], validate, adminController.exportUserData);
router.post('/users/:id/revoke-sessions', idParam, validate, adminController.revokeUserSessions);
router.post('/users/:id/impersonate', requireConfirmation('impersonation_token'), [
  idParam,
  body('reason').isString().isLength({ min: 5, max: 500 }).withMessage('reason must be 5-500 characters'),
], validate, adminController.impersonateUser);
router.put('/users/:id/status', [idParam, body('is_active').isBoolean().withMessage('is_active must be boolean')], validate, adminController.updateUserStatus);
router.put('/users/:id/role', [idParam, body('role').isIn(roles).withMessage(`role must be one of: ${roles.join(', ')}`)], validate, adminController.updateUserRole);
router.post('/users/:id/reset-password', [idParam, passwordRules], validate, adminController.resetUserPassword);
router.delete('/users/:id', destructiveAdminLimiter, requireConfirmation('hard_delete_user'), idParam, validate, adminController.deleteUser);
router.get('/audit-logs', [
  query('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
  query('action').optional().isString().isLength({ max: 100 }).withMessage('action must be up to 100 characters'),
  query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
  query('date_from').optional().custom(isIsoDate).withMessage('date_from must be a valid ISO date'),
  query('date_to').optional().custom(isIsoDate).withMessage('date_to must be a valid ISO date'),
  ...paging,
], validate, adminController.getAuditLogs);
router.get('/users/:id/transactions', [idParam, ...userTransactionFilters], validate, adminController.getUserTransactions);
router.get('/system-health', adminController.getSystemHealth);

module.exports = router;
