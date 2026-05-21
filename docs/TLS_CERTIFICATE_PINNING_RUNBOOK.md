# TLS Certificate Pinning Runbook

FinanceApp production mobile builds must set `EXPO_PUBLIC_API_CERT_HASH` to a non-empty `sha256/...` public key pin. Production app startup fails closed if pinning is not configured or the pinning module cannot initialize.

## Rotation

1. Generate the new API certificate public key pin before deploying the new certificate.
2. Ship a mobile build that trusts both the current and next production pins when the pinning module supports multiple hashes.
3. Deploy the server certificate after the dual-pin build is broadly available.
4. Remove the retired pin in a later mobile release after the old certificate can no longer be served.

Never ship a production build with an empty `EXPO_PUBLIC_API_CERT_HASH`. CI includes a negative check that confirms production pin validation fails when the variable is absent.
