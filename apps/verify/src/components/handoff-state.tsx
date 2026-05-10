import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
import OctagonWarning from "@kayle-id/ui/icons/octagon-warning";
import Spinner from "@kayle-id/ui/icons/spinner";
import { Button } from "@kayleai/ui/button";
import { QRCodeSVG } from "qrcode.react";

type HandoffStateProps = {
	handoffError: string | null;
	handoffUrl: string | null;
	onRetry: () => void | Promise<void>;
	os: string | null;
};

export function HandoffState({
	handoffError,
	handoffUrl,
	onRetry,
	os,
}: HandoffStateProps) {
	if (handoffError) {
		return (
			<div className="space-y-4 pt-2 text-sm">
				<div className="flex items-center gap-3 text-red-700 dark:text-red-400">
					<OctagonWarning className="size-5 shrink-0" />
					<p>{handoffError}</p>
				</div>
				<Button className="w-full" onClick={onRetry} type="button">
					{VERIFY_HANDOFF_COPY.actions.tryAgain}
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4 pt-2">
			{os === "ios" && handoffUrl ? (
				<Button
					className="w-full"
					nativeButton={false}
					render={
						<a href={handoffUrl}>
							{VERIFY_HANDOFF_COPY.actions.openKayleIdApp}
						</a>
					}
				>
					{VERIFY_HANDOFF_COPY.actions.openKayleIdApp}
				</Button>
			) : null}
			<div className="flex justify-center">
				<div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-black/5 dark:ring-white/10">
					{handoffUrl ? (
						<QRCodeSVG
							bgColor="white"
							className="text-slate-950"
							fgColor="currentColor"
							level="M"
							size={216}
							value={handoffUrl}
						/>
					) : (
						<div className="flex size-[216px] items-center justify-center text-slate-600">
							<Spinner className="size-6" />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
