const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const controller = require('../controllers/accountController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const validTypes = ['checking', 'savings', 'credit', 'investment', 'cash'];
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, message: e.msg })) });
};
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');
const moneyFormat = (field, { min, message }) => body(field)
  .optional()
  .isFloat(min === undefined ? {} : { min })
  .withMessage(message)
  .bail()
  .custom((value) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error(`${field} must have at most 2 decimal places`);
    }
    return true;
  });
const clearableMoneyFormat = (field, { min, message }) => body(field)
  .optional({ nullable: true })
  .custom((value) => {
    if (value === '' || value === false) return true;
    const amount = Number(value);
    if (!Number.isFinite(amount) || (min !== undefined && amount < min)) {
      throw new Error(message);
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error(`${field} must have at most 2 decimal places`);
    }
    return true;
  });
const createRules = [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('type').isIn(validTypes).withMessage(`type must be one of: ${validTypes.join(', ')}`),
  body('currency').trim().isLength({ min: 3, max: 3 }).isAlpha().withMessage('currency must be a 3-letter code'),
  body('color').matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('icon').isString().withMessage('icon must be a string').bail().isLength({ min: 1, max: 50 }).withMessage('icon must be a string up to 50 characters'),
  moneyFormat('balance', { min: 0, message: 'balance must be a non-negative number' }),
  clearableMoneyFormat('overdraft_limit', { min: 0, message: 'overdraft_limit must be a non-negative number' }),
];
const updateRules = [
  idParam,
  // balance is intentionally not updatable here; account balances are transaction-derived.
  body('name').optional().trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('currency').optional().trim().isLength({ min: 3, max: 3 }).isAlpha().withMessage('currency must be a 3-letter code'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('icon').optional({ nullable: true }).isString().isLength({ max: 50 }).withMessage('icon must be a string up to 50 characters'),
  clearableMoneyFormat('overdraft_limit', { min: 0, message: 'overdraft_limit must be a non-negative number' }),
];
const deleteRules = [
  idParam,
  query('transaction_action')
    .optional()
    .isIn(['delete', 'cash'])
    .withMessage('transaction_action must be delete or cash'),
];

router.use(requireAuth);
router.get('/', controller.getAccounts);
router.post('/', createRules, validate, controller.createAccount);
router.get('/:id', idParam, validate, controller.getAccount);
router.put('/:id', updateRules, validate, controller.updateAccount);
router.delete('/:id', deleteRules, validate, controller.deleteAccount);

module.exports = router;

