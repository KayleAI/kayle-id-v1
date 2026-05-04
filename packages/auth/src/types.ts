import type { client } from "./client";

export type AuthContext = typeof client.$Infer.Session;
export type Session = AuthContext["session"];
export type User = AuthContext["user"];
export interface Organization {
  id: string;
  logo: string | null;
  name: string;
  pendingDeletionAt: string | null;
  pendingDeletionRequestedAt: string | null;
  pendingDeletionRequestedBy: string | null;
  slug: string;
}

export interface ApiKey {
  createdAt: string;
  enabled: boolean;
  id: string;
  metadata: Record<string, unknown>;
  name: string;
  permissions: string[];
  requestCount: number;
  updatedAt: string;
}
