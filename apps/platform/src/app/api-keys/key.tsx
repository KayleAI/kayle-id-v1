import type { ApiKey } from "@kayle-id/auth/types";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kayle-id/ui/components/alert-dialog";
import { Badge } from "@kayle-id/ui/components/badge";
import { Button } from "@kayle-id/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import { Separator } from "@kayle-id/ui/components/separator";
import { Switch } from "@kayle-id/ui/components/switch";
import { cn } from "@kayle-id/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeading } from "@/components/app-shell/heading";
import { RelativeTime } from "@/components/relative-time";
import { getErrorMessage } from "@/utils/get-error-message";
import { API_KEYS_QUERY_KEY, deleteApiKey, updateApiKey } from "./api";

export function ApiKeyComponent({ apiKey }: { apiKey: ApiKey }) {
	const [name, setName] = useState(apiKey.name);
	const [enabled, setEnabled] = useState(apiKey.enabled);
	const [isEditingName, setIsEditingName] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const updateMutation = useMutation({
		mutationFn: async ({
			name: newName,
			enabled: newEnabled,
		}: {
			name?: string;
			enabled?: boolean;
		}) => {
			return updateApiKey({
				id: apiKey.id,
				name: newName ?? apiKey.name,
				enabled: newEnabled ?? apiKey.enabled,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
			setIsEditingName(false);
			setErrorMessage("");
		},
		onError: (err) => {
			setErrorMessage(getErrorMessage(err, "Failed to update API key"));
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => deleteApiKey(apiKey.id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
			navigate({ to: "/api-keys" });
		},
		onError: (err) => {
			setErrorMessage(getErrorMessage(err, "Failed to delete API key"));
			setIsDeleteDialogOpen(false);
		},
	});

	const handleSaveName = () => {
		if (!name.trim()) {
			setErrorMessage("Name cannot be empty");
			return;
		}
		updateMutation.mutate({ name: name.trim() });
	};

	const handleCancelEdit = () => {
		setName(apiKey.name);
		setIsEditingName(false);
		setErrorMessage("");
	};

	const handleToggleEnabled = (checked: boolean) => {
		setEnabled(checked);
		updateMutation.mutate({ enabled: checked });
	};

	const handleDelete = () => {
		deleteMutation.mutate();
	};

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading
				button={
					<Badge
						className={cn(
							"px-3! py-3! text-xs",
							enabled
								? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
								: "border-red-500/20 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400",
						)}
						variant="outline"
					>
						{enabled ? "Enabled" : "Disabled"}
					</Badge>
				}
				description="View and manage your API key"
				title={apiKey.name}
			/>
			<hr className="my-4" />

			{errorMessage && (
				<Alert className="mb-6" variant="destructive">
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			)}

			<div className="space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>Details</CardTitle>
						<CardDescription>API key information and settings</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<div className="space-y-2">
							<Label htmlFor="name">Name</Label>
							<div className="flex items-center gap-2">
								<Input
									disabled={!isEditingName || updateMutation.isPending}
									id="name"
									onChange={(e) => {
										setName(e.target.value);
										setErrorMessage("");
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" && isEditingName) {
											handleSaveName();
										}
										if (e.key === "Escape") {
											handleCancelEdit();
										}
									}}
									value={name}
								/>
								{isEditingName ? (
									<div className="flex gap-2">
										<Button
											disabled={updateMutation.isPending}
											onClick={handleSaveName}
											type="button"
										>
											Save
										</Button>
										<Button
											disabled={updateMutation.isPending}
											onClick={handleCancelEdit}
											type="button"
											variant="outline"
										>
											Cancel
										</Button>
									</div>
								) : (
									<Button
										onClick={() => setIsEditingName(true)}
										type="button"
										variant="outline"
									>
										Edit
									</Button>
								)}
							</div>
						</div>

						<Separator />

						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label htmlFor="enabled">Status</Label>
								<p className="text-muted-foreground text-sm">
									{enabled
										? "This API key is active and can be used for requests"
										: "This API key is disabled and cannot be used"}
								</p>
							</div>
							<Switch
								checked={enabled}
								disabled={updateMutation.isPending}
								id="enabled"
								onCheckedChange={handleToggleEnabled}
							/>
						</div>

						<Separator />

						<div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
							<div className="space-y-1">
								<Label className="text-muted-foreground text-sm">
									Request Count
								</Label>
								<p className="font-medium">
									{apiKey.requestCount.toLocaleString()}
								</p>
							</div>
							<div className="space-y-1">
								<Label className="text-muted-foreground text-sm">Created</Label>
								<p className="font-medium">
									<RelativeTime iso={apiKey.createdAt} />
								</p>
							</div>
							<div className="space-y-1">
								<Label className="text-muted-foreground text-sm">
									Last Updated
								</Label>
								<p className="font-medium">
									<RelativeTime iso={apiKey.updatedAt} />
								</p>
							</div>
							<div className="space-y-1">
								<Label className="text-muted-foreground text-sm">Key ID</Label>
								<p className="font-medium font-mono text-sm">{apiKey.id}</p>
							</div>
						</div>

						{apiKey.permissions.length > 0 && (
							<>
								<Separator />
								<div className="space-y-2">
									<Label>Permissions</Label>
									<div className="flex flex-wrap gap-2">
										{apiKey.permissions.map((permission) => (
											<span
												className={cn(
													"inline-flex items-center rounded-full px-2 py-1 font-medium text-xs",
													"bg-blue-500/10 text-blue-700 dark:text-blue-400",
												)}
												key={permission}
											>
												{permission}
											</span>
										))}
									</div>
								</div>
							</>
						)}

						{Object.keys(apiKey.metadata).length > 0 && (
							<>
								<Separator />
								<div className="space-y-2">
									<Label>Metadata</Label>
									<pre className="rounded-md bg-muted p-4 text-sm">
										{JSON.stringify(apiKey.metadata, null, 2)}
									</pre>
								</div>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-1.5">
							<CardTitle className="text-destructive">Delete API key</CardTitle>
							<CardDescription>
								Once deleted, this API key cannot be recovered. Any integrations
								still using it will start failing immediately.
							</CardDescription>
						</div>
						<Button
							disabled={deleteMutation.isPending}
							onClick={() => setIsDeleteDialogOpen(true)}
							type="button"
							variant="destructive"
						>
							Delete API key
						</Button>
					</CardHeader>
				</Card>
			</div>

			<AlertDialog
				onOpenChange={setIsDeleteDialogOpen}
				open={isDeleteDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete the API key{" "}
							<span className="font-semibold text-foreground">
								“{apiKey.name}”
							</span>
							. This action cannot be undone and any request using this API key
							will fail.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={deleteMutation.isPending}
							variant="secondary"
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={deleteMutation.isPending}
							onClick={handleDelete}
							variant="destructive"
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
