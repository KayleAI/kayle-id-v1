import type { CustomerApiKeyScope } from "@kayle-id/auth/permissions";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import { Checkbox } from "@kayleai/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayleai/ui/dialog";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { Textarea } from "@kayleai/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useReducer, useState } from "react";
import { useCopyToClipboard } from "@/utils/use-copy";
import {
	API_KEYS_QUERY_KEY,
	createApiKey,
	DEFAULT_API_KEY_PERMISSIONS,
} from "./api";

const API_KEY_PERMISSION_OPTIONS: readonly {
	description: string;
	label: string;
	scope: CustomerApiKeyScope;
}[] = [
	{
		scope: "sessions:write",
		label: "Create sessions",
		description: "Create verification sessions and read their status.",
	},
	{
		scope: "sessions:read",
		label: "Read sessions",
		description: "Read verification sessions without creating new ones.",
	},
	{
		scope: "webhooks:write",
		label: "Manage webhooks",
		description: "Create endpoints, keys, replays, and signing secrets.",
	},
	{
		scope: "webhooks:read",
		label: "Read webhooks",
		description: "Read webhook endpoints, events, keys, and deliveries.",
	},
	{
		scope: "analytics:read",
		label: "Read analytics",
		description: "Read verification analytics for this organization.",
	},
] as const;

interface FormState {
	apiKey: string | null;
	errorMessage: string;
	name: string;
	permissions: CustomerApiKeyScope[];
	status: "idle" | "loading" | "success" | "error";
}

type FormAction =
	| { type: "SET_NAME"; name: string }
	| {
			type: "TOGGLE_PERMISSION";
			checked: boolean;
			permission: CustomerApiKeyScope;
	  }
	| { type: "SUBMIT" }
	| { type: "SUCCESS"; apiKey: string }
	| { type: "ERROR"; message: string }
	| { type: "RESET" }
	| { type: "CLEAR_ERROR" };

function createInitialFormState(): FormState {
	return {
		apiKey: null,
		errorMessage: "",
		name: "",
		permissions: [...DEFAULT_API_KEY_PERMISSIONS],
		status: "idle",
	};
}

const initialFormState = createInitialFormState();

function resetErrorState(
	state: FormState,
): Pick<FormState, "errorMessage" | "status"> {
	return {
		status: state.status === "error" ? "idle" : state.status,
		errorMessage: state.status === "error" ? "" : state.errorMessage,
	};
}

function formReducer(state: FormState, action: FormAction): FormState {
	switch (action.type) {
		case "SET_NAME":
			return {
				...state,
				name: action.name,
				...resetErrorState(state),
			};
		case "TOGGLE_PERMISSION": {
			const permissions = action.checked
				? Array.from(new Set([...state.permissions, action.permission]))
				: state.permissions.filter(
						(permission) => permission !== action.permission,
					);

			return {
				...state,
				permissions,
				...resetErrorState(state),
			};
		}
		case "SUBMIT":
			return { ...state, status: "loading", errorMessage: "" };
		case "SUCCESS":
			return { ...state, status: "success", apiKey: action.apiKey };
		case "ERROR":
			return { ...state, status: "error", errorMessage: action.message };
		case "RESET":
			return createInitialFormState();
		case "CLEAR_ERROR":
			return { ...state, status: "idle", errorMessage: "" };
		default:
			return state;
	}
}

function ApiKeySuccessView({
	apiKey,
	onClose,
}: {
	apiKey: string;
	onClose: () => void;
}) {
	const { copied, copy } = useCopyToClipboard();

	return (
		<>
			<DialogHeader>
				<DialogTitle>API Key Created</DialogTitle>
			</DialogHeader>
			<div className="space-y-2">
				<Label className="font-medium text-sm" htmlFor="api-key">
					Your API Key
				</Label>
				<div className="relative">
					<Textarea
						className="min-h-[0px]! resize-none pr-20 font-mono text-sm"
						id="api-key"
						readOnly
						value={apiKey}
					/>
					<Button
						className="absolute top-1/2 right-2 -translate-y-1/2"
						onClick={() => copy(apiKey)}
						size="sm"
						type="button"
						variant="outline"
					>
						{copied ? "Copied!" : "Copy"}
					</Button>
				</div>
				<p className="text-muted-foreground text-xs">
					You won't be able to view this API key again.
				</p>
			</div>
			<DialogFooter>
				<Button onClick={onClose}>I've saved my API key</Button>
			</DialogFooter>
		</>
	);
}

