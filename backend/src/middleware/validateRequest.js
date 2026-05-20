const { validationResult } = require('express-validator');

function validationDetails(req) {
  return validationResult(req).array().map((error) => ({
    field: error.path,
    message: error.msg,
  }));
}

function validate(req, res, next) {
  const details = validationDetails(req);
  if (!details.length) return next();

  return res.status(400).json({
    error: 'Validation failed',
    details,
  });
}

module.exports = {
  validate,
  validationDetails,
};
