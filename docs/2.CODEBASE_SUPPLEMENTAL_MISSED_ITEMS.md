# FinanceApp Supplemental Audit: Missed Items Addendum

Date: 2026-05-10

This is an addendum to `docs/CODEBASE_TECHNICAL_AUDIT.md`. It focuses on areas that were not covered deeply enough in the first report: mobile local storage, offline replay, client-side money calculations, push/deep-link behavior, backup/export handling, operational jobs, and a few admin-facing flows.

Paths are relative to the repository root.

---

## 1. Mobile Local Storage And Device Security

### 1.1 Auth Tokens Are In Expo SecureStore, But Not Bound To Biometric Unlock

The app stores access tokens, refresh tokens, and the serialized user object in `expo-secure-store`.

```ts
// mobile/src/services/secureStorage.ts:1-19
1:import * as SecureStore from 'expo-secure-store';
2:import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '../constants';
...
15:export async function saveTokens(accessToken: string, refreshToken: string) {
16:  await Promise.all([
17:    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
18:    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
19:  ]);
```

```ts
// mobile/src/services/secureStorage.ts:31-55
31:export async function clearTokens() {
32:  await Promise.all([
33:    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
34:    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
35:    SecureStore.deleteItemAsync(USER_KEY),
36:  ]);
37:}
...
39:export async function saveUser(user: StoredUser) {
40:  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
41:}
...
49:  try {
50:    return JSON.parse(rawUser) as StoredUser;
51:  } catch {
52:    await SecureStore.deleteItemAsync(USER_KEY);
53:    return null;
54:  }
```

The biometric feature only stores a preference flag and then checks local authentication before allowing unlock. It does not configure SecureStore with biometric/keychain access-control options, so the stored tokens themselves are not cryptographically bound to biometric unlock.

```ts
// mobile/src/services/biometrics.ts:13-33
13:export async function setBiometricPreference(enabled: boolean) {
14:  await SecureStore.setItemAsync(BIOMETRIC_UNLOCK_KEY, enabled ? 'true' : 'false');
15:}
...
24:export async function authenticateWithBiometrics(promptMessage = 'Unlock FinanceApp') {
25:  const enabled = await getBiometricPreference();
26:  if (!enabled) return true;
27:
28:  const available = await canUseBiometricAuth();
29:  if (!available) return false;
30:
31:  const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
32:  return result.success;
33:}
```

**Missed risk:** A user may believe biometric unlock protects the tokens at rest. In the current implementation, biometrics gates the app UI, not SecureStore token retrieval itself.

### 1.2 Session Auto-Lock Has A `Never` Option

```ts
// mobile/src/services/sessionLock.ts:3-13
3:export type AutoLockPreference = '1 min' | '5 min' | '15 min' | 'Never';
...
5:const AUTO_LOCK_MS: Record<AutoLockPreference, number | null> = {
6:  '1 min': 60 * 1000,
7:  '5 min': 5 * 60 * 1000,
8:  '15 min': 15 * 60 * 1000,
9:  Never: null,
10:};
...
13:const DEFAULT_AUTO_LOCK: AutoLockPreference = '5 min';
```

**Missed risk:** This is legitimate as a user preference, but it is a security downgrade path. For a finance app, consider whether `Never` should be allowed in production builds or behind explicit warning/biometric requirement.

### 1.3 Root/Jailbreak Detection Is Really Emulator Detection

```ts
// mobile/src/services/deviceSecurity.ts:17-30
17:export async function detectRootedOrJailbrokenDevice(): Promise<boolean> {
18:  try {
19:    const suspicious = Platform.OS !== 'web' && Device?.isDevice === false;
20:    if (suspicious) {
21:      await reportClientError({
22:        message: 'Potential insecure device detected',
23:        platform: Platform.OS,
24:        type: 'security',
25:        metadata: { isDevice: Device?.isDevice },
26:      });
27:    }
28:    return Boolean(suspicious);
29:  } catch {
30:    return false;
```

**Missed risk:** `Device.isDevice === false` flags simulators/emulators. It does not meaningfully detect rooted Android or jailbroken iOS devices.

---

## 2. Offline Queue And Replay Behavior

### 2.1 Offline Queue Is Stored Unencrypted In AsyncStorage

Queued mutations include method, URL, request body, and creation timestamp. The entire queue is stored as JSON under `offlineQueue`.

```ts
// mobile/src/utils/offlineQueue.ts:1-12
1:import AsyncStorage from '@react-native-async-storage/async-storage';
...
3:export type QueuedMutation = {
4:  id: string;
5:  method: 'post' | 'put' | 'patch' | 'delete';
6:  url: string;
7:  data?: unknown;
8:  createdAt: string;
9:  description?: string;
10:};
11:
12:const STORAGE_KEY = 'offlineQueue';
```

```ts
// mobile/src/utils/offlineQueue.ts:22-39
22:async function saveQueue(queue: QueuedMutation[]) {
23:  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
24:}
...
26:export async function getQueue(): Promise<QueuedMutation[]> {
27:  const raw = await AsyncStorage.getItem(STORAGE_KEY);
28:  if (!raw) return [];
29:
30:  try {
31:    const parsed = JSON.parse(raw);
32:    return Array.isArray(parsed) ? parsed : [];
33:  } catch {
34:    await AsyncStorage.removeItem(STORAGE_KEY);
35:    return [];
36:  }
37:}
```

