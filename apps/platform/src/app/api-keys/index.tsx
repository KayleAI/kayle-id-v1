import type { ApiKey } from "@kayle-id/auth/types";
import { Button } from "@kayle-id/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayle-id/ui/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayle-id/ui/components/table";
import { cn } from "@kayle-id/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BanIcon,
	EllipsisVerticalIcon,
	EyeIcon,
	TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/relative-time";
import { API_KEYS_QUERY_KEY, deleteApiKey, updateApiKey } from "./api";

export function ApiKeysTable({ apiKeys }: { apiKeys: ApiKey[] }) {
	const queryClient = useQueryClient();

	const updateMutation = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			updateApiKey({ id, enabled }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
		},
	});

	const deleteMutation = useMutation({
		mutationFn: ({ id }: { id: string }) => deleteApiKey(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
		},
	});

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<Table>
				<TableHeader className="bg-muted/40">
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Requests</TableHead>
						<TableHead>Created</TableHead>
						<TableHead>
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{apiKeys.map((key) => (
						<TableRow key={key.id}>
							<TableCell className="font-medium">
								<Link
									className="hover:underline"
									params={{ key: key.id }}
									to="/api-keys/$key"
								>
									{key.name}
								</Link>
							</TableCell>
							<TableCell>
								<span
									className={cn(
										"inline-flex items-center rounded-full px-2 py-1 font-medium text-xs",
										key.enabled
											? "bg-green-500/10 text-green-700 dark:text-green-400"
											: "bg-muted text-muted-foreground",
									)}
								>
									{key.enabled ? "Enabled" : "Disabled"}
								</span>
							</TableCell>
							<TableCell className="text-muted-foreground">
								{key.requestCount.toLocaleString()}
							</TableCell>
							<TableCell className="text-muted-foreground">
								<RelativeTime iso={key.createdAt} />
							</TableCell>
							<TableCell className="text-right text-muted-foreground">
								<DropdownMenu>
									<DropdownMenuTrigger
										render={<Button size="icon" variant="ghost" />}
									>
										<EllipsisVerticalIcon className="size-4" />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem
											render={
												<Button
													className="flex w-full items-center justify-start"
													nativeButton={false}
													render={
														<Link
															params={{ key: key.id }}
															to="/api-keys/$key"
														/>
													}
													variant="ghost"
												/>
											}
										>
											<EyeIcon className="size-4" />
											See details
										</DropdownMenuItem>

										<DropdownMenuItem
											nativeButton
											onClick={() => {
												toast.promise(
													updateMutation.mutateAsync({
														id: key.id,
														enabled: !key.enabled,
													}),
													{
														loading: "Updating API key...",
														success: "API key updated successfully",
														error: "Failed to update API key",
													},
												);
											}}
											render={
												<Button
													className="flex w-full items-center justify-start"
													variant="ghost"
												/>
											}
										>
											<BanIcon className="size-4" />
											{key.enabled ? "Disable API Key" : "Enable API Key"}
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											nativeButton
											render={
												<Button
													className="flex w-full items-center justify-start"
													onClick={() => {
														toast.promise(
															deleteMutation.mutateAsync({ id: key.id }),
															{
																loading: "Deleting API key...",
																success: "API key deleted successfully",
																error: "Failed to delete API key",
															},
														);
													}}
													variant="destructive"
												/>
											}
										>
											<TrashIcon className="size-4" />
											Revoke API Key
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					))}
					{apiKeys.length === 0 ? (
						<TableRow>
							<TableCell className="text-center" colSpan={5}>
								No API keys found
							</TableCell>
						</TableRow>
					) : null}
				</TableBody>
			</Table>
		</div>
	);
}

export { CreateApiKey } from "./create";
