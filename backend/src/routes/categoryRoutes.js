const express = require('express');
const { body, param, validationResult } = require('express-validator');
const controller = require('../controllers/categoryController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const types = ['income', 'expense'];
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, message: e.msg })) });
};
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');
const createRules = [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('icon').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 50 }).withMessage('icon must be up to 50 characters'),
  body('color').optional({ nullable: true, checkFalsy: true }).matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('type').isIn(types).withMessage(`type must be one of: ${types.join(', ')}`),
];
const updateRules = [
  idParam,
  body('name').optional().trim().isLength({ min: 1, max: 50 }).withMessage('name must be 1-50 characters'),
  body('icon').optional({ nullable: true }).isString().isLength({ max: 50 }).withMessage('icon must be up to 50 characters'),
  body('color').optional({ nullable: true }).matches(/^#[0-9A-Fa-f]{6}$/).withMessage('color must be a valid hex color'),
  body('type').optional().isIn(types).withMessage(`type must be one of: ${types.join(', ')}`),
];
const reorderRules = [
  body('category_ids').isArray({ min: 1 }).withMessage('category_ids must be a non-empty array'),
  body('category_ids.*').isUUID().withMessage('category_ids must contain valid UUIDs'),
];

router.use(requireAuth);
router.get('/', controller.getCategories);
router.post('/', createRules, validate, controller.createCategory);
router.put('/reorder', reorderRules, validate, controller.reorderCategories);
router.put('/:id', updateRules, validate, controller.updateCategory);
router.delete('/:id', idParam, validate, controller.deleteCategory);

module.exports = router;
