# Synthetic test fixtures

This directory holds a **non-production, synthetic RSA keypair** used solely by
unit tests in `apps/api/tests/functions/{webhook-deliveries,jwe}.test.ts` to
verify that the webhook payload JWE round-trip works.

These keys have **never** been used to encrypt real customer data and must
**never** be deployed to any environment that handles real traffic. They can
be rotated at any time without ceremony — regenerate with:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out rsa_private.pem
openssl pkey -in rsa_private.pem -pubout -out rsa_public.pem
```

Files:

- `rsa_private.pem` — synthetic private key, decrypts test webhook payloads
- `rsa_public.pem` — synthetic public key, encrypts test webhook payloads
