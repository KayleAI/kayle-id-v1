import { VERIFY_UNSUPPORTED_DEVICE_COPY } from "@kayle-id/config/verify-unsupported-device-copy";
import { Button } from "@kayleai/ui/button";
import { QRCodeSVG } from "qrcode.react";
import OctagonWarning from "@/icons/octagon-warning";
import Spinner from "@/icons/spinner";

type UnsupportedDeviceHandoffStateProps = {
  handoffError: string | null;
  handoffLoading: boolean;
  handoffUrl: string | null;
  onRetry: () => void | Promise<void>;
  os: string | null;
};

export function UnsupportedDeviceHandoffState({
  handoffError,
  handoffLoading,
  handoffUrl,
  onRetry,
  os,
}: UnsupportedDeviceHandoffStateProps) {
  if (handoffLoading) {
    return (
      <div className="flex items-center gap-3 pt-2 text-muted-foreground text-sm">
        <Spinner className="size-5" />
        <p>{VERIFY_UNSUPPORTED_DEVICE_COPY.handoff.loadingDescription}</p>
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
          {VERIFY_UNSUPPORTED_DEVICE_COPY.actions.tryAgain}
        </Button>
      </div>
    );
  }

  if (!handoffUrl) {
    return (
      <div className="flex items-center gap-3 pt-2 text-muted-foreground text-sm">
        <Spinner className="size-5" />
        <p>{VERIFY_UNSUPPORTED_DEVICE_COPY.handoff.waitingDescription}</p>
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
            <a href={handoffUrl}>
              {VERIFY_UNSUPPORTED_DEVICE_COPY.actions.openKayleIdApp}
            </a>
          }
        >
          {VERIFY_UNSUPPORTED_DEVICE_COPY.actions.openKayleIdApp}
        </Button>
      ) : null}
      <div className="flex justify-center rounded-lg border border-blue-200 border-dashed bg-white p-4">
        <QRCodeSVG
          bgColor="transparent"
          fgColor="currentColor"
          level="M"
          size={200}
          value={handoffUrl}
        />
      </div>
    </div>
  );
}
