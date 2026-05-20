import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";
import { Button } from "@kayle-id/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayle-id/ui/components/dialog";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { parsePublicKeyInput } from "@/app/webhooks/api";
import { getErrorMessage } from "@/utils/get-error-message";
import { PublicKeyFields } from "./fields";

export function CreateKeyDialog({
	endpointId,
	onSubmit,
}: {
	endpointId: string;
	onSubmit: (input: {
		endpointId: string;
		jwk: JsonWebKey;
		keyId: string;
	}) => Promise<void>;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const [keyId, setKeyId] = useState("");
	const [jwkInput, setJwkInput] = useState("");

	function resetState() {
		setErrorMessage("");
		setKeyId("");
		setJwkInput("");
	}

	async function handleSubmit() {
		if (!keyId.trim()) {
			const error = new Error("Key ID is required.");
			setErrorMessage(error.message);
			throw error;
		}

		try {
			await onSubmit({
				endpointId,
				jwk: await parsePublicKeyInput(jwkInput),
				keyId: keyId.trim(),
			});
			setIsOpen(false);
			resetState();
		} catch (error) {
			setErrorMessage(getErrorMessage(error, "Failed to add public key."));
			throw error;
		}
	}

	return (
		<Dialog
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) {
					resetState();
				}
			}}
			open={isOpen}
		>
			<DialogTrigger
				render={
					<Button onClick={() => setIsOpen(true)} size="sm" variant="outline">
						<KeyRoundIcon className="mr-2 size-4" />
						Add public key
					</Button>
				}
			/>
			<DialogContent className="flex w-full max-w-2xl! flex-col">
				<DialogHeader>
					<DialogTitle>Add public key</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					{errorMessage ? (
						<Alert variant="destructive">
							<AlertTitle>Failed to add key</AlertTitle>
							<AlertDescription>{errorMessage}</AlertDescription>
						</Alert>
					) : null}

					<PublicKeyFields
						jwkInput={jwkInput}
						jwkInputId="create-key-jwk"
						keyId={keyId}
						keyIdId="create-key-id"
						onJwkInputChange={(value) => {
							setJwkInput(value);
							setErrorMessage("");
						}}
						onKeyIdChange={(value) => {
							setKeyId(value);
							setErrorMessage("");
						}}
					/>
				</div>

				<DialogFooter>
					<Button
						onClick={() => {
							toast.promise(handleSubmit(), {
								loading: "Adding public key...",
								success: "Public key added",
								error: (error) =>
									getErrorMessage(error, "Failed to add public key"),
							});
						}}
						type="button"
					>
						Add key
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
