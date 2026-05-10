import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { client } from "../client";
import type { Organization, Session, User } from "../types";

interface AuthContextType {
  activeOrganization: Organization | null;
  error: Error | null;
  isPlatformAdmin: boolean;
  organizations: Organization[];
  refresh: () => Promise<void>;
  session: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
  user: User | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");
  const [activeOrganization, setActiveOrganization] =
    useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const { data, isPending, error, refetch } = client.useSession();

  async function refresh() {
    await refetch();
  }

  useEffect(() => {
    if (isPending) {
      return;
    }

    if (data) {
      setStatus("authenticated");
      setActiveOrganization(data?.activeOrganization ?? null);
      setOrganizations(data?.organizations ?? []);
      setIsPlatformAdmin(Boolean(data?.isPlatformAdmin));
    } else {
      setStatus("unauthenticated");
      setIsPlatformAdmin(false);
    }
  }, [data, isPending]);

  const value = {
    activeOrganization,
    organizations,
    status,
    session: data?.session ?? null,
    user: data?.user ?? null,
    error,
    isPlatformAdmin,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