**Missed risk:** Any queued transaction/account/budget mutation body may sit in unencrypted AsyncStorage. This is especially important because finance data may include descriptions, notes, amounts, and category/account IDs.

### 2.2 Queue IDs Use `Math.random`

```ts
// mobile/src/utils/offlineQueue.ts:14-20
14:function createId() {
15:  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
16:}
```

**Missed risk:** This is not used as an authentication token, so it is not a critical crypto issue. It can still collide in theory and is not a durable idempotency key for backend replay.

### 2.3 Replay Stops On First Failed Mutation And Does Not Continue Later Queue Items

```ts
// mobile/src/hooks/useOfflineQueue.ts:23-34
23:  const processOfflineQueue = useCallback(async () => {
24:    const queue = await getQueue();
25:    if (!queue.length) return 0;
26:
27:    for (const item of queue) {
28:      await replayMutation(item);
29:      await dequeue(item.id);
30:    }
31:
32:    await Promise.all([dispatch(fetchAccounts()).unwrap(), dispatch(fetchTransactions()).unwrap(), dispatch(fetchBudgets()).unwrap()]);
33:    return queue.length;
34:  }, [dispatch]);
```

**Missed behavior:** If item 2 fails after item 1 succeeds, item 1 is removed, item 2 remains, and items after item 2 are not replayed. That prevents out-of-order mutations, but it can also leave unrelated later work stuck behind one bad request.

### 2.4 API Client Blocks Mutating Calls When Offline

```ts
// mobile/src/services/api.ts:64-76
64:api.interceptors.request.use(async (config) => {
65:  const method = String(config.method || 'get').toLowerCase();
66:  if (!pinningConfigured && process.env.NODE_ENV !== 'production') {
67:    config.headers['X-Cert-Pinning-Mode'] = 'development-fallback';
68:  }
69:  if (MUTATING_METHODS.has(method) && store.getState().ui.isOnline === false) {
70:    return Promise.reject(new Error('No internet connection. Changes are disabled while offline.'));
71:  }
72:
73:  const { accessToken } = await getTokens();
74:
75:  if (accessToken) {
76:    config.headers.Authorization = `Bearer ${accessToken}`;
```

**Interaction to document:** This interceptor rejects mutating calls while offline. Any screen that wants offline mutation support must enqueue instead of calling `api.post/put/delete` directly while offline.

---

## 3. Network, TLS Pinning, And Token Refresh Client Behavior

### 3.1 API Base URL Defaults To Plain HTTP In Development

