import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import { Textarea } from "@kayle-id/ui/components/textarea";
import type { ChangeEvent } from "react";

export function PublicKeyFields({
	jwkInput,
	jwkInputId,
	keyId,
	keyIdId,
	onJwkInputChange,
	onKeyIdChange,
}: {
	jwkInput: string;
	jwkInputId: string;
	keyId: string;
	keyIdId: string;
	onJwkInputChange: (value: string) => void;
	onKeyIdChange: (value: string) => void;
}) {
	async function handleFileChange(
		event: ChangeEvent<HTMLInputElement>,
	): Promise<void> {
		const file = event.target.files?.[0];

		if (!file) {
			return;
		}

		onJwkInputChange(await file.text());
		event.target.value = "";
	}

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor={keyIdId}>Key ID</Label>
				<Input
					id={keyIdId}
					onChange={(event) => onKeyIdChange(event.target.value)}
					placeholder="rsa-key-2026-03"
					value={keyId}
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor={jwkInputId}>Public key</Label>
				<Input
					accept=".pem,.pub,.txt"
					className="min-h-11"
					onChange={handleFileChange}
					type="file"
				/>
				<Textarea
					className="min-h-[220px] font-mono text-sm"
					id={jwkInputId}
					onChange={(event) => onJwkInputChange(event.target.value)}
					placeholder={
						"-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----\n\nor paste a JWK JSON object"
					}
					value={jwkInput}
				/>
				<p className="text-muted-foreground text-sm">
					Paste a PEM public key or JWK, or upload a `.pem` file. The key will
					become the active encryption key for new deliveries to this endpoint.
				</p>
			</div>
		</div>
	);
}
