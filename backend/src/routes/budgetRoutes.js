const express = require('express');
const { body, param } = require('express-validator');
const controller = require('../controllers/budgetController');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validateRequest');

const router = express.Router();
const periods = ['monthly', 'weekly', 'yearly'];
const isIsoDate = (value) => !Number.isNaN(Date.parse(value));
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');
const decimalAmount = (chain) => chain
  .isFloat({ min: 0.01 })
  .withMessage('amount must be a positive number')
  .bail()
  .custom((value) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) {
      throw new Error('amount must have at most 2 decimal places');
    }
    return true;
  });
const createRules = [
  decimalAmount(body('amount').notEmpty()),
  body('category_id').isUUID().withMessage('category_id must be a valid UUID'),
  body('period').isIn(periods).withMessage(`period must be one of: ${periods.join(', ')}`),
  body('start_date').custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  body('end_date').optional({ nullable: true, checkFalsy: true }).custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
];
const updateRules = [
  idParam,
  decimalAmount(body('amount').optional()),
  body('category_id').optional().isUUID().withMessage('category_id must be a valid UUID'),
  body('period').optional().isIn(periods).withMessage(`period must be one of: ${periods.join(', ')}`),
  body('start_date').optional().custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  body('end_date').optional({ nullable: true, checkFalsy: true }).custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
];

router.use(requireAuth);
router.get('/', controller.getBudgets);
router.post('/', createRules, validate, controller.createBudget);
router.get('/:id', idParam, validate, controller.getBudget);
router.put('/:id', updateRules, validate, controller.updateBudget);
router.delete('/:id', idParam, validate, controller.deleteBudget);

module.exports = router;
