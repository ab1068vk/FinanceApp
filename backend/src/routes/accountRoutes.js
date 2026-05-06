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
const createRules = [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('type').isIn(validTypes).withMessage(`type must be one of: ${validTypes.join(', ')}`),
  body('currency').trim().isLength({ min: 3, max: 3 }).isAlpha().withMessage('currency must be a 3-letter code'),
  body('color').matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('icon').isString().withMessage('icon must be a string').bail().isLength({ min: 1, max: 50 }).withMessage('icon must be a string up to 50 characters'),
  body('balance').optional().isFloat().withMessage('balance must be numeric'),
  body('overdraft_limit').optional().isFloat({ min: 0, max: 100000000 }).withMessage('overdraft_limit must be between 0 and 100000000'),
];
const updateRules = [
  idParam,
  body('name').optional().trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('currency').optional().trim().isLength({ min: 3, max: 3 }).isAlpha().withMessage('currency must be a 3-letter code'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('icon').optional({ nullable: true }).isString().isLength({ max: 50 }).withMessage('icon must be a string up to 50 characters'),
  body('overdraft_limit').optional().isFloat({ min: 0, max: 100000000 }).withMessage('overdraft_limit must be between 0 and 100000000'),
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

