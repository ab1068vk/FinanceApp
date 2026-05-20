const express = require('express');
const { param } = require('express-validator');
const controller = require('../controllers/announcementController');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validateRequest');

const router = express.Router();
const idParam = param('id').isUUID().withMessage('id must be a valid UUID');

router.use(requireAuth);
router.get('/', controller.getActiveAnnouncements);
router.post('/:id/dismiss', idParam, validate, controller.dismissAnnouncement);

module.exports = router;
