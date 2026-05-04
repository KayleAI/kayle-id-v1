import { passkeyClient } from "@better-auth/passkey/client";
import {
  customSessionClient,
  inferAdditionalFields,
  organizationClient,
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
    customSessionClient<typeof server>(),
  ],
});

export { client };
