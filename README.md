# FinanceApp

FinanceApp is a production-grade, local-first mobile financial application. It includes an Expo React Native mobile app, a Node.js + Express API, and a self-contained SQLite database powered by better-sqlite3. The project is designed to run locally without external cloud services.

## Tech Stack

- Mobile: React Native, Expo, TypeScript, React Navigation, Redux Toolkit
- Backend: Node.js, Express, better-sqlite3
- Security: JWT access tokens, hashed refresh tokens, bcrypt password hashing, Helmet, CORS restrictions, HPP protection, rate limiting, input validation
- Observability: Winston, Morgan, rotating log files
- Testing: Jest and Supertest for backend integration tests

## Setup

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Copy the environment example and fill in secure values:

```bash
cp ../.env.example .env
```

Required keys:

```env
JWT_SECRET=replace-with-a-long-random-secret
DB_PATH=database/finance.db
PORT=3000
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=replace-with-a-bcrypt-hash
DELETED_USER_ARCHIVE_DAYS=90
```

Email verification and password reset delivery require either SMTP settings or webhook URLs. For SMTP, add these to `backend/.env`:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_USER=mailer@example.com
SMTP_PASS=replace-with-provider-app-password
EMAIL_FROM="FinanceApp <mailer@example.com>"
MOBILE_APP_ORIGIN=financeapp://auth
```

Use a provider app password or SMTP token, not your normal mailbox password. Verification links are sent through TLS/STARTTLS, raw tokens are not stored in the database, and tokens are not returned by API responses unless explicitly enabled for local development.

3. Start the backend:

```bash
npm run dev
```

The API starts on `http://localhost:3000` by default.

4. Install mobile dependencies:

```bash
cd ../mobile
npm install
```

5. Start Expo:

```bash
npx expo start
```

## API Reference

| Area         | Method | Endpoint                              | Description                                 |
| ------------ | -----: | ------------------------------------- | ------------------------------------------- |
| Health       |    GET | `/health`                             | Backend health check                        |
| Auth         |   POST | `/api/auth/register`                  | Register a user                             |
| Auth         |   POST | `/api/auth/login`                     | Login and receive access/refresh tokens     |
| Auth         |   POST | `/api/auth/refresh`                   | Issue a new access token                    |
| Auth         |   POST | `/api/auth/logout`                    | Revoke a refresh token                      |
| Auth         |    PUT | `/api/auth/change-password`           | Change password and revoke sessions         |
| Auth         |    GET | `/api/auth/me`                        | Current authenticated user                  |
| Accounts     |    GET | `/api/accounts`                       | List current user's active accounts         |
| Accounts     |   POST | `/api/accounts`                       | Create an account                           |
| Accounts     |    GET | `/api/accounts/:id`                   | Get account details and recent transactions |
| Accounts     |    PUT | `/api/accounts/:id`                   | Update account fields                       |
| Accounts     | DELETE | `/api/accounts/:id`                   | Soft-delete an account                      |
| Transactions |    GET | `/api/transactions`                   | Paginated filtered transaction list         |
| Transactions |   POST | `/api/transactions`                   | Create income, expense, or transfer         |
| Transactions |    GET | `/api/transactions/summary`           | Date-range totals and category grouping     |
| Transactions |    GET | `/api/transactions/:id`               | Get one transaction                         |
| Transactions |    PUT | `/api/transactions/:id`               | Update editable transaction fields          |
| Transactions | DELETE | `/api/transactions/:id`               | Delete and reverse balance impact           |
| Budgets      |    GET | `/api/budgets`                        | List budgets with spending progress         |
| Budgets      |   POST | `/api/budgets`                        | Create a budget                             |
| Budgets      |    GET | `/api/budgets/:id`                    | Get a budget with breakdown                 |
| Budgets      |    PUT | `/api/budgets/:id`                    | Update a budget                             |
| Budgets      | DELETE | `/api/budgets/:id`                    | Delete a budget                             |
| Categories   |    GET | `/api/categories`                     | System and user categories                  |
| Categories   |   POST | `/api/categories`                     | Create a custom category                    |
| Categories   |    PUT | `/api/categories/:id`                 | Update own category                         |
| Categories   | DELETE | `/api/categories/:id`                 | Delete own category                         |
| Admin        |    GET | `/api/admin/dashboard`                | Admin dashboard stats                       |
| Admin        |    GET | `/api/admin/users`                    | Paginated users list                        |
| Admin        |    GET | `/api/admin/users/:id`                | User detail and activity summary            |
| Admin        |    PUT | `/api/admin/users/:id/status`         | Activate/deactivate user                    |
| Admin        |    PUT | `/api/admin/users/:id/role`           | Change user role                            |
| Admin        |   POST | `/api/admin/users/:id/reset-password` | Set temporary password                      |
| Admin        | DELETE | `/api/admin/users/:id`                | Soft-delete and anonymize user              |
| Admin        |    GET | `/api/admin/audit-logs`               | Paginated audit logs                        |
| Admin        |    GET | `/api/admin/users/:id/transactions`   | Admin support transaction review            |
| Admin        |    GET | `/api/admin/system-health`            | Runtime and storage health metrics          |

