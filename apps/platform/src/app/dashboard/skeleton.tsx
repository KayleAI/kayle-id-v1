import { Card, CardContent, CardHeader } from "@kayle-id/ui/components/card";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import {
	ANALYTICS_CARD_CLASS,
	DASHBOARD_SKELETON_CARD_KEYS,
} from "./constants";

export function DashboardSkeleton() {
	return (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			{DASHBOARD_SKELETON_CARD_KEYS.map((key) => (
				<Card className={ANALYTICS_CARD_CLASS} key={key}>
					<CardHeader className="space-y-3">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-9 w-24" />
					</CardHeader>
					<CardContent className="space-y-4">
						<Skeleton className="h-36 w-full rounded-xl" />
						<Skeleton className="h-16 w-full" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}
