const express = require('express');
const { param, validationResult } = require('express-validator');
const controller = require('../controllers/announcementController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({ errors: errors.array().map((error) => ({ field: error.path, message: error.msg })) });
};
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');

router.use(requireAuth);
router.get('/', controller.getActiveAnnouncements);
router.post('/:id/dismiss', idParam, validate, controller.dismissAnnouncement);

module.exports = router;