## Security Features

- Passwords are hashed with bcrypt using 12 salt rounds.
- JWT access tokens expire after 15 minutes.
- Refresh tokens are random, hashed with SHA-256 before storage, and revocable.
- All financial APIs require authentication and enforce user ownership.
- Admin APIs require both authentication and the `admin` role.
- Login lockout protects accounts after repeated failures.
- Email verification and password reset links use random single-use tokens; only token hashes are stored server-side.
- SMTP delivery requires TLS by default, and email/webhook delivery failures are reported instead of silently pretending the email was sent.
- Helmet, CORS allowlists, HPP protection, compression, request size limits, and input validation are enabled.
- Audit logs record sensitive account, auth, transaction, and admin actions.
- Production error responses avoid exposing stack traces.
- Production deployments must terminate TLS before traffic reaches Express. Run the API behind a TLS-terminating reverse proxy, forward `X-Forwarded-Proto: https`, and set `TRUST_PROXY_HOPS` to the exact proxy hop count. The backend logs a production warning when HTTPS is not detected.
- CSRF protection is enabled by default for browser-style state-changing requests using a per-session double-submit cookie. Native mobile API calls use Bearer tokens and are not treated as cookie-authenticated browser requests.
- Admin webhook URLs must use HTTPS and cannot point to localhost or private network ranges. Webhook secrets are encrypted before they are stored in SQLite.

## Admin Setup

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` in `backend/.env` before the first backend start. Generate the hash with bcrypt using the same 12-round policy as the app, then run `npm run dev`. The database migration seeds the admin account only if that email does not already exist.

Example hash generation from the backend folder:

```bash
node -e "require('bcryptjs').hash('ChangeMeNow1!', 12).then(console.log)"
```

## Folder Structure

- `backend/src/controllers`: Request handlers for auth, financial APIs, and admin APIs.
- `backend/src/routes`: Express route definitions and validators.
- `backend/src/middleware`: Authentication and authorization middleware.
- `backend/src/utils`: Logger and security helpers.
- `backend/database`: SQLite initialization, migrations, and local database files.
- `backend/tests`: Jest and Supertest integration tests.
- `mobile/src/screens`: Auth, dashboard, transactions, budget, reports, profile, and admin screens.
- `mobile/src/components`: Shared UI and chart components.
- `mobile/src/navigation`: Auth, app, tab, and admin navigation.
- `mobile/src/store`: Redux Toolkit store and slices.
- `mobile/src/services`: API client and secure storage.
- `mobile/src/hooks`: Reusable screen and auth hooks.
- `mobile/src/utils`: Formatting and utility helpers.
- `shared/types`: Cross-platform type placeholders.
- `docs`: Project documentation.

#1 cd backend then npm run dev
#2 2nd terminal cd mobile then npx expo start --host lan --port 8081
npx expo start --clear --host tunnel
netstat -ano | findstr :8081

npx expo start -c