function ApiKeyFormView({
	state,
	dispatch,
	onSubmit,
}: {
	state: FormState;
	dispatch: React.Dispatch<FormAction>;
	onSubmit: () => void;
}) {
	const isLoading = state.status === "loading";

	return (
		<>
			<DialogHeader>
				<DialogTitle>Create API Key</DialogTitle>
			</DialogHeader>
			<div className="space-y-4">
				{state.status === "error" && state.errorMessage && (
					<Alert variant="destructive">
						<AlertTitle>Error</AlertTitle>
						<AlertDescription>{state.errorMessage}</AlertDescription>
					</Alert>
				)}
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input
						disabled={isLoading}
						id="name"
						onChange={(e) =>
							dispatch({ type: "SET_NAME", name: e.target.value })
						}
						onKeyDown={(e) => {
							if (e.key === "Enter" && state.name.trim()) {
								onSubmit();
							}
						}}
						placeholder="API Key Name"
						value={state.name}
					/>
				</div>
				<fieldset className="space-y-2" disabled={isLoading}>
					<legend className="font-medium text-sm">Permissions</legend>
					<div className="grid gap-2">
						{API_KEY_PERMISSION_OPTIONS.map((option) => {
							const checkboxId = `api-key-permission-${option.scope.replace(
								":",
								"-",
							)}`;
							const checked = state.permissions.includes(option.scope);

							return (
								<label
									className="flex min-h-11 items-start gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
									htmlFor={checkboxId}
									key={option.scope}
								>
									<Checkbox
										checked={checked}
										className="mt-0.5"
										disabled={isLoading}
										id={checkboxId}
										onCheckedChange={(nextChecked) =>
											dispatch({
												type: "TOGGLE_PERMISSION",
												checked: nextChecked === true,
												permission: option.scope,
											})
										}
									/>
									<span className="space-y-0.5">
										<span className="block font-medium">{option.label}</span>
										<span className="block text-muted-foreground">
											{option.description}
										</span>
									</span>
								</label>
							);
						})}
					</div>
				</fieldset>
			</div>
			<DialogFooter>
				<Button
					disabled={
						isLoading || !state.name.trim() || state.permissions.length === 0
					}
					onClick={onSubmit}
				>
					{isLoading ? "Creating..." : "Create API Key"}
				</Button>
			</DialogFooter>
		</>
	);
}

export function CreateApiKey() {
	const [isOpen, setIsOpen] = useState(false);
	const [state, dispatch] = useReducer(formReducer, initialFormState);
	const queryClient = useQueryClient();

	const handleSubmit = async () => {
		if (!state.name.trim()) {
			dispatch({
				type: "ERROR",
				message: "Please enter a name for your API key",
			});
			return;
		}

		if (state.permissions.length === 0) {
			dispatch({
				type: "ERROR",
				message: "Select at least one permission for this API key.",
			});
			return;
		}

		dispatch({ type: "SUBMIT" });

		try {
			const { key } = await createApiKey({
				name: state.name.trim(),
				permissions: state.permissions,
			});

			if (!key) {
				dispatch({
					type: "ERROR",
					message: "API key was not returned. Please try again.",
				});
				return;
			}

			dispatch({ type: "SUCCESS", apiKey: key });
			await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
		} catch (err) {
			dispatch({
				type: "ERROR",
				message:
					err instanceof Error
						? err.message
						: "Failed to create API key. Please try again.",
			});
		}
	};

	const handleClose = () => {
		setIsOpen(false);
		// Reset form after dialog close animation
		setTimeout(() => dispatch({ type: "RESET" }), 150);
	};

	const handleOpenChange = (open: boolean) => {
		if (open) {
			setIsOpen(true);
		} else {
			handleClose();
		}
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger
				render={<Button onClick={() => setIsOpen(true)}>Create API Key</Button>}
			/>
			<DialogContent className="flex w-full max-w-lg! flex-col">
				{state.status === "success" && state.apiKey ? (
					<ApiKeySuccessView apiKey={state.apiKey} onClose={handleClose} />
				) : (
					<ApiKeyFormView
						dispatch={dispatch}
						onSubmit={handleSubmit}
						state={state}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
