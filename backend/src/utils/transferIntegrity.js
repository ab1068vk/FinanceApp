const { db } = require('../../database/db');

function incompleteTransferGroupsForAccount(accountId, userId) {
  return db.prepare(`
    WITH touching_groups AS (
      SELECT DISTINCT transfer_group_id
      FROM transactions
      WHERE user_id = ?
        AND transfer_group_id IS NOT NULL
        AND admin_deleted_at IS NULL
        AND (account_id = ? OR from_account_id = ? OR to_account_id = ?)
    )
    SELECT
      t.transfer_group_id,
      COUNT(*) AS total_count,
      SUM(CASE WHEN t.account_id = ? OR t.from_account_id = ? OR t.to_account_id = ? THEN 1 ELSE 0 END) AS touching_count
    FROM transactions t
    INNER JOIN touching_groups g ON g.transfer_group_id = t.transfer_group_id
    WHERE t.user_id = ?
      AND t.admin_deleted_at IS NULL
    GROUP BY t.transfer_group_id
    HAVING total_count != 2 OR touching_count != 2
  `).all(userId, accountId, accountId, accountId, accountId, accountId, accountId, userId);
}

function assertNoIncompleteTransferGroupsForAccount(accountId, userId) {
  const groups = incompleteTransferGroupsForAccount(accountId, userId);
  if (!groups.length) return;

  throw Object.assign(new Error('Please resolve incomplete transfers before moving this account to Cash'), {
    statusCode: 409,
    details: groups.map((group) => ({
      field: 'transfer_group_id',
      message: `${group.transfer_group_id} has ${group.total_count} row${Number(group.total_count) === 1 ? '' : 's'}; expected 2 complete transfer rows`,
    })),
  });
}

module.exports = {
  assertNoIncompleteTransferGroupsForAccount,
  incompleteTransferGroupsForAccount,
};
