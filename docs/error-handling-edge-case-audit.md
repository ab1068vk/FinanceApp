# Error Handling And Edge Case Audit

Scope: production source under `backend/database`, `backend/src`, `mobile/App.tsx`, and `mobile/src`. Test files are excluded. Line numbers refer to the current working tree on 2026-05-08.

## 1. Try/Catch Blocks

### Backend Route And Middleware Catches

Most backend route handlers use the same pattern: catch any synchronous or awaited failure and delegate to Express error middleware. These are not silent, but they often happen after earlier DB writes have already committed unless the writes were inside `db.transaction()`.

| File:line | Catches | Error handling | Silent? | Snippet |
|---|---|---|---|---|
| `backend/src/controllers/accountController.js:143` | account creation failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/accountController.js:154` | account list failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/accountController.js:166` | account detail failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/accountController.js:198` | account update failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/accountController.js:230` | account delete failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/announcementController.js:34` | active announcement query failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/announcementController.js:48` | dismissal failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:283` | register failures | unique email becomes `409`, otherwise `next(error)` | No | `if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') { ... } return next(error);` |
| `backend/src/controllers/authController.js:405` | login failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:471` | refresh token failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:496` | logout failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:544` | forgot password failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:599` | reset password failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:648` | verify email failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:675` | resend verification failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:757` | change password failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:772` | push token registration failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:782` | push token deregistration failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:794` | notification settings read failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:812` | notification settings update failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:839` | notification list failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:850` | mark notification read failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:879` | session list failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:896` | revoke one session failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:920` | revoke other sessions failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:952` | profile update failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:987` | personal export failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:1018` | delete my data failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/authController.js:1068` | delete account failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/budgetController.js:114` | budget creation failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/budgetController.js:140` | budget list failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/budgetController.js:168` | budget detail failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/budgetController.js:202` | budget update failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/budgetController.js:212` | budget delete failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/categoryController.js:63` | category list failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/categoryController.js:80` | category create failures | unique conflict becomes `409`, otherwise `next(error)` | No | `if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409)...` |
| `backend/src/controllers/categoryController.js:102` | category update failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/categoryController.js:120` | category reorder failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/categoryController.js:130` | category delete failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:245` | transaction create failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:278` | transaction list failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:288` | transaction detail failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:370` | transaction update failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:402` | transaction delete failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:440` | summary failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:509` | bulk delete failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/controllers/transactionController.js:530` | bulk category update failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/middleware/auth.js:104` | JWT verification/auth lookup failures | token errors become `401`, otherwise `next(error)` | No | `if (error.name === 'TokenExpiredError') ... return next(error);` |
| `backend/src/middleware/auth.js:160` | ownership lookup failures | `next(error)` | No | `} catch (error) { return next(error); }` |
| `backend/src/middleware/securityMonitor.js:116` | audit write failure for security event | logs error and continues | Partly | `} catch (error) { logger.error('Failed to record security event', ...); }` |

Admin controller has the same `next(error)` pattern on most routes: `getDashboardStats:535`, `getUsers:580`, `getUser:607`, `getUserSessions:633`, `updateUserStatus:655`, `getDeletedUsers:706`, `getDeletedUser:723`, `updateUserRole:743`, `resetUserPassword:786`, `deleteUser:857`, `getAuditLogs:899`, `getUserTransactions:961`, `getUserSpendingByCategory:991`, `getUserLoginHistory:1015`, `getUserBudgetPerformance:1048`, `exportUserData:1133`, `getSystemHealth:1153`, `getAllTransactions:1205`, `getAdminTransaction:1223`, `adminSoftDeleteTransaction:1251`, `getUserAccounts:1269`, `updateUserAccountStatus:1286`, `deleteUserAccount:1345`, `createAccountBalanceCorrection:1400`, `listDefaultCategories:1411`, `createDefaultCategory:1442`, `updateDefaultCategory:1468`, `deleteDefaultCategory:1500`, `pushDefaultCategories:1539`, `bulkUpdateUsers:1569`, `revokeUserSessions:1585`, `getAuditRetention:1598`, `purgeAuditLogs:1612`, `getSystemConfig:1620`, `updateSystemConfig:1638`, `runIntegrityCheck:1648`, `vacuumDatabase:1660`, `downloadDatabaseBackup:1671`, `getReports:1709`, `exportReportCsv:1742`, `listAnnouncements:1753`, `createAnnouncement:1783`, `updateAnnouncement:1806`, `deleteAnnouncement:1822`, `listApiTokens:1833`, `createApiToken:1868`, `revokeApiToken:1884`, `listWebhooks:1898`, `createWebhook:1923`, `updateWebhook:1952`, `listWebhookDeliveries:1963`, `getSecurityBlocks:1973`, `blockSecurityAddress:1984`, `clearSecurityAddress:1994`, and `impersonateUser:2015`.

Snippet for that repeated admin pattern:

```js
} catch (error) {
  return next(error);
}
```

### Silent Or Degrading Catches

