import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import { Badge } from "@kayle-id/ui/components/badge";
import { Button } from "@kayle-id/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kayle-id/ui/components/empty";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { LaptopIcon, ShieldCheckIcon } from "lucide-react";
import { TwoFactorAuthSection } from "@/app/account/two-factor";
import { PasskeysList } from "@/app/passkeys";
import { QueryErrorAlert } from "@/components/query-error-alert";
import { RelativeTime } from "@/components/relative-time";
import { unwrapBetterAuthResult } from "@/utils/better-auth";
import { useToastMutation } from "@/utils/use-toast-mutation";

const SESSIONS_QUERY_KEY = ["account", "sessions"] as const;

interface AuthSession {
	id: string;
	token: string;
	createdAt: string | Date;
	updatedAt: string | Date;
	expiresAt: string | Date;
	ipAddress?: string | null;
	userAgent?: string | null;
}

interface UserAgentSummary {
	browser: string;
	os: string;
}

const BROWSER_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "Edge", pattern: /Edg\/?[\d.]*/i },
	{ name: "Opera", pattern: /OPR\/?[\d.]*/i },
	{ name: "Chrome", pattern: /Chrome\/?[\d.]*/i },
	{ name: "Safari", pattern: /Safari\/?[\d.]*/i },
	{ name: "Firefox", pattern: /Firefox\/?[\d.]*/i },
];

const OS_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "iOS", pattern: /iPhone|iPad|iPod/i },
	{ name: "Android", pattern: /Android/i },
	{ name: "macOS", pattern: /Mac OS X|Macintosh/i },
	{ name: "Windows", pattern: /Windows/i },
	{ name: "Linux", pattern: /Linux/i },
];

function summarizeUserAgent(
	userAgent: string | null | undefined,
): UserAgentSummary {
	if (!userAgent) {
		return { browser: "Unknown browser", os: "Unknown device" };
	}
	const browser =
		BROWSER_PATTERNS.find((entry) => entry.pattern.test(userAgent))?.name ??
		"Unknown browser";
	const os =
		OS_PATTERNS.find((entry) => entry.pattern.test(userAgent))?.name ??
		"Unknown device";
	return { browser, os };
}

function toIsoString(value: string | Date): string {
	return typeof value === "string" ? value : value.toISOString();
}

export function AccountSecurityPage() {
	const { session: currentSession } = useAuth();

	const sessionsQuery = useQuery({
		queryKey: SESSIONS_QUERY_KEY,
		queryFn: async () => {
			const result = await client.listSessions();
			return unwrapBetterAuthResult(
				result,
				"Failed to load sessions",
			) as AuthSession[];
		},
	});

	const revokeSession = useToastMutation<void, string>({
		mutationFn: async (token) => {
			const result = await client.revokeSession({ token });
			unwrapBetterAuthResult(result, "Failed to revoke session");
		},
		invalidate: [SESSIONS_QUERY_KEY],
		messages: {
			loading: "Revoking session...",
			success: "Session revoked",
			error: "Failed to revoke session",
		},
	});

	const revokeOthers = useToastMutation<void>({
		mutationFn: async () => {
			const result = await client.revokeOtherSessions();
			unwrapBetterAuthResult(result, "Failed to sign out other sessions");
		},
		invalidate: [SESSIONS_QUERY_KEY],
		messages: {
			loading: "Signing out other sessions...",
			success: "All other sessions signed out",
			error: "Failed to sign out other sessions",
		},
	});

	const sessions = sessionsQuery.data ?? [];
	const otherSessionCount = sessions.filter(
		(session) => session.id !== currentSession?.id,
	).length;

	return (
		<div className="space-y-6">
			<TwoFactorAuthSection />
			<PasskeysList />
			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<CardTitle>Active sessions</CardTitle>
							<CardDescription>
								Devices and browsers currently signed in to your account.
							</CardDescription>
						</div>
						<Button
							disabled={otherSessionCount === 0 || revokeOthers.isPending}
							onClick={() => revokeOthers.trigger()}
							size="sm"
							type="button"
							variant="outline"
						>
							{revokeOthers.isPending
								? "Signing out..."
								: "Sign out other sessions"}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{sessionsQuery.isLoading ? <SessionsSkeleton /> : null}

					<QueryErrorAlert
						error={sessionsQuery.isError ? sessionsQuery.error : null}
						fallback="Something went wrong while loading your sessions."
						title="Failed to load sessions"
					/>

					{!sessionsQuery.isLoading && !sessionsQuery.isError ? (
						sessions.length === 0 ? (
							<Empty className="border border-border/70 bg-muted/20">
								<EmptyMedia className="border border-border/70 bg-background">
									<ShieldCheckIcon
										aria-hidden="true"
										className="size-5 text-muted-foreground"
									/>
								</EmptyMedia>
								<EmptyHeader>
									<EmptyTitle>No active sessions</EmptyTitle>
									<EmptyDescription>
										When you sign in from a new device, it will appear here.
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							<ul className="divide-y divide-border/70">
								{sessions.map((session) => (
									<SessionRow
										isCurrent={session.id === currentSession?.id}
										isRevoking={
											revokeSession.isPending &&
											revokeSession.variables === session.token
										}
										key={session.id}
										onRevoke={revokeSession.trigger}
										session={session}
									/>
								))}
							</ul>
						)
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}

function SessionsSkeleton() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-16 w-full" />
			<Skeleton className="h-16 w-full" />
		</div>
	);
}

function SessionRow({
	isCurrent,
	isRevoking,
	onRevoke,
	session,
}: {
	isCurrent: boolean;
	isRevoking: boolean;
	onRevoke: (token: string) => void;
	session: AuthSession;
}) {
	const summary = summarizeUserAgent(session.userAgent);

	return (
		<li className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
			<div className="flex min-w-0 items-center gap-3">
				<LaptopIcon
					aria-hidden="true"
					className="size-5 shrink-0 text-muted-foreground"
				/>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<p className="truncate font-medium">
							{summary.browser} on {summary.os}
						</p>
						{isCurrent ? (
							<Badge
								className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
								variant="outline"
							>
								This device
							</Badge>
						) : null}
					</div>
					<p className="truncate text-muted-foreground text-xs tabular-nums">
						{session.ipAddress ? `${session.ipAddress} · ` : ""}
						Last active <RelativeTime iso={toIsoString(session.updatedAt)} />
					</p>
				</div>
			</div>
			<Button
				disabled={isCurrent || isRevoking}
				onClick={() => onRevoke(session.token)}
				size="sm"
				type="button"
				variant="ghost"
			>
				{isRevoking ? "Revoking..." : "Revoke"}
			</Button>
		</li>
	);
}
