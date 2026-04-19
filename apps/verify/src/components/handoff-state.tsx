import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
import { Button } from "@kayleai/ui/button";
import { QRCodeSVG } from "qrcode.react";
import OctagonWarning from "@/icons/octagon-warning";
import Spinner from "@/icons/spinner";

type HandoffStateProps = {
  handoffError: string | null;
  handoffLoading: boolean;
  handoffUrl: string | null;
  onRetry: () => void | Promise<void>;
  os: string | null;
};

export function HandoffState({
  handoffError,
  handoffLoading,
  handoffUrl,
  onRetry,
  os,
}: HandoffStateProps) {
  if (handoffLoading) {
    return (
      <div className="flex items-center gap-3 pt-2 text-muted-foreground text-sm">
        <Spinner className="size-5" />
        <p>{VERIFY_HANDOFF_COPY.handoff.loadingDescription}</p>
      </div>
    );
  }

  if (handoffError) {
    return (
      <div className="space-y-4 pt-2 text-sm">
        <div className="flex items-center gap-3 text-red-700">
          <OctagonWarning className="size-5 shrink-0" />
          <p>{handoffError}</p>
        </div>
        <Button className="w-full" onClick={onRetry} type="button">
          {VERIFY_HANDOFF_COPY.actions.tryAgain}
        </Button>
      </div>
    );
  }

  if (!handoffUrl) {
    return (
      <div className="flex items-center gap-3 pt-2 text-muted-foreground text-sm">
        <Spinner className="size-5" />
        <p>{VERIFY_HANDOFF_COPY.handoff.waitingDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      {os === "ios" ? (
        <Button
          className="w-full"
          nativeButton={false}
          render={
            <a href={handoffUrl}>{VERIFY_HANDOFF_COPY.actions.openKayleIdApp}</a>
          }
        >
          {VERIFY_HANDOFF_COPY.actions.openKayleIdApp}
        </Button>
      ) : null}
      <div className="flex justify-center">
        <div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-black/5">
          <QRCodeSVG
            bgColor="white"
            className="text-slate-950"
            fgColor="currentColor"
            level="M"
            size={216}
            value={handoffUrl}
          />
        </div>
      </div>
    </div>
  );
}
