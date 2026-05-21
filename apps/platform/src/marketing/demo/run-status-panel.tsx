import { Button } from "@kayle-id/ui/components/button";
import { Label } from "@kayle-id/ui/components/label";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import type { DemoRunView } from "@/demo/types";
import { useCopyToClipboard } from "@/utils/use-copy";

export function RunStatusPanel({ run }: { run: DemoRunView | null }) {
	const { copied, copy } = useCopyToClipboard();
	const verificationUrl = run?.verification_url ?? null;

	if (!verificationUrl) {
		return (
			<div className="border-border/70 border-t pt-5">
				<p className="max-w-[48ch] text-muted-foreground text-sm leading-6">
					Create a session in step 1 and Kayle will generate the mobile
					verification link here.
				</p>
			</div>
		);
	}

	return (
		<div>
			<div className="grid gap-5 border-border/70 border-b pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<div className="min-w-0">
					<Label className="block font-light text-2xl text-foreground tracking-tight">
						Open the verification link
					</Label>
					<p className="mt-1 max-w-xl text-muted-foreground text-sm leading-relaxed">
						Continue in this browser or copy the link to another device.
					</p>
				</div>
			</div>
			<div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
				<Button
					nativeButton={false}
					render={
						<a href={verificationUrl} rel="noopener noreferrer" target="_blank">
							<ExternalLinkIcon className="mr-2 size-4" />
							Open link
						</a>
					}
				/>
				<Button
					onClick={async () => {
						await copy(verificationUrl);
					}}
					type="button"
					variant="outline"
				>
					<CopyIcon className="mr-2 size-4" />
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
		</div>
	);
}
