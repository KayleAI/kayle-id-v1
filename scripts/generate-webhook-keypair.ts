/**
 * Generate an RSA-OAEP-256 keypair for the Kayle ID demo webhook flow.
 *
 * The private JWK is what gets set as the platform worker's
 * KAYLE_PLATFORM_WEBHOOK_DECRYPTION_KEY secret in Infisical.
 * The public JWK is what gets registered with whoever encrypts the
 * webhook payload (e.g. the demo settings UI).
 *
 * Usage:
 *   bun run keypair:webhook
 *
 * Pipe to files if you want them on disk:
 *   bun run keypair:webhook > /tmp/webhook-keypair.txt
 */

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  {
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["encrypt", "decrypt"]
);

const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);

process.stdout.write("=== Public JWK (encrypts webhook payloads) ===\n");
process.stdout.write(`${JSON.stringify(publicJwk)}\n\n`);
process.stdout.write(
  "=== Private JWK (KAYLE_PLATFORM_WEBHOOK_DECRYPTION_KEY) ===\n"
);
process.stdout.write(`${JSON.stringify(privateJwk)}\n`);
