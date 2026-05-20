const logger = require('./logger');

function assertSingleAccountBalanceUpdate(result, details) {
  if (result?.changes === 1) return;

  const context = {
    accountId: details.accountId,
    userId: details.userId,
    delta: details.delta,
    targetBalance: details.targetBalance,
    changes: result?.changes ?? 0,
    operation: details.operation || 'updateAccountBalance',
  };

  logger.error('Account balance update failed to affect exactly one row', context);
  throw Object.assign(new Error('Account balance update failed'), {
    statusCode: 500,
    code: 'ACCOUNT_BALANCE_UPDATE_FAILED',
    details: context,
  });
}

module.exports = {
  assertSingleAccountBalanceUpdate,
};