```ts
// mobile/src/constants/index.ts:3-16
3:export function getDefaultApiBaseUrl() {
4:  const scriptURL = NativeModules.SourceCode?.scriptURL;
5:  const match = typeof scriptURL === 'string' ? scriptURL.match(/^[^:]+:\/\/([^/:]+)/) : null;
6:  const devHost = match?.[1];
...
8:  if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') {
9:    return `http://${devHost}:3000`;
10:  }
...
12:  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';
13:  return 'http://localhost:3000';
14:}
15:
16:export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || getDefaultApiBaseUrl();
```

**Missed risk:** Production is expected to supply `EXPO_PUBLIC_API_BASE_URL`, but the fallback is HTTP. A misconfigured production build could point at insecure transport.

### 3.2 TLS Pinning Is Optional And Failure Only Warns In Production

```ts
// mobile/src/services/api.ts:51-61
51:try {
52:  const certHash = process.env.EXPO_PUBLIC_API_CERT_HASH;
53:  const CertificatePinning = require('expo-certificate-pinning');
54:  if (certHash && CertificatePinning?.initializeSslPinning) {
55:    CertificatePinning.initializeSslPinning({ [API_BASE_URL]: { publicKeyHashes: [certHash] } });
56:    pinningConfigured = true;
57:  }
58:} catch {
59:  if (process.env.NODE_ENV === 'production') {
60:    console.warn('SSL certificate pinning is not active. Install/configure expo-certificate-pinning for production builds.');
61:  }
```

**Missed risk:** TLS pinning is not enforced. If the package is missing or init fails, production only logs a warning.

### 3.3 401 Refresh Queue Clears Tokens On Refresh Failure

```ts
// mobile/src/services/api.ts:101-143
101:    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
102:      return Promise.reject(error);
103:    }
...
119:      const { refreshToken } = await getTokens();
120:
121:      if (!refreshToken) {
122:        throw new Error('Missing refresh token');
123:      }
...
131:      const newAccessToken = response.data.accessToken;
132:      const nextRefreshToken = response.data.refreshToken || refreshToken;
133:      await saveTokens(newAccessToken, nextRefreshToken);
134:      store.dispatch(authActions.setAccessToken(newAccessToken));
...
139:    } catch (refreshError) {
140:      processQueue(refreshError, null);
141:      await clearTokens();
142:      store.dispatch(authActions.logout());
143:      return Promise.reject(refreshError);
```

**Missed behavior:** One refresh failure logs the mobile app out locally and rejects all queued 401 retries. That is appropriate for invalid/revoked tokens, but transient refresh endpoint failure can also force logout.

---

## 4. Push Notifications, Deep Links, And Notification Calculations

### 4.1 Push Token Registration Happens After Login

```ts
// mobile/src/services/pushNotifications.ts:39-54
39:export async function registerPushNotificationsAfterLogin() {
40:  const Notifications = getNotifications();
41:  if (!Notifications || Platform.OS === 'web') return;
42:  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') return;
43:
44:  const permissions = await Notifications.getPermissionsAsync();
45:  const finalPermission = permissions.status === 'granted' ? permissions : await Notifications.requestPermissionsAsync();
46:  if (finalPermission.status !== 'granted') return;
...
50:  const token = tokenResponse.data;
51:  if (!token) return;
52:
53:  await api.post('/api/auth/push-token', { token, platform: Platform.OS });
54:}
```

**Missed data path:** Expo push tokens are user-linked data. They should be included in privacy/export/deletion analysis.

### 4.2 Backend Sends Pushes Through Expo And Deletes Invalid Tokens

```js
// backend/src/utils/pushNotifications.js:41-76
41:  const tokens = db.prepare('SELECT id, token FROM push_tokens WHERE user_id = ?').all(userId);
42:  if (!tokens.length) return { sent: 0, tickets: [] };
...
52:  const response = await fetch(EXPO_PUSH_URL, {
53:    method: 'POST',
54:    headers: {
55:      Accept: 'application/json',
56:      'Content-Type': 'application/json',
57:    },
58:    body: JSON.stringify(messages),
59:  });
...
67:  tickets.forEach((ticket, index) => {
68:    if (ticket?.status !== 'error') return;
69:    const token = tokens[index];
70:    logger.warn('Expo push ticket error', { userId, tokenId: token?.id, details: ticket.details, message: ticket.message });
71:    if (ticket.details?.error === 'DeviceNotRegistered' && token) {
72:      db.prepare('DELETE FROM push_tokens WHERE id = ?').run(token.id);
73:    }
74:  });
```

**Missed risk:** Push delivery sends notification content and metadata to Expo. The backend removes invalid tokens, but only when Expo returns `DeviceNotRegistered` in a ticket.

### 4.3 Notification Preference Defaults Are Server-Side

```js
// backend/src/utils/pushNotifications.js:5-22
5:const DEFAULT_PREFS = {
6:  budget_overspend: true,
7:  large_transaction: true,
8:  recurring_transaction: true,
9:  admin_announcement: true,
10:  password_changed: true,
11:  unknown_device_login: true,
12:};
...
18:function preferenceEnabled(userId, type) {
19:  const key = Object.prototype.hasOwnProperty.call(DEFAULT_PREFS, type) ? type : null;
20:  if (!key) return true;
21:  const row = db.prepare('SELECT enabled FROM notification_preferences WHERE user_id = ? AND type = ?').get(userId, key);
22:  return row ? Boolean(row.enabled) : DEFAULT_PREFS[key];
```

**Missed behavior:** Unknown notification types default to enabled because `!key` returns `true`.

### 4.4 Admin Announcements Fan Out Pushes Without Awaiting Delivery

```js
// backend/src/controllers/adminController.js:1794-1806
1794:    db.transaction(() => {
1795:      db.prepare(`
1796:        INSERT INTO announcements (id, title, body, is_active, starts_at, ends_at, created_at, updated_at, created_by)
1797:        VALUES (@id, @title, @body, @is_active, @starts_at, @ends_at, @created_at, @updated_at, @created_by)
1798:      `).run(row);
1799:      audit(req, 'ADMIN_CREATED_ANNOUNCEMENT', 'announcement', row.id, null, row);
1800:    })();
1801:    const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all();
1802:    users.forEach((user) => {
1803:      void sendPushNotification(user.id, row.title, row.body, { type: 'admin_announcement', announcementId: row.id })
1804:        .catch((pushError) => logger.warn('Announcement push failed', { userId: user.id, error: pushError.message }));
1805:    });
1806:    return res.status(201).json(serializeMoney(row));
```

**Missed behavior:** Announcement creation succeeds and returns before push delivery completes. Push failure is logged but not reflected in the admin response.

### 4.5 Deep Link Token Parsing Only Checks Length

```ts
// mobile/src/navigation/deepLinks.ts:6-26
6:function cleanToken(value: string | null | undefined) {
7:  const token = value ? decodeURIComponent(value).trim() : '';
8:  return token.length >= 32 ? token : null;
9:}
...
11:export function parseFinanceDeepLink(rawUrl: string): ParsedDeepLink | null {
12:  try {
13:    const url = new URL(rawUrl);
14:    const firstPathSegment = url.pathname.replace(/^\/+/, '').split('/')[0] || '';
15:    const hostRoute = url.hostname && url.hostname !== 'auth' ? url.hostname : '';
16:    const route = hostRoute || firstPathSegment;
17:    const token = cleanToken(url.searchParams.get('token') || url.pathname.split('/').filter(Boolean).pop());
18:
19:    if (!token) return null;
20:
21:    if (route === 'verify-email') return { type: 'verify-email', token };
22:    if (route === 'reset-password') return { type: 'reset-password', token };
23:    if (route === 'verify-new-email') return { type: 'verify-new-email', token };
24:    return null;
25:  } catch {
26:    return null;
```

**Missed risk:** The parsing is route-aware, but token acceptance is only `length >= 32`. The backend ultimately validates token hashes, but the client will navigate on any sufficiently long string.

### 4.6 Frontend Notification Money Rules Duplicate Business Logic

```ts
// mobile/src/utils/notifications.ts:36-42
36:const LARGE_TRANSACTION_THRESHOLD = 500;
37:const LARGE_TRANSACTION_WINDOW_DAYS = 14;
38:const RECURRING_WINDOW_DAYS = 7;
...
40:function formatCurrency(amount: number) {
41:  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
42:}
```

```ts
// mobile/src/utils/notifications.ts:73-98
73:function budgetNotifications(budgets: Budget[]): NotificationItem[] {
74:  return budgets
75:    .filter((budget) => Number(budget.amount || 0) > 0)
76:    .map((budget) => {
77:      const amount = Number(budget.amount || 0);
78:      const spent = Number(budget.current_spending || 0);
79:      const overage = spent - amount;
80:      const ratio = amount > 0 ? spent / amount : 0;
81:      return { budget, amount, spent, overage, ratio };
82:    })
83:    .filter((item) => item.overage > 0)
```

**Missed risk:** Mobile notification thresholds and USD formatting are client-side constants. They may drift from backend reporting, account currencies, or future server-side notification rules.

---

## 5. Client-Side Money Presentation And Calculation Drift

### 5.1 Multiple Screens Hardcode USD And Round To Whole Dollars

```ts
// mobile/src/screens/transactions/TransactionsScreen.tsx:65-66
65:function formatCurrency(amount: number) {
66:  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
```

```ts
// mobile/src/components/common/BudgetProgressCard.tsx:11-12
11:function formatCurrency(amount: number) {
12:  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
```

```ts
// mobile/src/screens/reports/ReportsScreen.tsx:71-72
71:function formatCurrency(amount: number) {
72:  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
```

**Missed risk:** Backend stores money as cents and serializes amounts as decimal units, while several mobile displays round to whole dollars. This can hide cents and produce visual mismatch against exact backend/export values.

### 5.2 Account Card Uses `current_balance` With Fallback To Stored `balance`

```ts
// mobile/src/components/common/AccountCard.tsx:24-25
24:function formatCurrency(amount: number, currency = 'USD') {
25:  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount || 0);
```

```ts
// mobile/src/components/common/AccountCard.tsx:44-59
44:  const accent = account.color || theme.colors.accent;
45:  const balance = account.current_balance ?? account.balance ?? 0;
46:  const isNegative = Number(balance) < 0;
...
59:        <Text style={[styles.balance, isNegative && styles.negativeBalance]} numberOfLines={1}>{formatCurrency(balance, account.currency)}</Text>
```

**Missed behavior:** The UI intentionally prefers calculated `current_balance`, then falls back to stored `balance`. If an endpoint omits `current_balance`, the same component can show a different concept.

### 5.3 Profile Net Worth Uses Same Fallback

```ts
// mobile/src/screens/profile/ProfileScreen.tsx:25-29
25:  const accounts = useAppSelector((state) => state.accounts.accounts);
26:  const transactions = useAppSelector((state) => state.transactions.transactions);
27:  const budgets = useAppSelector((state) => state.budgets.budgets);
28:  const [refreshing, setRefreshing] = useState(false);
29:  const totalBalance = useMemo(() => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0), [accounts]);
```

```ts
// mobile/src/screens/profile/ProfileScreen.tsx:91-93
91:        <View style={styles.summaryCard}>
92:          <Text style={styles.summaryLabel}>Total Balance</Text>
93:          <Text style={styles.summaryValue}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalBalance)}</Text>
```

**Missed risk:** This mixes account currencies into a single USD display without conversion. It also inherits `current_balance` vs `balance` fallback semantics.

### 5.4 Budget Percent And Remaining Logic Exists In Multiple Places

```ts
// mobile/src/components/common/BudgetProgressCard.tsx:17-23
17:  const spent = Number(budget.current_spending || 0);
18:  const amount = Number(budget.amount || 0);
19:  const ratio = amount > 0 ? spent / amount : 0;
20:  const progress = Math.min(ratio, 1);
21:  const isOver = ratio > 1;
22:  const overage = Math.max(spent - amount, 0);
23:  const color = isOver ? theme.colors.danger : ratio > 0.82 ? theme.colors.warning : theme.colors.success;
```

```ts
// mobile/src/screens/budget/BudgetDetailScreen.tsx:84-88
84:  const amount = Number(budget?.amount || 0);
85:  const spent = Number(budget?.current_spending || 0);
86:  const remaining = Number(budget?.remaining ?? amount - spent);
87:  const ratio = (Number.isFinite(spent) && Number.isFinite(amount) && amount > 0) ? spent / amount : 0;
88:  const color = category?.color || budget?.category_color || progressColor(ratio);
```

```ts
// mobile/src/screens/budget/BudgetsScreen.tsx:306-310
306:  const spent = Number(budget.current_spending || 0);
307:  const amount = Number(budget.amount || 0);
308:  const ratio = amount > 0 ? spent / amount : 0;
309:  const remaining = amount - spent;
310:  const color = progressColor(ratio);
```

**Missed risk:** Budget formulas are duplicated client-side. `BudgetDetailScreen` has extra `Number.isFinite` protection; other components do not. If API data contains stringy, null, or malformed amounts, screens may diverge.

### 5.5 Reports Recompute Income, Expense, Net On The Client

```ts
// mobile/src/screens/reports/ReportsScreen.tsx:266-272
266:  const categoryTotals = useMemo(() => buildCategoryTotals(transactions), [transactions]);
267:  const barData = useMemo(() => buildBarData(transactions, period), [transactions, period]);
268:  const trendData = useMemo(() => buildTrendData(trendTransactions), [trendTransactions]);
269:  const totalSpending = categoryTotals.reduce((sum, item) => sum + item.value, 0);
270:  const totalIncome = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
271:  const totalExpense = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
272:  const net = totalIncome - totalExpense;
```

**Missed risk:** Backend reports also compute these values. The client recomputation can diverge from backend report endpoints if filtering, excluded deleted/admin-deleted rows, date boundaries, or transfer treatment differ.

---

## 6. Export, Sharing, And Local File Data Paths

### 6.1 User CSV Export Writes Finance Data To Local Document Storage, Then Shares It

```ts
// mobile/src/screens/profile/SettingsScreen.tsx:174-194
174:  const exportData = async () => {
175:    setExporting(true);
176:    try {
177:      const [accountResponse, transactionResponse, budgetResponse, categoryResponse] = await Promise.all([
178:        api.get<ListPayload<Account>>('/api/accounts', { params: { page: 1, limit: 200 } }),
179:        api.get<{ data: Transaction[] }>('/api/transactions', { params: { page: 1, limit: 1000 } }),
...
189:      const filename = `financeapp-export-${new Date().toISOString().slice(0, 10)}.csv`;
190:      const uri = await writeTextFile(filename, csv, 'text/csv;charset=utf-8');
191:      if (uri) await shareFile(uri, 'text/csv');
192:      showToast({ type: 'success', text1: 'Export ready', text2: Platform.OS === 'web' ? filename : 'Choose where to save or share it.' });
193:    } catch (error) {
194:      showToast({ type: 'error', text1: 'Export failed', text2: error instanceof Error ? error.message : 'Please try again.' });
```

```ts
// mobile/src/screens/profile/SettingsScreen.tsx:51-67
51:  if (Platform.OS === 'web') {
52:    downloadWebFile(contents, filename, mimeType);
53:    return null;
54:  }
55:
56:  const file = new FileSystem.File(FileSystem.Paths.document, filename);
57:  if (file.exists) file.delete();
58:  file.create();
59:  file.write(contents);
60:  return file.uri;
...
63:async function shareFile(uri: string, mimeType: string) {
64:  if (!(await Sharing.isAvailableAsync())) {
65:    throw new Error('Sharing is not available on this device');
66:  }
67:  await Sharing.shareAsync(uri, { mimeType });
```

**Missed data handling:** Export files are generated locally and shared through the OS share sheet. There is no cleanup of exported files after sharing in this function.

### 6.2 User JSON Data Export Uses `/api/auth/data`

```ts
// mobile/src/screens/profile/SettingsScreen.tsx:200-210
200:  const exportMyData = async () => {
201:    setExportingJson(true);
202:    try {
203:      const response = await api.get<Record<string, unknown>>('/api/auth/data');
204:      const json = JSON.stringify(response.data, null, 2);
205:      const filename = `financeapp-data-${new Date().toISOString().slice(0, 10)}.json`;
206:      const uri = await writeTextFile(filename, json, 'application/json;charset=utf-8');
207:      if (uri) await shareFile(uri, 'application/json');
208:      showToast({ type: 'success', text1: 'Export ready', text2: Platform.OS === 'web' ? filename : 'Choose where to save or share it.' });
209:    } catch (error) {
210:      showToast({ type: 'error', text1: 'Export failed', text2: error instanceof Error ? error.message : 'Please try again.' });
```

**Missed privacy path:** This is a full account data export path and should be considered a high-sensitivity local file operation.

### 6.3 Admin Backup Download Claims Gzip But Backend Streams Raw SQLite

Backend:

```js
// backend/src/controllers/adminController.js:1679-1691
1679:async function downloadDatabaseBackup(req, res, next) {
1680:  try {
1681:    audit(req, 'ADMIN_DOWNLOADED_DATABASE_BACKUP', 'database', 'main', null, { db_size_mb: getDbSizeMb() });
1682:    const tmpPath = path.join(os.tmpdir(), `backup-${Date.now()}.db`);
1683:    await db.backup(tmpPath);
1684:    res.setHeader('Content-Type', 'application/gzip');
1685:    res.setHeader('Content-Disposition', `attachment; filename="financeapp-${Date.now()}.sqlite.gz"`);
1686:    const stream = fs.createReadStream(tmpPath);
1687:    stream.on('end', () => fs.unlink(tmpPath, () => {}));
1688:    stream.on('error', (err) => {
1689:      logger.error('Backup stream error', { error: err.message });
1690:      fs.unlink(tmpPath, () => {});
1691:    });
```

Client:

```ts
// mobile/src/screens/admin/AdminToolsScreen.tsx:246-263
246:  async function downloadBackup() {
247:    await runAction('Database Backup', async () => {
...
257:      const file = new FileSystem.File(FileSystem.Paths.document, filename);
258:      const downloaded = await FileSystem.File.downloadFileAsync(`${API_BASE_URL}/api/admin/database/backup`, file, {
259:        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
260:        idempotent: true,
261:      });
262:      await shareFile(downloaded.uri, 'application/gzip');
263:      setResult({ title: 'Database Backup Ready', summary: 'A compressed database backup was prepared for sharing.', body: filename });
```

**Missed bug:** The backend imports `zlib` but does not gzip the backup stream here. The response headers and mobile UI say gzip/compressed, but the payload is a raw SQLite database file with a `.sqlite.gz` filename.

---

## 7. Backend Operational Jobs And Backups

### 7.1 Server Starts Cleanup, Recurring, And Backup Timers

```js
// backend/src/server.js:92-107
92:const REFRESH_TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
93:const DELETED_USER_ARCHIVE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
94:const RECURRING_TRANSACTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
95:const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;
...
107:const refreshTokenCleanupTimer = setInterval(() => {
```

```js
// backend/src/server.js:131-166
131:try {
132:  processRecurringTransactions();
133:} catch (error) {
134:  logger.error('Recurring transaction processor failed', { error: error.message });
135:}
...
137:const recurringTransactionTimer = setInterval(() => {
138:  try {
139:    processRecurringTransactions();
140:  } catch (error) {
141:    logger.error('Recurring transaction processor failed', { error: error.message });
142:  }
143:}, RECURRING_TRANSACTION_INTERVAL_MS);
...
153:async function runBackupIfDue() {
154:  if (!backupDue()) return;
155:  try {
156:    await runDatabaseBackup();
157:    lastBackupDate = new Date().toISOString().slice(0, 10);
...
164:const backupTimer = setInterval(() => {
165:  void runBackupIfDue();
166:}, BACKUP_CHECK_INTERVAL_MS);
```

**Missed behavior:** These jobs are in-process timers. In multi-instance deployment, each instance would run its own cleanup/recurring/backup schedule unless externally constrained.

### 7.2 Backup Retention Deletes Matching Files Synchronously

```js
// backend/src/utils/backup.js:17-34
17:async function runDatabaseBackup() {
18:  const dir = backupDir();
19:  fs.mkdirSync(dir, { recursive: true });
20:  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
21:  const target = path.join(dir, `financeapp-${timestamp}.sqlite`);
22:  await db.backup(target);
23:  lastBackupTimestamp = new Date().toISOString();
24:
25:  const cutoff = Date.now() - retainDays() * 24 * 60 * 60 * 1000;
26:  for (const name of fs.readdirSync(dir)) {
27:    if (!/^financeapp-.*\.sqlite$/.test(name)) continue;
28:    const filePath = path.join(dir, name);
29:    const stat = fs.statSync(filePath);
30:    if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath);
31:  }
32:
33:  logger.info('SQLite backup completed', { target, lastBackupTimestamp });
34:  return { target, timestamp: lastBackupTimestamp };
```

**Missed risk:** Backup retention only deletes files matching `financeapp-*.sqlite`. Admin-downloaded temp backups are separate. Synchronous filesystem calls can block the event loop during backup cleanup.

### 7.3 Backup Directory Is Relative To Backend Root, Not CWD

```js
// backend/src/utils/backup.js:8-14
8:function backupDir() {
9:  return path.resolve(__dirname, '..', '..', process.env.BACKUP_DIR || './backups');
10:}
...
12:function retainDays() {
13:  const days = Number(process.env.BACKUP_RETAIN_DAYS || 7);
14:  return Number.isFinite(days) && days > 0 ? days : 7;
```

**Missed behavior:** `BACKUP_DIR=./backups` resolves relative to the backend root path calculation, not necessarily the shell CWD.

---

## 8. Admin Webhooks And External Delivery

### 8.1 Admin Webhooks Are Configurable And Secrets Are Redacted On Read

```js
// backend/src/controllers/adminController.js:1929-1937
1929:function listWebhooks(req, res, next) {
1930:  try {
1931:    const { page, limit, offset } = pagination(req);
1932:    const total = db.prepare('SELECT COUNT(*) AS count FROM webhooks').get().count;
1933:    const rows = db.prepare(`
1934:      SELECT w.*, (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS delivery_count
1935:      FROM webhooks w ORDER BY w.created_at DESC LIMIT ? OFFSET ?
1936:    `).all(limit, offset);
1937:    return res.json({ data: serializeMoney(rows.map((row) => ({ ...row, secret: row.secret ? '[configured]' : null }))), pagination: paginationMeta(page, limit, total) });
```

```js
// backend/src/controllers/adminController.js:1957-1964
1957:    db.transaction(() => {
1958:      db.prepare(`
1959:        INSERT INTO webhooks (id, name, url, event, is_active, secret, created_at, updated_at, created_by)
1960:        VALUES (@id, @name, @url, @event, @is_active, @secret, @created_at, @updated_at, @created_by)
1961:      `).run(row);
1962:      audit(req, 'ADMIN_CREATED_WEBHOOK', 'webhook', row.id, null, { ...row, secret: '[redacted]' });
1963:    })();
1964:    return res.status(201).json(serializeMoney({ ...row, secret: '[configured]' }));
```

### 8.2 Webhook Update Encrypts Secret When Provided

```js
// backend/src/controllers/adminController.js:1970-1996
1970:function updateWebhook(req, res, next) {
1971:  try {
1972:    const old = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
1973:    if (!old) return res.status(404).json({ error: 'Webhook not found' });
...
1986:      updates.secret = updates.secret ? encryptSecret(updates.secret) : null;
1987:    }
1988:    updates.updated_at = nowIso();
1989:    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
1990:    let row;
1991:    db.transaction(() => {
1992:      db.prepare(`UPDATE webhooks SET ${setSql} WHERE id = @id`).run({ ...updates, id: req.params.id });
1993:      row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
1994:      audit(req, 'ADMIN_UPDATED_WEBHOOK', 'webhook', req.params.id, { ...old, secret: '[redacted]' }, { ...row, secret: '[redacted]' });
1995:    })();
1996:    return res.json(serializeMoney({ ...row, secret: row.secret ? '[configured]' : null }));
```

**Missed observation:** The code exposes webhook CRUD and delivery history, but this scan did not find a general event dispatcher that records `webhook_deliveries` for app events. Webhooks may be a partially implemented admin feature unless implemented elsewhere outside these scanned paths.

### 8.3 Password Reset And Email Verification Delivery Can Send Raw Tokens To Webhooks

```js
// backend/src/utils/passwordResetDelivery.js:154-164
154:async function deliverViaWebhook({ webhookUrl, email, token, actionUrl, fallbackUrl, expiresAt, tokenFieldName, urlFieldName, label }) {
155:  assertSecureDeliveryUrl(webhookUrl, label);
156:  const response = await fetch(webhookUrl, {
157:    method: 'POST',
158:    headers: { 'Content-Type': 'application/json' },
159:    body: JSON.stringify({ email, [tokenFieldName]: token, [urlFieldName]: actionUrl, fallbackUrl, expiresAt }),
160:  });
161:
162:  if (!response.ok) {
163:    throw new Error(`${label} webhook failed with status ${response.status}`);
164:  }
```

```js
// backend/src/utils/passwordResetDelivery.js:214-227
214:  if (process.env.PASSWORD_RESET_WEBHOOK_URL) {
215:    await deliverViaWebhook({
216:      webhookUrl: process.env.PASSWORD_RESET_WEBHOOK_URL,
217:      email,
218:      token,
219:      actionUrl: resetUrl,
220:      fallbackUrl,
221:      expiresAt,
222:      tokenFieldName: 'token',
223:      urlFieldName: 'resetUrl',
224:      label: 'Password reset',
225:    });
226:    logger.info('Password reset token delivered via webhook', { email: maskEmail(email), expiresAt });
227:    return;
```

**Missed data handling:** Delivery webhooks intentionally receive raw password reset/email verification tokens. The URL safety checks help, but the receiving system becomes part of the auth trust boundary.

---

## 9. Client Error Reporting And Log Sensitivity

### 9.1 Client Error Endpoint Accepts Unauthenticated Reports

```js
// backend/src/app.js:172-187
172:app.post('/api/client-error', clientErrorLimiter, (req, res) => {
173:  const body = req.body || {};
174:  logger.error('Client-side error reported', {
175:    requestId: req.id,
176:    ip: req.ip,
177:    message: String(body.message || 'Client error').slice(0, 500),
178:    stack: body.stack ? String(body.stack).slice(0, 2000) : null,
179:    screen: body.screen ? String(body.screen).slice(0, 100) : null,
180:    platform: body.platform ? String(body.platform).slice(0, 50) : null,
181:    type: body.type ? String(body.type).slice(0, 50) : 'client',
182:    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
183:  });
184:  if (body.type === 'security') {
185:    recordSecurityEvent(req, [], 'SECURITY_CLIENT_EVENT', { message: body.message, metadata: body.metadata });
186:  }
187:  res.status(202).json({ success: true });
```

```ts
// mobile/src/services/clientErrors.ts:14-19
14:export async function reportClientError(payload: ClientErrorPayload): Promise<void> {
15:  try {
16:    await axios.post(`${API_BASE_URL}/api/client-error`, payload, { timeout: 5000 });
17:  } catch {
18:    // Error reporting must never create another user-visible failure.
19:  }
```

**Missed risk:** The endpoint is rate-limited but unauthenticated. It logs raw client-provided `metadata` if it is an object.

### 9.2 ErrorBoundary Sends Stack And Component Stack To Backend

```tsx
// mobile/src/components/common/ErrorBoundary.tsx:16-23
16:  componentDidCatch(error: Error, info: React.ErrorInfo) {
17:    console.error('FinanceApp UI crash', error, info.componentStack);
18:    void reportClientError({
19:      message: error.message,
20:      stack: `${error.stack || ''}\n${info.componentStack || ''}`.trim(),
21:      screen: this.props.screen || 'unknown',
22:      platform: 'react-native',
23:    });
```

**Missed privacy/logging point:** UI stack traces can contain component names and possibly error messages derived from user data. The backend truncates them, but does not sanitize contents.

---

## 10. Environment And Dependency Notes That Should Be In The Main Report

### 10.1 Backend Environment Validation Exists

```js
// backend/src/server.js:21-39
21:  const errors = [];
22:  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_PATH', 'PORT', 'NODE_ENV', 'REQUIRE_CSRF', 'DELETED_USER_ARCHIVE_DAYS'];
23:  required.forEach((name) => {
24:    if (!process.env[name]) errors.push(`${name} is required`);
25:  });
26:
27:  if (process.env.JWT_SECRET) {
28:    try {
29:      assertJwtSecret(process.env.JWT_SECRET);
30:    } catch (error) {
31:      errors.push(error.message);
32:    }
33:  }
...
35:  if (process.env.JWT_REFRESH_SECRET && Buffer.byteLength(process.env.JWT_REFRESH_SECRET, 'utf8') < 32) {
36:    errors.push('JWT_REFRESH_SECRET must be at least 32 bytes of high-entropy data');
37:  }
38:
39:  if (!['development', 'test', 'production'].includes(process.env.NODE_ENV)) {
```

### 10.2 README Explicitly Says TLS Termination Is External

```md
// README.md:123-133
123:- All financial APIs require authentication and enforce user ownership.
124:- Admin APIs require both authentication and the `admin` role.
125:- Login lockout protects accounts after repeated failures.
126:- Email verification and password reset links use random single-use tokens; only token hashes are stored server-side.
127:- SMTP delivery requires TLS by default, and email/webhook delivery failures are reported instead of silently pretending the email was sent.
128:- Helmet, CORS allowlists, HPP protection, compression, request size limits, and input validation are enabled.
129:- Audit logs record sensitive account, auth, transaction, and admin actions.
130:- Production error responses avoid exposing stack traces.
131:- Production deployments must terminate TLS before traffic reaches Express. Run the API behind a TLS-terminating reverse proxy, forward `X-Forwarded-Proto: https`, and set `TRUST_PROXY_HOPS` to the exact proxy hop count. The backend logs a production warning when HTTPS is not detected.
132:- CSRF protection is enabled by default for browser-style state-changing requests using a per-session double-submit cookie. Native mobile API calls use Bearer tokens and are not treated as cookie-authenticated browser requests.
133:- Admin webhook URLs must use HTTPS and cannot point to localhost or private network ranges. Webhook secrets are encrypted before they are stored in SQLite.
```

**Missed ops point:** Express itself does not enforce HTTPS redirection. Deployment security depends on a correctly configured reverse proxy and `TRUST_PROXY_HOPS`.

### 10.3 Local Dependency Inventory

```json
// backend/package.json:20-38
20:    "bcryptjs": "^3.0.3",
21:    "better-sqlite3": "^12.9.0",
22:    "compression": "^1.8.1",
23:    "cors": "^2.8.6",
24:    "dotenv": "^17.4.2",
25:    "express": "^4.22.1",
26:    "express-mongo-sanitize": "^2.2.0",
27:    "express-rate-limit": "^8.4.1",
28:    "express-validator": "^7.3.2",
29:    "helmet": "^8.1.0",
30:    "hpp": "^0.2.3",
31:    "jsonwebtoken": "^9.0.3",
32:    "morgan": "^1.10.1",
33:    "nodemailer": "^8.0.7",
34:    "uuid": "^14.0.0",
35:    "swagger-jsdoc": "^6.2.8",
36:    "swagger-ui-express": "^5.0.1",
37:    "winston": "^3.19.0",
38:    "winston-daily-rotate-file": "^5.0.0"
```

```json
// mobile/package.json:24-53
24:    "axios": "^1.15.2",
25:    "date-fns": "^4.1.0",
26:    "expo": "~54.0.33",
27:    "expo-blur": "~15.0.8",
28:    "expo-constants": "~18.0.10",
29:    "expo-device": "~8.0.10",
30:    "expo-file-system": "~19.0.22",
31:    "expo-linear-gradient": "~15.0.8",
32:    "expo-local-authentication": "~17.0.8",
33:    "expo-notifications": "~0.32.12",
34:    "expo-print": "~15.0.8",
35:    "expo-screen-capture": "~8.0.8",
36:    "expo-secure-store": "~15.0.8",
37:    "expo-sharing": "~14.0.8",
38:    "expo-status-bar": "~3.0.9",
39:    "react": "19.1.0",
40:    "react-dom": "19.1.0",
41:    "react-hook-form": "^7.74.0",
42:    "react-native": "0.81.5",
43:    "react-native-chart-kit": "^6.12.1",
44:    "react-native-gesture-handler": "~2.28.0",
45:    "react-native-keychain": "^10.0.0",
46:    "react-native-modal": "^14.0.0-rc.1",
47:    "react-native-safe-area-context": "~5.6.0",
48:    "react-native-screens": "~4.16.0",
49:    "react-native-svg": "15.12.1",
50:    "react-native-toast-message": "^2.3.3",
51:    "react-native-web": "^0.21.0",
52:    "react-redux": "^9.2.0",
53:    "yup": "^1.7.1"
```

**Missed limitation:** This addendum did not perform a live CVE audit against npm advisories. Treat this as dependency inventory, not proof of vulnerability status.

---

## 11. Main Supplemental Gotchas, Ranked

1. **Admin backup download is mislabeled as gzip.** Backend streams raw SQLite while setting `application/gzip` and `.sqlite.gz`. This can break restore tooling and create false confidence that the DB dump is compressed.

2. **Offline queue stores mutation payloads in AsyncStorage.** It can contain sensitive financial write data and is not encrypted.

3. **Biometric unlock gates UI, not token storage.** Tokens are in SecureStore, but biometric preference is not tied to token retrieval/access control.

4. **Client-side money display rounds to whole USD in many places.** This can hide cents, ignore account currency, and diverge from backend decimal values.

5. **In-process background jobs can duplicate in multi-instance deployments.** Recurring transactions and backups are timer-driven inside each server process.

6. **Push notification content leaves the system through Expo.** Expo push is a third-party data path for notification content and token identifiers.

7. **Deep link token parsing is permissive on the client.** Backend validation still protects the actual reset/verification action, but the client navigates on any route-compatible token string of length 32 or more.

8. **Client error logs may include sensitive metadata or stack text.** The backend truncates but does not sanitize client-provided metadata.

9. **Admin announcement push delivery is fire-and-forget.** Admin receives success for the announcement row even if push delivery fails later.

10. **Webhook delivery for auth flows sends raw tokens to configured providers.** This is intentional but must be included in threat modeling and vendor due diligence.

