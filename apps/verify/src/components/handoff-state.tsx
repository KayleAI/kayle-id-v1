import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
import ArrowRotateCw from "@kayle-id/ui/icons/arrow-rotate-cw";
import Spinner from "@kayle-id/ui/icons/spinner";
import { Button } from "@kayleai/ui/button";
import { QRCodeSVG } from "qrcode.react";

type HandoffStateProps = {
	handoffError: string | null;
	handoffUrl: string | null;
	onRetry: () => void;
	os: string | null;
};

export function HandoffState({
	handoffError,
	handoffUrl,
	onRetry,
	os,
}: HandoffStateProps) {
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
				{handoffError ? (
					<button
						aria-label={VERIFY_HANDOFF_COPY.actions.tryAgain}
						className="rounded-[1.5rem] bg-white p-4 ring-1 ring-black/5 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:ring-white/10"
						onClick={onRetry}
						type="button"
					>
						<div className="flex size-[216px] items-center justify-center text-slate-600">
							<ArrowRotateCw className="size-6" />
						</div>
					</button>
				) : (
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
				)}
			</div>
		</div>
	);
}
