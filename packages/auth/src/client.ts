import { passkeyClient } from "@better-auth/passkey/client";
import {
  customSessionClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { magicClient } from "./magic/client";
import type { server } from "./server";

const client = createAuthClient({
  // NOTE: The API uses `/v1/auth`, but we proxy it via `/api/auth` in the web app.
  basePath: "/api/auth",
  plugins: [
    inferAdditionalFields<typeof server>(),
    magicClient(),
    organizationClient(),
    passkeyClient(),
    twoFactorClient({
      // Full-page navigation rather than `useNavigate` so the freshly-cleared
      // session cookie is observed by the next request without a stale
      // in-memory session lingering in the React tree.
      twoFactorPage: "/verify-2fa",
    }),
    customSessionClient<typeof server>(),
  ],
});

export { client };
