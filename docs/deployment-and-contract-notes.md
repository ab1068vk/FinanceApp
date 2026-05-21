# Deployment and API Contract Notes

## Access Token Blocklist

FinanceApp stores revoked access-token JTIs in SQLite and also keeps a process-local in-memory cache for speed. The database is the source of truth for the current single-process deployment.

Do not run horizontally scaled API instances against separate SQLite databases if reliable token invalidation is required. In a multi-instance deployment, use one shared database plus a shared invalidation store such as Redis, or remove the process-local cache and check a shared store on every request.

## Swagger

Swagger UI is disabled by default. Enable it only in trusted environments by setting:

```env
ENABLE_SWAGGER=true
```

Do not expose `/api/docs` on public staging or production hosts.

## Shared API Contracts

The `shared/` package is currently reserved but is not yet the single source of truth for backend/mobile DTOs. Until that is formalized, API response changes must be coordinated manually between backend controllers/tests and mobile TypeScript types.

Before major API changes, promote `shared/types` into a real contract package imported by mobile and validated by backend tests, or generate DTOs from an OpenAPI schema.
