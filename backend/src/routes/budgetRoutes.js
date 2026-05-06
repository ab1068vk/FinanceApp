const express = require('express');
const { body, param, validationResult } = require('express-validator');
const controller = require('../controllers/budgetController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const periods = ['monthly', 'weekly', 'yearly'];
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, message: e.msg })) });
};
const isIsoDate = (value) => !Number.isNaN(Date.parse(value));
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');
const createRules = [
  body('amount').isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
  body('category_id').isUUID().withMessage('category_id must be a valid UUID'),
  body('period').isIn(periods).withMessage(`period must be one of: ${periods.join(', ')}`),
  body('start_date').custom(isIsoDate).withMessage('start_date must be a valid ISO date'),
  body('end_date').optional({ nullable: true, checkFalsy: true }).custom(isIsoDate).withMessage('end_date must be a valid ISO date'),
];
const updateRules = [
  idParam,
  body('amount').optional().isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
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