| File:line | Catches | Behavior | Silent? | Snippet |
|---|---|---|---|---|
| `backend/database/db.js:643-648` | malformed legacy transfer `tags` JSON | resets metadata to `{}` and continues migration | Yes | `try { metadata = JSON.parse(row.tags || '{}') || {}; ... } catch { metadata = {}; }` |
| `backend/src/app.js:45-49` | invalid `Origin` URL in test mode | returns `false` for origin allow-list | Yes | `try { const url = new URL(origin); ... } catch { return false; }` |
| `backend/src/app.js:185-190` | missing Swagger deps | logs warning and disables `/api/docs` | No | `logger.warn('Swagger UI unavailable...', { error: error.message });` |
| `backend/src/app.js:225-230` | health DB probe failure | logs and returns degraded `503` | No | `dbStatus = 'error'; logger.error('Health check database probe failed', ...)` |
| `backend/src/controllers/adminController.js:101-107` | bad audit JSON | returns `null`; audit summary loses detail | Yes | `try { return JSON.parse(value); } catch { return null; }` |
| `backend/src/controllers/adminController.js:262-275` | bad export cursor | converts to `400` | No | `catch { throw Object.assign(new Error('Invalid export cursor'), { statusCode: 400 }); }` |
| `backend/src/controllers/adminController.js:410-414` | bad app setting JSON | falls back to supplied default | Yes | `try { return row ? JSON.parse(row.value) : fallback; } catch { return fallback; }` |
| `backend/src/controllers/adminController.js:716-720` | bad deleted-user archive JSON | returns `details = null` | Yes | `try { details = row.details_json ? JSON.parse(row.details_json) : null; } catch { details = null; }` |
| `backend/src/controllers/adminController.js:778-783` | admin temp password delivery failure | logs warning, still returns `200` with password and `delivery_failed` | No, but returns success | `catch (deliveryError) { logger.warn(...); delivery = { channel: 'email', sent: false, error: 'delivery_failed' }; }` |
| `backend/src/controllers/authController.js:267-274` | registration verification email delivery failure | logs and returns `503` after user was already created | No, but partial write remains | `return res.status(503).json({ error: 'Verification email could not be sent...' });` |
| `backend/src/controllers/authController.js:533-540` | password reset email delivery failure | logs and returns `503` after reset token was already created | No, but partial write remains | `return res.status(503).json({ error: 'Password reset email could not be sent...' });` |
| `backend/src/controllers/authController.js:664-671` | resend verification delivery failure | logs and returns `503` after new verification token was created | No, but partial write remains | `return res.status(503).json({ error: 'Verification email could not be sent...' });` |
| `backend/src/controllers/authController.js:738-745` | password-change transaction failure | logs rollback and rethrows | No | `logger.error('Password change transaction rolled back', ...); throw transactionError;` |
| `backend/src/controllers/authController.js:834` | bad notification `data_json` | returns `data: null` | Yes | `try { return JSON.parse(row.data_json); } catch { return null; }` |
| `backend/src/server.js:108-140` | background cleanup/recurring failures | logs and keeps server alive | No | `logger.error('Recurring transaction processor failed', { error: error.message });` |
| `backend/src/server.js:155-159` | backup failure | logs and keeps server alive | No | `logger.error('SQLite backup failed', { error: error.message });` |
| `backend/src/utils/accessTokenBlocklist.js:19-23` | blocklist prune failure | intentionally ignored | Yes | `} catch { // Reads fail closed... }` |
| `backend/src/utils/accessTokenBlocklist.js:48-55` | blocklist read failure | returns `true` fail-closed | No | `catch { return true; }` |
| `backend/src/utils/money.js:98-101` | bad serialized `tags` JSON | returns empty array | Yes | `catch { return [childKey, []]; }` |
| `backend/src/utils/recurringProcessor.js:167-174` | one recurring rule failure | logs and records `{ status: 'failed' }`, continues other rules | No | `results.push({ status: 'failed', rule_id: rule.id, error: error.message });` |
| `backend/src/utils/urlSafety.js:40-43` | invalid webhook URL parse | throws `400` | No | `catch { throw Object.assign(new Error('webhook url is invalid'), { statusCode: 400 }); }` |

### Mobile Try/Catch Pattern

Mobile catches primarily do one of three things:

- show a toast/alert and reject the thunk (`mobile/src/store/slices/*`, transaction/account/budget/auth/admin slices)
- swallow malformed local data and use defaults (`mobile/src/utils/offlineQueue.ts:30-36`, `mobile/src/utils/jwt.ts:11-29`, many `formatDate` helpers)
- ignore non-critical integrations (`mobile/App.tsx:181-183`, `mobile/src/theme/index.ts:126-133`)

Most dangerous mobile examples:

```tsx
// mobile/App.tsx:75-92
const restore = async () => {
  try {
    ...
    await dispatch(loadStoredAuth()).unwrap();
  } finally {
    clearTimeout(restoreTimeout);
    if (mounted) setIsRestoringAuth(false);
  }
};
void restore();
```

This uses `try/finally` without `catch`; a rejected auth restore becomes an unhandled promise.

```tsx
// mobile/src/theme/index.ts:126-133
loadAppSettings().then((settings) => setMode(settings.themeMode)).catch(() => {});
...
.catch(() => {});
```

Theme persistence failures are fully silent.

Mobile catch-line inventory:

