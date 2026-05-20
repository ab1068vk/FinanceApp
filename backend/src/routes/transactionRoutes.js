const express = require('express');
const { body, param, query } = require('express-validator');
const controller = require('../controllers/transactionController');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validateRequest');

const router = express.Router();
const types = ['income', 'expense', 'transfer'];
const MAX_TRANSACTION_AMOUNT = 100000000;
const MAX_TRANSACTION_LIST_LIMIT = 200;
const isIsoDate = (value) => !Number.isNaN(Date.parse(value));
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');
const decimalMoney = (chain, field = 'amount') => chain
  .isFloat({ min: 0, max: MAX_TRANSACTION_AMOUNT })
  .withMessage(`${field} must be a non-negative number`)
  .bail()
  .custom((value) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error(`${field} must have at most 2 decimal places`);
    }
    return true;
  });
const positiveMoney = (chain, field = 'amount') => chain
  .notEmpty().withMessage(`${field} is required`)
  .isFloat({ min: 0.01, max: MAX_TRANSACTION_AMOUNT })
  .withMessage(`${field} must be a positive number`)
  .bail()
  .custom((value) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error(`${field} must have at most 2 decimal places`);
    }
    return true;
  });
const optionalPositiveMoney = (chain, field = 'amount') => chain
  .optional()
  .isFloat({ min: 0.01, max: MAX_TRANSACTION_AMOUNT })
  .withMessage(`${field} must be a positive number`)
  .bail()
  .custom((value) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error(`${field} must have at most 2 decimal places`);
    }
    return true;
  });
const filters = [
  query('account_id').optional().isUUID().withMessage('account_id must be a valid UUID'),
  query('category_id').optional().isUUID().withMessage('category_id must be a valid UUID'),
  query('type').optional().isIn(types).withMessage(`type must be one of: ${types.join(', ')}`),
  query('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  query('end_date').optional().custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
  query('date_from').optional().custom(isIsoDate).withMessage('date_from must be a valid ISO date'),
  query('date_to').optional().custom(isIsoDate).withMessage('date_to must be a valid ISO date'),
  decimalMoney(query('min_amount').optional(), 'min_amount'),
  decimalMoney(query('max_amount').optional(), 'max_amount'),
  query('search').optional().isString().isLength({ max: 100 }).withMessage('search must be up to 100 characters'),
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: MAX_TRANSACTION_LIST_LIMIT }).withMessage(`limit must be between 1 and ${MAX_TRANSACTION_LIST_LIMIT}`),
  query('page_size').optional().isInt({ min: 1, max: MAX_TRANSACTION_LIST_LIMIT }).withMessage(`page_size must be between 1 and ${MAX_TRANSACTION_LIST_LIMIT}`),
];
const createRules = [
  body('account_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('account_id must be a valid UUID'),
  body('to_account_id').if(body('type').equals('transfer')).isUUID().withMessage('to_account_id is required for transfers and must be a valid UUID'),
  body('category_id').custom((value, { req }) => {
    const missing = value === undefined || value === null || value === '';
    if (missing && req.body.type === 'transfer') return true;
    if (missing) throw new Error('category_id is required');
    if (!isUuid(value)) throw new Error('category_id must be a valid UUID');
    return true;
  }),
  body('type').isIn(types).withMessage(`type must be one of: ${types.join(', ')}`),
  positiveMoney(body('amount'), 'amount'),
  body('date').custom(isIsoDate).withMessage('date must be a valid ISO date'),
  body('description').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 200 }).withMessage('description must be up to 200 characters'),
  body('note').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }).withMessage('note must be up to 1000 characters'),
  body('tags').optional({ nullable: true }).isArray().withMessage('tags must be an array'),
  body('tags.*').optional().isString().trim().isLength({ max: 50 }).withMessage('each tag must be a string up to 50 characters'),
  body('receipt_path').optional({ nullable: true }).isString().isLength({ max: 255 }).withMessage('receipt_path must be up to 255 characters'),
  body('recurring').optional().isBoolean().withMessage('recurring must be boolean'),
  body('recurring_interval').optional({ nullable: true }).isIn(['daily', 'weekly', 'monthly', 'yearly']).withMessage('recurring_interval must be daily, weekly, monthly, or yearly'),
];
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
const bulkIdRules = [
  body('transaction_ids').isArray({ min: 1, max: 100 }).withMessage('transaction_ids must include 1 to 100 transaction IDs'),
  body('transaction_ids.*').isUUID().withMessage('each transaction ID must be a valid UUID'),
];
const bulkCategoryRules = [
  ...bulkIdRules,
  body('category_id').isUUID().withMessage('category_id must be a valid UUID'),
];

router.use(requireAuth);
router.get('/', filters, validate, controller.getTransactions);
// Creates always return { transactions: Transaction[] }, including one-item income/expense creates.
router.post('/', createRules, validate, controller.createTransaction);
router.get('/summary', filters, validate, controller.getTransactionSummary);
router.delete('/bulk', bulkIdRules, validate, controller.bulkDeleteTransactions);
router.patch('/bulk/category', bulkCategoryRules, validate, controller.bulkUpdateTransactionCategory);
router.get('/:id', idParam, validate, controller.getTransaction);
router.put('/:id', updateRules, validate, controller.updateTransaction);
router.delete('/:id', idParam, validate, controller.deleteTransaction);

module.exports = router;