| File:line | What it does | Silent? | Snippet |
|---|---|---|---|
| `mobile/App.tsx:75-84` | uses `try/finally` for auth restore cleanup, but catches nothing | No catch | `try { ... await dispatch(loadStoredAuth()).unwrap(); } finally { ... }` |
| `mobile/App.tsx:181` | ignores health/version check failure | Yes | `} catch {` |
| `mobile/App.tsx:257` | shows session-expired toast after refresh failure | No | `} catch {` |
| `mobile/src/navigation/deepLinks.ts:23` | invalid URL parse returns `null` | Yes | `} catch {` |
| `mobile/src/screens/accounts/AccountDetailScreen.tsx:42` | bad date/transaction parse fallback | Yes | `} catch {` |
| `mobile/src/screens/accounts/AccountDetailScreen.tsx:70` | account detail load failure sets error state | No | `} catch {` |
| `mobile/src/screens/accounts/AccountDetailScreen.tsx:106` | delete failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/accounts/AccountsScreen.tsx:28` | account fetch failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/accounts/AddAccountScreen.tsx:73` | save failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/accounts/EditAccountScreen.tsx:70` | save failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/AdminToolsScreen.tsx:164` | JSON formatting failure falls back | Yes | `} catch (error) {` |
| `mobile/src/screens/admin/AdminToolsScreen.tsx:187` | admin action failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/AdminTransactionsScreen.tsx:96` | transaction list load failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/AdminTransactionsScreen.tsx:113` | soft delete failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/AuditLogsScreen.tsx:55` | bad JSON formatting falls back | Yes | `} catch {` |
| `mobile/src/screens/admin/AuditLogsScreen.tsx:67` | bad audit JSON summary falls back | Yes | `} catch {` |
| `mobile/src/screens/admin/DefaultCategoriesScreen.tsx:86` | load failure ignored by setting loading false | Mostly | `} catch {` |
| `mobile/src/screens/admin/DefaultCategoriesScreen.tsx:129` | save failure ignored | Yes | `} catch {` |
| `mobile/src/screens/admin/DefaultCategoriesScreen.tsx:140` | toggle failure ignored | Yes | `} catch {` |
| `mobile/src/screens/admin/DefaultCategoriesScreen.tsx:157` | delete failure ignored | Yes | `} catch {` |
| `mobile/src/screens/admin/DefaultCategoriesScreen.tsx:169` | push defaults failure ignored | Yes | `} catch {` |
| `mobile/src/screens/admin/UserDetailScreen.tsx:236` | account load failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/UserDetailScreen.tsx:250` | account toggle failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/UserDetailScreen.tsx:283` | account delete failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/UserDetailScreen.tsx:295` | session revoke failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/UserDetailScreen.tsx:305` | impersonation failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/UserDetailScreen.tsx:322` | export failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/UserDetailScreen.tsx:377` | confirm action failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/admin/UsersListScreen.tsx:95` | bulk action failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/auth/ForgotPasswordScreen.tsx:75` | reset request failure uses generic success state | Yes by design | `} catch {` |
| `mobile/src/screens/auth/ForgotPasswordScreen.tsx:100` | reset password failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/auth/LoginScreen.tsx:87` | login failure shows normalized message | No | `} catch (error) {` |
| `mobile/src/screens/auth/RegisterScreen.tsx:84` | registration failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/auth/VerifyEmailScreen.tsx:63` | verification failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/auth/VerifyEmailScreen.tsx:89` | resend failure ignored | Yes | `} catch {` |
| `mobile/src/screens/budget/BudgetDetailScreen.tsx:72` | budget load failure fallback | Mostly | `} catch {` |
| `mobile/src/screens/budget/BudgetsScreen.tsx:103` | budget fetch failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/budget/BudgetsScreen.tsx:145` | budget toggle failure ignored | Yes | `} catch {` |
| `mobile/src/screens/budget/BudgetsScreen.tsx:171` | budget create failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/categories/CategoriesScreen.tsx:79` | summary load failure ignored | Yes | `} catch {` |
| `mobile/src/screens/categories/CategoriesScreen.tsx:137` | category save failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/categories/CategoriesScreen.tsx:157` | category delete failure ignored | Yes | `} catch {` |
| `mobile/src/screens/categories/CategoriesScreen.tsx:183` | category reorder failure ignored/rolled back by UI state only | Yes | `} catch {` |
| `mobile/src/screens/dashboard/DashboardScreen.tsx:121` | dashboard load failure shows error state | No | `} catch (error) {` |
| `mobile/src/screens/dashboard/DashboardScreen.tsx:138` | announcement dismiss failure ignored | Yes | `} catch {` |
| `mobile/src/screens/dashboard/OverviewScreen.tsx:142` | overview load failure ignored | Yes | `} catch {` |
| `mobile/src/screens/notifications/NotificationsScreen.tsx:74` | notifications load failure ignored | Yes | `} catch {` |
| `mobile/src/screens/notifications/NotificationsScreen.tsx:106` | open notification failure ignored | Yes | `} catch {` |
| `mobile/src/screens/profile/ActiveSessionsScreen.tsx:45` | session load failure shows error | No | `} catch (loadError) {` |
| `mobile/src/screens/profile/ActiveSessionsScreen.tsx:77` | revoke one session failure shows alert | No | `} catch (revokeError) {` |
| `mobile/src/screens/profile/ActiveSessionsScreen.tsx:101` | revoke other sessions failure shows alert | No | `} catch (revokeError) {` |
| `mobile/src/screens/profile/ChangePasswordScreen.tsx:61` | password change failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/profile/EditProfileScreen.tsx:41` | profile save failure ignored | Yes | `} catch {` |
| `mobile/src/screens/profile/OfflineQueueScreen.tsx:48` | queue retry failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/profile/ProfileScreen.tsx:39` | profile dashboard load failure ignored | Yes | `} catch {` |
| `mobile/src/screens/profile/SettingsScreen.tsx:136` | settings load/export-prep failure ignored | Mostly | `} catch {` |
| `mobile/src/screens/profile/SettingsScreen.tsx:164` | biometric preference failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/profile/SettingsScreen.tsx:193` | CSV export failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/profile/SettingsScreen.tsx:209` | JSON export failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/profile/SettingsScreen.tsx:242` | delete-all-data failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/profile/SettingsScreen.tsx:260` | account deletion failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/reports/ReportsScreen.tsx:196` | report fetch fallback path | No | `} catch (error) {` |
| `mobile/src/screens/reports/ReportsScreen.tsx:240` | secondary report page failure stops pagination | Mostly | `} catch {` |
| `mobile/src/screens/reports/ReportsScreen.tsx:381` | report refresh failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/reports/ReportsScreen.tsx:403` | export/share failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/transactions/AddTransactionScreen.tsx:216` | transaction save failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/transactions/EditTransactionScreen.tsx:26` | bad tags parse falls back | Yes | `} catch {` |
| `mobile/src/screens/transactions/EditTransactionScreen.tsx:107` | transaction update failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/transactions/TransactionDetailScreen.tsx:33` | bad tags parse falls back | Yes | `} catch {` |
| `mobile/src/screens/transactions/TransactionDetailScreen.tsx:68` | transaction delete failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/transactions/TransactionsScreen.tsx:166` | bulk category update failure shows toast | No | `} catch (error) {` |
| `mobile/src/screens/transactions/TransactionsScreen.tsx:186` | bulk delete failure shows toast | No | `} catch (error) {` |
| `mobile/src/services/api.ts:33` | offline queue callback failure falls back | Yes | `} catch {` |
| `mobile/src/services/api.ts:36` | broken queue callback ignored | Yes | `} catch {` |
| `mobile/src/services/api.ts:58` | optional SSL pinning module missing | logs warning in production-like env | No | `} catch {` |
| `mobile/src/services/api.ts:139` | refresh failure clears tokens and rejects | No | `} catch (refreshError) {` |
| `mobile/src/services/appSettings.ts:33` | bad settings JSON removes settings | No | `} catch {` |
| `mobile/src/services/clientErrors.ts:17` | client error report failure ignored | Yes | `} catch {` |
| `mobile/src/services/deviceSecurity.ts:12` | optional device-security module missing | Yes | `} catch {` |
| `mobile/src/services/pushNotifications.ts:14` | optional notifications module missing | Yes | `} catch {` |
| `mobile/src/services/secureStorage.ts:51` | secure storage unavailable falls back to memory | No | `} catch {` |
| `mobile/src/store/slices/accountsSlice.ts:82,94,118,135` | account thunk failures reject/show offline queue where applicable | No | `} catch (error) {` |
| `mobile/src/store/slices/adminSlice.ts:202-361` | admin thunk failures reject with normalized errors | No | `} catch (error) {` |
| `mobile/src/store/slices/authSlice.ts:106,118,134,158,181,206` | auth thunk failures normalize, clear tokens where needed | No | `} catch (error) {` / `} catch {` |
| `mobile/src/store/slices/budgetsSlice.ts:69,81` | budget thunk failures reject/offline queue where applicable | No | `} catch (error) {` |
| `mobile/src/store/slices/transactionsSlice.ts:150,167,179,203,220,237,254,271,283` | transaction thunk failures reject/offline queue where applicable | No | `} catch (error) {` |
| `mobile/src/theme/index.ts:126,133` | app setting/theme persistence failures ignored | Yes | `.catch(() => {});` |
| `mobile/src/utils/jwt.ts:13,29` | JWT decode failures return `null`/expired | Mostly | `} catch {` |
| `mobile/src/utils/offlineQueue.ts:36` | bad offline queue JSON returns empty queue | Yes | `} catch {` |

## 2. DB Operations That Can Fail Without Local Handling

`better-sqlite3` operations throw synchronously. Many are protected by an outer route catch, but the following are still fragile because they are outside transactions, outside local handling, or happen at startup/background time.

| File:line | Operation | Failure behavior | Snippet |
|---|---|---|---|
| `backend/database/db.js:86` | startup schema creation | throws during module load; app fails to start | `db.exec(\`CREATE TABLE IF NOT EXISTS schema_version ...\`);` |
| `backend/database/db.js:433-797` | ad hoc schema migrations | many operations are not wrapped in one transaction; partial migration state is possible | `db.exec('ALTER TABLE users ADD COLUMN security_stamp TEXT'); ... updateStamp.run(...)` |
| `backend/database/db.js:813-831` | seed cash accounts | startup failure; previous loop iterations remain | `for (const user of usersWithoutAccounts) { insertAccount.run({...}); }` |
| `backend/database/db.js:853-883` | default category dedupe/update/delete | startup failure can leave mixed category refs | `updateTransactions.run(keepId, row.id); updateBudgets.run(...); deleteCategory.run(row.id);` |
| `backend/database/db.js:1075-1084` | admin seed insert | startup failure; no route handling | `db.prepare(...).run(uuid(), adminEmail.toLowerCase(), ...)` |
| `backend/src/controllers/budgetController.js:110-113` | insert budget then audit outside transaction | budget persists if audit fails, response becomes 500 | `db.prepare(...).run(budget); audit(req, 'BUDGET_CREATED', ...);` |
| `backend/src/controllers/budgetController.js:198-201` | update budget then audit outside transaction | budget update persists if audit fails | `db.prepare(\`UPDATE budgets SET ${setSql}...\`).run(...); ... audit(...)` |
| `backend/src/controllers/budgetController.js:209-211` | delete budget then audit outside transaction | budget deleted if audit fails | `db.prepare('DELETE FROM budgets ...').run(...); audit(...)` |
| `backend/src/controllers/categoryController.js:74-78` | insert category then audit outside transaction | category persists if audit fails | `db.prepare(...).run(category); audit(...)` |
| `backend/src/controllers/categoryController.js:99-101` | update category then audit outside transaction | update persists if audit fails | `db.prepare(\`UPDATE categories SET ${setSql}...\`).run(...); audit(...)` |
| `backend/src/controllers/categoryController.js:128-129` | delete category then audit outside transaction | delete persists if audit fails | `db.prepare('DELETE FROM categories ...').run(...); audit(...)` |
| `backend/src/controllers/accountController.js:194-196` | account update then audit outside transaction | account update persists if audit fails | `db.prepare(\`UPDATE accounts SET ${setSql}...\`).run(...); audit(...)` |
| `backend/src/controllers/authController.js:486-493` | logout revokes refresh, blocks access token, audits | any later failure returns 500 after earlier state changed | `UPDATE refresh_tokens...; blockAccessToken(...); writeAuditLog(...);` |
| `backend/src/controllers/authController.js:804-808` | notification preference loop | if one update fails, earlier preferences remain changed | `Object.keys(DEFAULT_PREFS).forEach((type) => { ... update.run(...); });` |
| `backend/src/controllers/adminController.js:1772-1777` | create announcement, audit, select users | announcement can persist if audit/user query fails | `INSERT INTO announcements...; audit(...); const users = db.prepare(...).all();` |
| `backend/src/controllers/adminController.js:1862-1866` | create API token then audit | token can persist if audit fails | `INSERT INTO admin_api_tokens...; audit(...)` |
| `backend/src/controllers/adminController.js:1881-1882` | revoke API token then audit | token revoked if audit fails | `UPDATE admin_api_tokens SET is_active = 0...; audit(...)` |
| `backend/src/controllers/adminController.js:1917-1921` | create webhook then audit | webhook persists if audit fails | `INSERT INTO webhooks...; audit(...)` |
| `backend/src/controllers/adminController.js:1948-1950` | update webhook then audit | webhook update persists if audit fails | `UPDATE webhooks SET ${setSql}...; audit(...)` |
| `backend/src/controllers/adminController.js:283-301` | streaming export iterator | if `statement.iterate` throws after headers/body start, response can be partial | `for (const row of statement.iterate(...params, limit + 1, offset)) { res.write(...) }` |
| `backend/src/controllers/adminController.js:1667-1670` | file stream backup | stream errors after `pipe(res)` are not handled here | `return fs.createReadStream(dbPath).pipe(zlib.createGzip()).pipe(res);` |

## 3. Async Operations Not Awaited Or Promises Not Handled

| File:line | Operation | Handled? | Risk | Snippet |
|---|---|---|---|---|
| `mobile/App.tsx:92` | auth restore promise | No catch | unhandled rejection; app leaves restore mode via `finally` but auth errors are not surfaced | `void restore();` |
| `mobile/App.tsx:101-103` | initial deep link fetch | No catch | initial link errors become unhandled | `void Linking.getInitialURL().then((url) => { pendingInitialUrl.current = url; });` |
| `mobile/App.tsx:143-150` | jailbreak/root detection | No catch | device-security module failure becomes unhandled | `void detectRootedOrJailbrokenDevice().then((suspicious) => { ... });` |
| `mobile/App.tsx:167` | open app store URL | No catch | bad URL/platform failure ignored by global rejection only | `if (storeUrl) void Linking.openURL(storeUrl);` |
| `mobile/App.tsx:195-197` | initial NetInfo fetch | No catch | startup network-state failure unhandled | `void NetInfo.fetch().then((state) => { ... });` |
| `mobile/App.tsx:245-261` | AppState async IIFE | No outer catch | `getAutoLockPreference()` failures are unhandled; only refresh is caught | `void (async () => { const preference = await getAutoLockPreference(); ... })();` |
| `mobile/App.tsx:324` | update banner open URL | No catch | open URL failure unhandled | `if (storeUrl) void Linking.openURL(storeUrl);` |
| `backend/src/controllers/transactionController.js:154-159` | budget overspend push | `.catch` logs warning | returns success even if notification fails | `void sendPushNotification(...).catch((pushError) => logger.warn(...));` |
| `backend/src/controllers/transactionController.js:237-242` | large transaction push | `.catch` logs warning | returns success even if notification fails | `void sendPushNotification(...).catch((pushError) => logger.warn(...));` |
| `backend/src/controllers/authController.js:750-755` | password change push | `.catch` logs warning | returns success even if notification fails | `void sendPushNotification(...).catch((pushError) => logger.warn(...));` |
| `backend/src/controllers/adminController.js:1778-1780` | announcement push per user | `.catch` logs warning | returns `201` even if all pushes fail | `void sendPushNotification(...).catch((pushError) => logger.warn(...));` |
| `backend/src/utils/recurringProcessor.js:152-157` | recurring transaction push | `.catch` logs warning | processed transaction remains; notification may fail | `void sendPushNotification(...).catch((pushError) => logger.warn(...));` |
| `backend/src/server.js:163-165` | scheduled backup calls | internal catch in `runBackupIfDue` | safe | `void runBackupIfDue(); ... void runBackupIfDue();` |

## 4. User Input Used Without Validation

Most API routes use `express-validator`, but these gaps remain.

| File:line | Input | Use | Risk | Snippet |
|---|---|---|---|---|
| `backend/src/controllers/authController.js:804-808` | keys in `req.body.preferences` | unsupported keys ignored, supported keys update directly | typos get `200` with partial/no-op update | `Object.keys(DEFAULT_PREFS).forEach((type) => { if (...updates, type)) update.run(...) })` |
| `backend/src/controllers/adminController.js:1546-1568` | `req.body.user_ids` | filters self but does not require every requested id to exist | returns success for partial set | `const users = db.prepare(\`SELECT * FROM users WHERE id IN (${placeholders})\`).all(...ids);` |
| `backend/src/controllers/adminController.js:1354` | `req.body.target_balance` | route validates decimal shape but has no maximum | huge value can exceed JS safe integer/SQLite integer expectations | `const targetBalance = amountToCents(req.body.target_balance);` |
| `backend/src/routes/accountRoutes.js:16-34` | `balance`, `overdraft_limit` | no max bound | very large valid decimal string reaches `amountToCents` | `moneyFormat('balance', { min: 0, ... })` |
| `backend/src/controllers/categoryController.js:111` | `req.body.category_ids` | dynamic placeholder string | route validates UUIDs, but empty array would make invalid SQL if controller reused | `id IN (' + ids.map(() => '?').join(',') + ')'` |
| `backend/database/db.js:905` | `table` in internal helper | string interpolation in PRAGMA | currently internal constants only; unsafe if ever exposed | ``db.prepare(`PRAGMA table_info(${table})`).all()`` |
| `mobile/src/screens/admin/AdminToolsScreen.tsx:403-411` | numeric settings text | `Number(value) || 0` before API validation | transient client state can send `0` for invalid input; server rejects | `onChangeText={(value) => updateSetting('max_accounts_per_user', Number(value) || 0)}` |

## 5. Calculations That Can Produce NaN, Infinity, Null, Or Undefined

| File:line | Calculation | Bad value | Downstream behavior | Snippet |
|---|---|---|---|---|
| `backend/src/controllers/budgetController.js:93-97` | budget percentage | `NaN` if DB has nonnumeric `amount` or `current_spending` | `res.json` serializes `NaN` as `null` | `return Math.round((currentSpending / amount) * 10000) / 100;` |
| `backend/src/controllers/adminController.js:42-46` | admin budget percentage | `NaN` under malformed DB rows | JSON `null` in admin response | `return Math.round((currentSpending / amount) * 10000) / 100;` |
| `backend/src/utils/money.js:65-73` | `computeBalanceDelta` | `NaN` if `transaction.amount` is nonnumeric | account balance update can bind invalid delta | `const amount = Number(transaction.amount || 0);` |
| `backend/src/controllers/transactionController.js:73-90` | overdraft limit and next balance | `NaN` can bypass overdraft check | transaction may proceed if malformed stored account data exists | `const limit = Math.max(Number(account.overdraft_limit || 0), 0);` |
| `backend/src/controllers/transactionController.js:20-27` | date parsing | invalid date throws `RangeError` | route catch turns it into 500 unless validator catches first | `return new Date(raw).toISOString();` |
| `backend/src/controllers/budgetController.js:56-69` | budget date normalization | invalid date throws `RangeError` | route catch turns it into 500 unless validator catches first | `start_date: startDate.toISOString()` |
| `backend/src/controllers/adminController.js:231-232` | pagination | very large query numbers can produce huge offsets | DB query can become slow; no route validation on some admin list routes | `const page = Math.max(Number(req.query.page) || 1, 1);` |
| `backend/src/utils/money.js:29-55` | `amountToCents` | very large valid decimals can exceed safe integer | precision loss before SQLite insert/update | `const abs = parseInt(intPart, 10) * 100 + roundedCents;` |
| `mobile/src/utils/formatters.ts:18-21` | percent format | `NaN%` if `value` is nonnumeric and `total` truthy | visible malformed UI text | ``return `${((Number(value) / Number(total)) * 100).toFixed(1)}%`;`` |
| `mobile/src/screens/transactions/AddTransactionScreen.tsx:112-114` | amount display | `NaN` if `amount` state becomes nonnumeric | displays `$NaN` | `const amountDisplay = useMemo(() => \`$\${amountNumber.toFixed(2)}\`, [amountNumber]);` |
| `mobile/src/screens/dashboard/DashboardScreen.tsx:86-87` | monthly change | `Infinity` if `netWorth` is `0` but not caught by truthiness changes later | currently guarded by `if (!netWorth) return 0` before snippet | `const raw = (monthlySummary.net / Math.abs(netWorth)) * 100;` |
| `mobile/src/screens/budget/BudgetDetailScreen.tsx:143` | progress width | `NaN%` if `amount` or `spent` is nonnumeric | broken style width | ``width: `${Math.min(ratio, 1) * 100}%` `` |

## 6. Multi-Step Operations That Are Not Atomic

| File:line | Steps | Failure after step 1 leaves DB as | Snippet |
|---|---|---|---|
| `backend/src/controllers/authController.js:246-274` | create user/default account/audit/token in transaction, then send verification email | user and token remain even though API returns `503` | `createUser(); ... await deliverEmailVerificationToken(...)` |
| `backend/src/controllers/authController.js:519-540` | expire old reset tokens, insert new token, audit, then email | reset token exists and older tokens are used even though API returns `503` | `createResetToken(); try { await deliverPasswordResetToken(...) } catch ...` |
| `backend/src/controllers/authController.js:654-671` | create verification token, then email | new token exists even though API returns `503` | `const verification = createEmailVerificationToken(req, user); try { await deliverEmailVerificationToken(...) }` |
| `backend/src/controllers/authController.js:486-493` | revoke refresh token, block access token, write audit | refresh may be revoked without access token block/audit if later step fails | `UPDATE refresh_tokens...; blockAccessToken(...); writeAuditLog(...);` |
| `backend/src/controllers/authController.js:804-808` | update multiple notification prefs | earlier prefs changed if a later update throws | `Object.keys(DEFAULT_PREFS).forEach(... update.run(...))` |
| `backend/src/controllers/budgetController.js:110-113` | insert budget then audit | budget exists without audit if audit fails | `run(budget); audit(...)` |
| `backend/src/controllers/categoryController.js:74-78` | insert category then audit | category exists without audit if audit fails | `run(category); audit(...)` |
| `backend/src/controllers/accountController.js:194-196` | update account then audit | account changed without audit if audit fails | `UPDATE accounts...; audit(...)` |
| `backend/src/controllers/adminController.js:1772-1780` | insert announcement, audit, load users, fire pushes | announcement exists even if audit/user query/push fails | `INSERT INTO announcements...; audit(...); const users = ...; users.forEach(...)` |
| `backend/src/controllers/adminController.js:1862-1867` | insert API token then audit | token exists if audit fails; client may receive 500 and lose raw token forever | `INSERT INTO admin_api_tokens...; audit(...); return ... token` |
| `backend/src/controllers/adminController.js:1917-1922` | insert webhook then audit | webhook exists if audit fails | `INSERT INTO webhooks...; audit(...)` |
| `backend/src/controllers/adminController.js:1053-1131` | streaming export writes multiple tables | if a later query fails, client may have partial JSON with headers already sent | `res.write('{'); ... streamJsonArray(...); ... res.end('}')` |
| `backend/src/controllers/adminController.js:1667-1670` | audit backup then stream DB file | audit can succeed while stream fails/corrupts | `audit(...); return fs.createReadStream(dbPath).pipe(...).pipe(res);` |

## 7. Missing Record Not Checked Before Use

| File:line | Lookup | Missing handling | Risk | Snippet |
|---|---|---|---|---|
| `backend/src/controllers/authController.js:573-585` | `storedToken` after reset-token update | not explicitly checked | if DB corruption or trigger removes row, `storedToken.user_id` crashes | `storedToken = db.prepare(...).get(tokenHash); db.prepare(...).run(..., storedToken.user_id);` |
| `backend/src/controllers/authController.js:626-639` | `storedToken` after verification-token update | not explicitly checked | same crash mode as reset password | `storedToken = db.prepare(...).get(tokenHash); db.prepare(...).run(verifiedAt, verifiedAt, storedToken.user_id);` |
| `backend/src/middleware/auth.js:39-44` | `JSON.parse(scopes)` on API token row | row checked, `scopes` content not validated | malformed DB scopes crash auth path | `scopes: JSON.parse(scopes || '[]')` |
| `backend/src/controllers/adminController.js:1831-1832` | API token `scopes` JSON | no try/catch | one malformed token row breaks entire token list | `rows.map((row) => ({ ...row, scopes: JSON.parse(row.scopes || '[]') }))` |
| `backend/src/controllers/adminController.js:1285` | account re-read after status update | not checked | if row disappears between update/read, response serializes `undefined` | `return res.json(serializeMoney(db.prepare('SELECT * FROM accounts...').get(...)))` |
| `backend/src/controllers/adminController.js:1399` | account re-read after correction | not checked | if row disappears, response contains `account: undefined` | `account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id)` |

## 8. Race Conditions That Can Corrupt Or Invalidate Data

| File:line | Race | Bad state | Snippet |
|---|---|---|---|
| `backend/src/controllers/budgetController.js:99-112` | two budget creates can both pass overlap check before either insert commits | overlapping budgets for same category/date range | `assertNoBudgetOverlap(...); db.prepare(... INSERT INTO budgets ...).run(budget);` |
| `backend/src/controllers/budgetController.js:190-199` | two budget updates can both pass overlap check | overlapping budgets after updates | `assertNoBudgetOverlap(...); UPDATE budgets SET ...` |
| `backend/src/controllers/authController.js:425-466` | two simultaneous refresh requests read same unrevoked token before either revokes | two valid successor refresh tokens in same family | `const storedToken = ...get(tokenHash); ... UPDATE refresh_tokens SET revoked = 1 ... INSERT INTO refresh_tokens ...` |
| `backend/src/controllers/adminController.js:638-650` | two admins deactivate/demote/delete around last-admin check | possible zero active admins | `if (!isActive && wouldRemoveLastActiveAdmin(user)) ... db.transaction(() => UPDATE users...)` |
| `backend/src/controllers/adminController.js:728-737` | role update last-admin check before transaction | possible zero active admins | `if (req.body.role !== 'admin' && wouldRemoveLastActiveAdmin(user)) ... UPDATE users SET role = ?` |
| `backend/src/controllers/adminController.js:791-847` | hard delete last-admin check before transaction | possible zero active admins | `if (wouldRemoveLastActiveAdmin(user)) ... DELETE FROM users WHERE id = ?` |
| `backend/src/controllers/categoryController.js:68-78` | two category creates compute same `maxOrder` | duplicate `sort_order`; unique index prevents same name only | `const maxOrder = ...MAX(sort_order)...; sort_order: maxOrder.max_order + 10` |
| `backend/src/controllers/adminController.js:1419-1435` | two default category creates compute same `maxOrder` | duplicate `sort_order` | `const maxOrder = ...MAX(sort_order)...; sort_order: Number(req.body.sort_order || maxOrder + 10)` |
| `backend/src/controllers/adminController.js:1357-1396` | balance correction derives balance before transaction | concurrent transaction can be overwritten by correction `SET balance = targetBalance` | `const derivedBalance = derivedAccountBalance(...); ... UPDATE accounts SET balance = ?` |
| `backend/src/controllers/accountController.js:184-194` | overdraft validation reads current balance before update | concurrent transaction can invalidate the check | `const current = db.prepare(...).get(...); ... UPDATE accounts SET ${setSql}` |
| `backend/src/controllers/adminController.js:1053-1131` | export streams each table without a DB snapshot transaction | export can mix rows from different moments | `streamJsonArray(...accounts...); streamJsonArray(...transactions...);` |
| `backend/src/controllers/adminController.js:1667-1670` | backup streams raw DB path under WAL mode | backup can miss WAL contents or capture inconsistent file state | `fs.createReadStream(dbPath).pipe(zlib.createGzip()).pipe(res)` |

## 9. 200/201 Responses After Partial Failure

| File:line | Success response | Partial failure | Snippet |
|---|---|---|---|
| `backend/src/controllers/adminController.js:778-785` | `200` reset password success | email delivery failed; response includes temp password and `delivery_failed` | `delivery = { channel: 'email', sent: false, error: 'delivery_failed' }; return res.json({ success: true, ... })` |
| `backend/src/controllers/transactionController.js:154-159` | transaction create/update remains success | budget overspend push failed | `void sendPushNotification(...).catch((pushError) => logger.warn(...));` |
| `backend/src/controllers/transactionController.js:237-245` | `201` transaction create | large transaction push failed | `void sendPushNotification(...).catch(...); return res.status(201)...` |
| `backend/src/controllers/authController.js:750-757` | `200` password changed | password-change push failed | `void sendPushNotification(...).catch(...); return res.status(200)...` |
| `backend/src/controllers/adminController.js:1778-1782` | `201` announcement created | one or all announcement pushes failed | `users.forEach(... sendPushNotification(...).catch(...)); return res.status(201)...` |
| `backend/src/controllers/authController.js:486-496` | `200` logout | refresh token update can affect `0` rows and still return success | `UPDATE refresh_tokens ... WHERE token_hash = ? AND user_id = ?; ... return res.status(200).json({ success: true });` |
| `backend/src/controllers/authController.js:804-812` | `200` notification settings | unsupported preference keys are ignored | `Object.keys(DEFAULT_PREFS).forEach(...); return getNotificationSettings(...)` |
| `backend/src/controllers/adminController.js:1546-1568` | `200` bulk user operation | missing requested user IDs are silently ignored | `return res.json({ success: true, action, affected: users.length });` |
| `backend/src/controllers/adminController.js:1053-1131` | possible `200` export stream | later stream/query failure after headers/body start | `res.write('{'); ... streamJsonArray(...);` |
| `backend/src/controllers/adminController.js:1667-1670` | possible `200` backup stream | stream error after headers begins | `return fs.createReadStream(dbPath).pipe(zlib.createGzip()).pipe(res);` |

## 10. Main Gotchas Ranked

1. **Budget overlap race can create contradictory budget data.** `backend/src/controllers/budgetController.js:99-112` and `190-199` do check-then-write without a DB constraint or transaction around the check.
2. **Refresh-token rotation is race-prone.** `backend/src/controllers/authController.js:425-466` can issue multiple valid successor refresh tokens from the same old token.
3. **Streaming backup is unsafe under WAL.** `backend/src/controllers/adminController.js:1667-1670` streams only `dbPath`; WAL contents can be missed. Use `db.backup()` to a temp artifact or SQLite backup API.
4. **Exports can return partial `200` responses.** `backend/src/controllers/adminController.js:1053-1131` writes headers/body before all DB reads are known to be safe.
5. **Audit writes often determine whether the client sees success, but not whether data changed.** Budget/category/account/admin token/webhook writes can commit, then audit failure returns 500.
6. **Email delivery is outside registration/password reset transactions.** Users/tokens are created, then delivery failure returns 503. This is intentional in places, but operationally surprising.
7. **Bulk admin user updates silently ignore missing IDs.** `backend/src/controllers/adminController.js:1546-1568` reports success for fewer users than requested.
8. **Logout does not verify refresh-token revocation.** `backend/src/controllers/authController.js:486-496` returns success even when `UPDATE refresh_tokens` changes zero rows.
9. **Malformed DB JSON can break admin/API-token flows.** API token `scopes` parsing is not guarded in `backend/src/middleware/auth.js:39-44` and `backend/src/controllers/adminController.js:1831-1832`.
10. **Mobile has several unhandled startup promises.** `mobile/App.tsx:92`, `101`, `143`, `195`, and `245` can produce unhandled rejections during bootstrap or resume.
