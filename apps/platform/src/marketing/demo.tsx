import {
  getClaimLabel,
  minAgeThreshold,
  parseAgeOverThreshold,
} from "@kayle-id/config/share-claims";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { cn } from "@kayleai/ui/utils/cn";
import {
  CopyIcon,
  Loader2Icon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import {
  buildRequestedShareFields,
  demoClaimSections,
  formatPublicDemoPayload,
  getClaimDescription,
  getModeLabel,
  initialFieldModes,
  isLockedDemoClaim,
} from "@/demo/claim-fields";
import {
  decryptCompactJwe,
  generateDemoKeyPair,
  verifyWebhookSignature,
} from "@/demo/crypto";
import type {
  DemoFieldMode,
  DemoRunCreateResult,
  DemoRunSessionResult,
  DemoRunView,
} from "@/demo/types";
import {
  buildDemoDocumentPreview,
  buildDemoWebhookEventPreview,
  type DemoDocumentPreview,
  type DemoWebhookEventPreview,
  formatDemoClaimValue,
} from "@/marketing/demo-document";

const POLL_INTERVAL_MS = 2000;
const accordionPanelClass = "";

type ApiResponse<T> = {
  data: T | null;
  error: {
    code?: string | null;
    hint?: string | null;
    message?: string | null;
  } | null;
};

type ProcessedWebhookState = {
  decryptedPayload: string | null;
  error: string | null;
  status: "idle" | "invalid" | "verified" | "decrypted";
};

type ModeSelectorProps = {
  description?: string;
  disabled?: boolean;
  label: string;
  mode: DemoFieldMode;
  onChange: (mode: DemoFieldMode) => void;
};

type DemoNoticeProps = {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
};

type DemoStepId = "step-1" | "step-2" | "step-3";
type SelectionResult = ReturnType<typeof buildRequestedShareFields>;

const defaultWebhookState: ProcessedWebhookState = {
  decryptedPayload: null,
  error: null,
  status: "idle",
};

function getModeButtonClass({
  active,
  option,
}: {
  active: boolean;
  option: DemoFieldMode;
}): string {
  if (!active) {
    return "text-neutral-600 hover:text-neutral-950";
  }

  if (option === "optional" || option === "required") {
    return "bg-neutral-900 text-white";
  }

  return "bg-white text-neutral-950";
}

async function readJsonResponse<T>(
  response: Response
): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return {
      data: null,
      error: {
        message: "Unexpected response from the demo backend.",
      },
    };
  }
}

async function createDemoRun({
  publicJwk,
}: {
  publicJwk: JsonWebKey;
}): Promise<DemoRunCreateResult> {
  const response = await fetch("/api/demo/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      public_jwk: publicJwk,
    }),
  });

  const payload = await readJsonResponse<DemoRunCreateResult>(response);
  if (!(response.ok && payload.data)) {
    throw new Error(payload.error?.message ?? "Failed to create demo run.");
  }

  return payload.data;
}

async function createDemoVerificationSession({
  runId,
  shareFields,
}: {
  runId: string;
  shareFields:
    | Record<string, { reason: string; required: boolean }>
    | undefined;
}): Promise<DemoRunSessionResult> {
  const response = await fetch(`/api/demo/runs/${runId}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      shareFields
        ? {
            share_fields: shareFields,
          }
        : {}
    ),
  });

  const payload = await readJsonResponse<DemoRunSessionResult>(response);
  if (!(response.ok && payload.data)) {
    throw new Error(payload.error?.message ?? "Failed to create demo session.");
  }

  return payload.data;
}

async function getDemoRun(runId: string): Promise<DemoRunView> {
  const response = await fetch(`/api/demo/runs/${runId}`);
  const payload = await readJsonResponse<DemoRunView>(response);

  if (!(response.ok && payload.data)) {
    throw new Error(payload.error?.message ?? "Failed to load demo run.");
  }

  return payload.data;
}

async function processWebhookReceipt({
  privateKey,
  secret,
  webhook,
}: {
  privateKey: CryptoKey;
  secret: string;
  webhook: NonNullable<DemoRunView["webhook"]>;
}): Promise<ProcessedWebhookState> {
  const signatureHeader = webhook.signature_header;
  if (!signatureHeader) {
    return {
      decryptedPayload: null,
      error: "The webhook signature header was missing.",
      status: "invalid",
    };
  }

  const verification = await verifyWebhookSignature({
    payload: webhook.body,
    secret,
    signatureHeader,
  });

  if (!verification.ok) {
    return {
      decryptedPayload: null,
      error: verification.message,
      status: "invalid",
    };
  }

  try {
    const plaintext = await decryptCompactJwe({
      jwe: webhook.body,
      privateKey,
    });
    const decryptedPayload = (() => {
      try {
        return formatPublicDemoPayload(plaintext);
      } catch {
        return plaintext;
      }
    })();

    return {
      decryptedPayload,
      error: null,
      status: "decrypted",
    };
  } catch (error) {
    return {
      decryptedPayload: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to decrypt the webhook payload.",
      status: "invalid",
    };
  }
}

function DemoNotice({ action, children, className, title }: DemoNoticeProps) {
  return (
    <div
      className={cn(
        "border border-red-200/70 bg-red-50/40 px-4 py-3",
        className
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1.5 size-2 shrink-0 rounded-full bg-red-500/90" />
        <div className="min-w-0 flex-1">
          {title ? (
            <p className="font-medium text-red-950 text-sm">{title}</p>
          ) : null}
          <div
            className={cn(
              "text-sm leading-relaxed",
              title ? "mt-1 text-red-800/90" : "text-red-900/90"
            )}
          >
            {children}
          </div>
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function createDemoRunView(createdRun: DemoRunCreateResult): DemoRunView {
  return {
    id: createdRun.demo_run_id,
    endpoint_id: createdRun.endpoint_id,
    key_id: `demo_${createdRun.demo_run_id}`,
    org_slug: createdRun.org_slug,
    session_id: null,
    session_status: null,
    share_fields: null,
    verification_url: null,
    webhook: null,
  };
}

function getDemoStepSectionId(stepId: DemoStepId): string {
  return `demo-${stepId}`;
}

function DemoStepPanel({
  children,
  description,
  isLocked = false,
  isOpen,
  onOpen,
  stepId,
  stepNumber,
  title,
  className,
}: {
  children?: ReactNode;
  description: string;
  isLocked?: boolean;
  isOpen: boolean;
  onOpen?: () => void;
  stepId: DemoStepId;
  stepNumber: number;
  title: string;
  className?: string;
}) {
  const handleOpen = useCallback(
    (event: unknown) => {
      if (isLocked || isOpen) {
        return;
      }
      (event as React.MouseEvent<HTMLDivElement>).preventDefault();
      (event as React.MouseEvent<HTMLDivElement>).stopPropagation();

      onOpen?.();
    },
    [isLocked, isOpen, onOpen]
  );

  return (
    // biome-ignore lint/a11y: intentional
    <section
      className={cn(
        "scroll-mt-[180px] px-4 py-4 sm:scroll-mt-[240px] sm:px-5 sm:py-5",
        isLocked && "pointer-events-none blur-[2px]",
        className
      )}
      id={getDemoStepSectionId(stepId)}
      onClick={handleOpen}
      onKeyDown={handleOpen}
      onKeyUp={handleOpen}
    >
      <div className="flex w-full flex-col items-start space-y-10">
        <div className="relative flex w-full flex-col items-start gap-2.5 sm:flex-row sm:gap-5">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-balance font-medium text-3xl tracking-tight">
              {stepNumber}. {title}
            </h2>
            <p className="max-w-3xl text-balance text-base text-neutral-600 leading-relaxed">
              {description}
            </p>
          </div>

          <hr className="w-full border-neutral-200/80 sm:hidden" />
        </div>

        {isOpen ? (
          <div className="w-full min-w-0 flex-1">
            <div className="w-full min-w-0">{children}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ModeSelector({
  description,
  label,
  mode,
  onChange,
  disabled = false,
}: ModeSelectorProps) {
  const options: DemoFieldMode[] = ["off", "optional", "required"];

  return (
    <div className="border-neutral-200/80 border-b py-4 sm:py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 pr-0 sm:pr-6">
          <div className="font-medium text-base text-neutral-950">{label}</div>
          {description ? (
            <p className="max-w-xl text-neutral-500 text-sm leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        <div className="w-full sm:w-auto sm:shrink-0">
          {disabled ? (
            <div className="border border-neutral-200/80 px-4 py-3 text-left sm:text-right rounded-[1.25rem]">
              <div className="font-medium text-neutral-950 text-sm">
                Included automatically
              </div>
            </div>
          ) : (
            <div className="grid min-h-12 w-full grid-cols-3 border border-neutral-200 bg-neutral-100/90 p-1 sm:inline-flex sm:w-auto rounded-[1.25rem]">
              {options.map((option) => {
                const active = option === mode;
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      "min-h-10 w-full min-w-0 px-3 font-medium text-sm transition-colors sm:w-24 sm:px-4 rounded-[1rem]",
                      getModeButtonClass({ active, option })
                    )}
                    key={option}
                    onClick={() => onChange(option)}
                    type="button"
                  >
                    {getModeLabel(option)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgeGateSelector({
  errorMessage,
  thresholdText,
  onChange,
}: {
  errorMessage?: string | null;
  thresholdText: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isOff = thresholdText.trim() === "";
  const isInputActive = isInputFocused || !isOff;
  const hasError = Boolean(errorMessage);
  let ageThresholdStateClassName = "text-neutral-600 hover:text-neutral-950";

  if (isInputActive) {
    ageThresholdStateClassName = hasError
      ? "bg-white ring-1 ring-red-200"
      : "bg-white";
  }

  return (
    <div className="border-neutral-200/80 border-b py-4 sm:py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 pr-0 sm:pr-6">
          <div className="font-medium text-base text-neutral-950">
            Minimum age
          </div>
          <p className="max-w-xl text-neutral-500 text-sm leading-relaxed">
            Entering `18` asks for an over-18 proof rather than the full date of
            birth.
          </p>
        </div>
        <div className="w-full sm:w-auto sm:shrink-0">
          <div
            className={cn(
              "grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border p-1 sm:inline-flex sm:w-auto rounded-[1.25rem]",
              hasError
                ? "border-red-200/80 bg-red-50/70"
                : "border-neutral-200 bg-neutral-100/90"
            )}
          >
            <button
              aria-pressed={!isInputActive}
              className={cn(
                "min-h-10 w-full min-w-0 px-3 font-medium text-sm transition-colors sm:w-24 sm:px-4 rounded-[1rem]",
                getModeButtonClass({ active: !isInputActive, option: "off" })
              )}
              onClick={() => {
                onChange("");
                setIsInputFocused(false);
                inputRef.current?.blur();
              }}
              type="button"
            >
              Off
            </button>
            <div
              className={cn(
                "flex min-h-10 min-w-0 items-center transition-colors",
                ageThresholdStateClassName
              )}
            >
              <Label className="sr-only" htmlFor="age-threshold">
                Age threshold
              </Label>
              <Input
                aria-describedby={hasError ? "age-threshold-error" : undefined}
                aria-invalid={hasError || undefined}
                className="h-10 w-full min-w-0 border-0 bg-transparent px-0 text-center text-base shadow-none focus-visible:ring-0 sm:w-24"
                id="age-threshold"
                inputMode="numeric"
                min={minAgeThreshold}
                onBlur={() => {
                  setIsInputFocused(false);
                }}
                onChange={(event) => {
                  onChange(event.target.value);
                }}
                onFocus={() => {
                  setIsInputFocused(true);
                }}
                placeholder={String(minAgeThreshold)}
                ref={inputRef}
                value={thresholdText}
              />
            </div>
          </div>
        </div>
      </div>
      {errorMessage ? (
        <DemoNotice className="mt-4" title="Check the age rule">
          <span id="age-threshold-error">{errorMessage}</span>
        </DemoNotice>
      ) : null}
    </div>
  );
}

function buildHolderDisplayName({
  familyName,
  givenNames,
}: {
  familyName: string | null;
  givenNames: string | null;
}): string | null {
  return [givenNames, familyName].filter(Boolean).join(" ") || null;
}

function hasDocumentValue(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function DocumentPortrait({ preview }: { preview: DemoDocumentPreview }) {
  const supportsInlineImage = preview.documentPhoto?.format === "jpeg";

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-black/8 bg-zinc-100">
      {supportsInlineImage && preview.documentPhoto ? (
        <img
          alt="Document holder portrait"
          className="aspect-4/5 h-full w-full object-cover object-top"
          height={preview.documentPhoto.height}
          src={preview.documentPhoto.dataUri}
          width={preview.documentPhoto.width}
        />
      ) : (
        <div className="relative aspect-4/5 bg-zinc-100">
          <div className="-translate-x-1/2 absolute top-[18%] left-1/2 h-16 w-16 rounded-full bg-black/8" />
          <div className="-translate-x-1/2 absolute bottom-[12%] left-1/2 h-[48%] w-[46%] rounded-t-[999px] rounded-b-[1.2rem] bg-black/8" />
        </div>
      )}
    </div>
  );
}

const monospaceProfileClaims = new Set([
  "document_expiry_date",
  "document_number",
  "document_type_code",
  "kayle_document_id",
  "kayle_human_id",
  "mrz_optional_data",
]);

const profileClaimOrder = [
  "given_names",
  "family_name",
  "nationality_code",
  "date_of_birth",
  "sex_marker",
  "issuing_country_code",
  "document_number",
  "document_expiry_date",
  "mrz_optional_data",
  "document_type_code",
  "kayle_document_id",
  "kayle_human_id",
] as const;

const profileClaimOrderMap = new Map(
  profileClaimOrder.map((claimKey, index) => [claimKey, index])
);

const profileClaimLabels: Record<string, string> = {
  date_of_birth: "Date of birth",
  document_expiry_date: "Expires",
  document_number: "Document number",
  document_type_code: "Document type",
  issuing_country_code: "Issuing country",
  kayle_document_id: "Document ID",
  kayle_human_id: "Human ID",
  mrz_optional_data: "Personal number",
  nationality_code: "Nationality",
  sex_marker: "Sex",
};

type SharedProfileItem =
  | {
      kind: "age-gate";
      key: string;
      passed: boolean;
      threshold: number;
    }
  | {
      key: string;
      kind: "field";
      label: string;
      monospace?: boolean;
      value: string;
    };

function getProfileClaimSortOrder(claimKey: string): number {
  const ageThreshold = parseAgeOverThreshold(claimKey);
  if (ageThreshold) {
    return profileClaimOrderMap.get("date_of_birth") ?? 0;
  }

  return (
    profileClaimOrderMap.get(claimKey as (typeof profileClaimOrder)[number]) ??
    profileClaimOrder.length + 1
  );
}

function getProfileClaimLabel(claimKey: string): string {
  return profileClaimLabels[claimKey] ?? getClaimLabel(claimKey);
}

function shouldSkipSharedProfileClaim(claimKey: string): boolean {
  return (
    claimKey === "document_photo" ||
    claimKey === "family_name" ||
    claimKey === "given_names"
  );
}

function buildSharedProfileItem({
  claimKey,
  preview,
}: {
  claimKey: string;
  preview: DemoDocumentPreview;
}): SharedProfileItem | null {
  if (shouldSkipSharedProfileClaim(claimKey)) {
    return null;
  }

  const ageThreshold = parseAgeOverThreshold(claimKey);
  if (ageThreshold) {
    const ageGateValue = preview.claims[claimKey];
    return typeof ageGateValue === "boolean"
      ? {
          key: claimKey,
          kind: "age-gate",
          passed: ageGateValue,
          threshold: ageThreshold,
        }
      : null;
  }

  const rawValue = preview.claims[claimKey];
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const value = formatDemoClaimValue(claimKey, rawValue);
  if (!hasDocumentValue(value) || value === "Not shared") {
    return null;
  }

  return {
    key: claimKey,
    kind: "field",
    label: getProfileClaimLabel(claimKey),
    monospace: monospaceProfileClaims.has(claimKey),
    value,
  };
}

function buildSharedProfileItems(
  preview: DemoDocumentPreview
): SharedProfileItem[] {
  const claimKeys =
    preview.selectedFieldKeys.length > 0
      ? preview.selectedFieldKeys
      : Object.keys(preview.claims);

  return [...new Set(claimKeys)]
    .sort((left, right) => {
      const orderDifference =
        getProfileClaimSortOrder(left) - getProfileClaimSortOrder(right);
      return orderDifference !== 0
        ? orderDifference
        : left.localeCompare(right);
    })
    .map((claimKey) => buildSharedProfileItem({ claimKey, preview }))
    .filter((item): item is SharedProfileItem => item !== null);
}

function ProfileFieldItem({
  label,
  monospace = false,
  value,
}: {
  label: string;
  monospace?: boolean;
  value: string;
}) {
  return (
    <div>
      <dt className="font-medium text-neutral-950 text-sm">{label}</dt>
      <dd
        className={cn(
          "mt-1 break-words text-[1rem] text-neutral-700",
          monospace &&
            "break-all font-mono text-[0.92rem] text-neutral-950 tabular-nums tracking-[0.04em]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function AgeGateStatusItem({
  passed,
  threshold,
}: {
  passed: boolean;
  threshold: number;
}) {
  const Icon = passed ? ShieldCheckIcon : ShieldAlertIcon;

  return (
    <div>
      <dt className="font-medium text-neutral-950 text-sm">Age check</dt>
      <dd className="mt-1">
        <div className="flex items-center gap-2.5">
          <Icon
            className={cn(
              "size-4 shrink-0",
              passed ? "text-emerald-600" : "text-red-600"
            )}
          />
          <span
            className={cn("text-[1rem]", passed ? "text-emerald-700" : "text-red-700")}
          >
            {passed ? `Over ${threshold}` : `Under ${threshold}`}
          </span>
        </div>
      </dd>
    </div>
  );
}

function DemoDocumentPreviewPanel({
  payload,
  preview,
  webhookMetadataItems,
}: {
  payload: string;
  preview: DemoDocumentPreview;
  webhookMetadataItems: WebhookMetadataItem[];
}) {
  const displayName = buildHolderDisplayName({
    familyName: preview.familyName,
    givenNames: preview.givenNames,
  });
  const documentKindLabel =
    preview.documentKind === "id-card" ? "ID card" : "Passport";
  const sharedItems = buildSharedProfileItems(preview);

  return (
    <div className="divide-y divide-neutral-200/80">
      <section className="pb-6 sm:pb-8">
        <div className="grid gap-6 lg:grid-cols-[9rem_minmax(0,1fr)] lg:items-start">
          <div className="w-24 sm:w-34">
            <DocumentPortrait preview={preview} />
          </div>
          <div className="min-w-0">
            <h3 className="max-w-[16ch] text-balance text-neutral-950 capitalize tracking-tight text-2xl">
              {displayName || "No name"}
            </h3>
            <p className="mt-1.5 max-w-[54ch] text-pretty text-neutral-600 leading-6 text-lg">
              {sharedItems.filter((item) => !item.key.includes("kayle")).length > 0
                ? `${sharedItems.filter((item) => !item.key.includes("kayle")).length} shared ${
                    sharedItems.filter((item) => !item.key.includes("kayle")).length === 1 ? "field" : "fields"
                  } from the verified ${documentKindLabel.toLowerCase()} are listed below.`
                : `Verified ${documentKindLabel.toLowerCase()} data is ready to inspect.`}
            </p>
          </div>
        </div>
      </section>

      {sharedItems.filter((item) => !item.key.includes("kayle")).length > 0 ? (
        <section className="py-6 sm:py-8">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sharedItems.map((item) => {
              if (item.key.includes("kayle")) {
                // Skip Kayle-specific claims
                return null;
              }

              return (
                <div
                  className="p-4 sm:p-5 bg-neutral-50 rounded-md"
                  key={item.key}
                >
                  {item.kind === "age-gate" ? (
                    <AgeGateStatusItem
                      passed={item.passed}
                      threshold={item.threshold}
                    />
                  ) : (
                    <ProfileFieldItem
                      label={item.label}
                      monospace={item.monospace}
                      value={item.value}
                    />
                  )}
                </div>
              );
            })}
          </dl>
        </section>
      ) : null}

      {webhookMetadataItems.length > 0 ? (
        <section className="py-6 sm:py-8">
          <WebhookMetadataGrid items={webhookMetadataItems} />
        </section>
      ) : null}

      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <WebhookPayloadDisclosure payload={payload} />
      </section>
    </div>
  );
}

type WebhookMetadataItem = {
  label: string;
  monospace?: boolean;
  value: string;
};

function buildWebhookMetadataItems(
  preview: DemoWebhookEventPreview
): WebhookMetadataItem[] {
  const items: WebhookMetadataItem[] = [
    {
      label: "Event Type",
      monospace: true,
      value: preview.eventType ?? "Unknown",
    },
    {
      label: "Contract Version",
      monospace: true,
      value:
        preview.contractVersion === null
          ? "Unknown"
          : String(preview.contractVersion),
    },
    {
      label: "Verification Session",
      monospace: true,
      value: preview.verificationSessionId ?? "Unknown",
    },
  ];

  if (preview.verificationAttemptId) {
    items.push({
      label: "Verification Attempt",
      monospace: true,
      value: preview.verificationAttemptId,
    });
  }

  if (preview.failureCode) {
    items.push({
      label: "Failure Code",
      monospace: true,
      value: preview.failureCode,
    });
  }

  return items;
}

function ResultSectionHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="max-w-3xl">
      <h3 className="max-w-[18ch] text-balance text-neutral-950 tracking-tight text-2xl">
        {title}
      </h3>
      <p className="mt-1.5 max-w-[54ch] text-pretty text-neutral-600 leading-6 text-lg">
        {description}
      </p>
    </div>
  );
}

function WebhookMetadataGrid({
  columns = 2,
  items,
}: {
  columns?: 2 | 3;
  items: WebhookMetadataItem[];
}) {
  return (
    <dl
      className={cn(
        "grid gap-4",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
      )}
    >
      {items.map((item) => (
        <div
          className="p-4 sm:p-5 bg-neutral-50 rounded-md"
          key={`${item.label}-${item.value}`}
        >
          <ProfileFieldItem
            label={item.label}
            monospace={item.monospace}
            value={item.value}
          />
        </div>
      ))}
    </dl>
  );
}

function WebhookPayloadDisclosure({
  payload,
}: {
  payload: string;
}) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-col gap-4 marker:content-none sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-base text-neutral-950">Payload JSON</p>
          <p className="mt-2 max-w-[54ch] text-pretty text-sm text-neutral-600 leading-6 sm:text-base">
            Expand the verified JSON payload for a raw inspection view.
          </p>
        </div>
        <span className="shrink-0 font-medium text-[0.8rem] text-neutral-700">
          Show raw JSON
        </span>
      </summary>

      <div className="mt-5 overflow-hidden border border-neutral-200/80 rounded-4xl">
        <pre className="max-h-[28rem] overflow-auto bg-neutral-950 px-4 py-4 font-mono text-[0.82rem] text-neutral-100 leading-6 sm:px-5 sm:py-5">
          {payload}
        </pre>
      </div>
    </details>
  );
}

function DemoFailedAttemptPreviewPanel({
  payload,
  preview,
}: {
  payload: string;
  preview: DemoWebhookEventPreview;
}) {
  const summaryItems: WebhookMetadataItem[] = [
    {
      label: "Event Type",
      monospace: true,
      value: preview.eventType ?? "Unknown",
    },
    {
      label: "Failure Code",
      monospace: true,
      value: preview.failureCode ?? "Unknown",
    },
    {
      label: "Contract Version",
      monospace: true,
      value:
        preview.contractVersion === null
          ? "Unknown"
          : String(preview.contractVersion),
    },
  ];
  const identifierItems: WebhookMetadataItem[] = [
    {
      label: "Verification Session",
      monospace: true,
      value: preview.verificationSessionId ?? "Unknown",
    },
  ];
  const title = preview.failureTitle ?? preview.title;
  const description = preview.failureDescription ?? preview.description;

  if (preview.verificationAttemptId) {
    identifierItems.push({
      label: "Verification Attempt",
      monospace: true,
      value: preview.verificationAttemptId,
    });
  }

  return (
    <div className="border-neutral-200/80 border-t">
      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <ResultSectionHeading
          description={description}
          title={title}
        />
      </section>

      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <ResultSectionHeading
          description="Failure metadata and identifiers from the webhook event."
          title="Failure details"
        />
        <div className="mt-6 space-y-6">
          <WebhookMetadataGrid columns={3} items={summaryItems} />
          <WebhookMetadataGrid items={identifierItems} />
        </div>
      </section>

      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <ResultSectionHeading
          description="Inspect the verified failure payload exactly as it arrived."
          title="Raw payload"
        />
        <div className="mt-6">
          <WebhookPayloadDisclosure payload={payload} />
        </div>
      </section>
    </div>
  );
}

function DemoWebhookEventPreviewPanel({
  payload,
  preview,
}: {
  payload: string;
  preview: DemoWebhookEventPreview;
}) {
  const metadataItems = buildWebhookMetadataItems(preview);

  if (preview.eventType === "verification.attempt.failed") {
    return (
      <DemoFailedAttemptPreviewPanel payload={payload} preview={preview} />
    );
  }

  return (
    <div className="border-neutral-200/80 border-t">
      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <ResultSectionHeading
          description={preview.description}
          title={preview.title}
        />
      </section>

      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <ResultSectionHeading
          description="Identifiers and metadata from the latest verified event."
          title="Event details"
        />
        <div className="mt-6">
          <WebhookMetadataGrid items={metadataItems} />
        </div>
      </section>

      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <ResultSectionHeading
          description="Inspect the webhook JSON exactly as it was verified."
          title="Raw payload"
        />
        <div className="mt-6">
          <WebhookPayloadDisclosure payload={payload} />
        </div>
      </section>
    </div>
  );
}

function DocumentStatePanel({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="border-neutral-200/80 border-t">
      <section className="border-neutral-200/80 border-b py-6 sm:py-8">
        <ResultSectionHeading
          description={description}
          title={title}
        />
      </section>
    </div>
  );
}

function getWebhookPanelState({
  processedWebhook,
  run,
}: {
  processedWebhook: ProcessedWebhookState;
  run: DemoRunView | null;
}): { description: string; title: string } | null {
  const sessionStatus = run?.session_status ?? null;

  if (!run?.webhook) {
    return {
      title: sessionStatus?.is_terminal
        ? "Waiting for the webhook"
        : "Waiting for the result",
      description: sessionStatus?.is_terminal
        ? "This run has ended. Waiting for the final webhook delivery to arrive."
        : "Finish the verification on mobile and the latest webhook result will appear here.",
    };
  }

  if (processedWebhook.status === "verified") {
    return {
      title: "Preparing the result",
      description:
        "Verifying the signature and decrypting the webhook payload locally in this browser.",
    };
  }

  if (!processedWebhook.decryptedPayload) {
    return {
      title: "Preparing the result",
      description: "Waiting for the webhook payload to finish decrypting.",
    };
  }

  return {
    title:
      run.webhook.event_type === "verification.attempt.succeeded"
        ? "Document unavailable"
        : "Webhook event unavailable",
    description: "The result arrived, but it could not be formatted cleanly.",
  };
}

function RunStatusPanel({ run }: { run: DemoRunView | null }) {
  return (
    <div className="space-y-3 -mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {run?.verification_url ? (
          <Button
            render={
              <a
                href={run.verification_url}
                rel="noopener noreferrer"
                target="_blank"
              >
                Start verification
              </a>
            }
          >
            Start verification
          </Button>
        ) : (
          <Button disabled type="button">
            Start verification
          </Button>
        )}

        {run?.verification_url ? (
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(run.verification_url ?? "");
              toast.success("Verification URL copied");
            }}
            type="button"
            variant="outline"
          >
            <CopyIcon className="mr-2 size-4" />
            Copy URL
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function WebhookPanel({
  processedWebhook,
  run,
}: {
  processedWebhook: ProcessedWebhookState;
  run: DemoRunView | null;
}) {
  const documentPreview = useMemo(
    () => buildDemoDocumentPreview(processedWebhook.decryptedPayload),
    [processedWebhook.decryptedPayload]
  );
  const eventPreview = useMemo(
    () => buildDemoWebhookEventPreview(processedWebhook.decryptedPayload),
    [processedWebhook.decryptedPayload]
  );
  const state = useMemo(
    () => getWebhookPanelState({ processedWebhook, run }),
    [processedWebhook, run]
  );

  if (documentPreview) {
    return (
      <DemoDocumentPreviewPanel
        payload={processedWebhook.decryptedPayload ?? ""}
        preview={documentPreview}
        webhookMetadataItems={
          eventPreview ? buildWebhookMetadataItems(eventPreview) : []
        }
      />
    );
  }

  if (eventPreview && processedWebhook.decryptedPayload) {
    return (
      <DemoWebhookEventPreviewPanel
        payload={processedWebhook.decryptedPayload}
        preview={eventPreview}
      />
    );
  }

  if (processedWebhook.error) {
    return (
      <DemoNotice title="Local verification failed">
        {processedWebhook.error}
      </DemoNotice>
    );
  }

  if (!state) {
    return null;
  }

  return (
    <DocumentStatePanel description={state.description} title={state.title} />
  );
}

function useDemoRunInitialization({
  handleGenerateRun,
  hasInitializedRun,
  setHasInitializedRun,
}: {
  handleGenerateRun: () => void;
  hasInitializedRun: boolean;
  setHasInitializedRun: (value: boolean) => void;
}) {
  useEffect(() => {
    if (hasInitializedRun) {
      return;
    }

    setHasInitializedRun(true);
    handleGenerateRun();
  }, [handleGenerateRun, hasInitializedRun, setHasInitializedRun]);
}

function useDemoStepProgression({
  canReviewOutcome,
  hasSession,
  onOpenStepChange,
}: {
  canReviewOutcome: boolean;
  hasSession: boolean;
  onOpenStepChange: (step: DemoStepId) => void;
}) {
  const previousHasSessionRef = useRef(false);
  const previousCanReviewOutcomeRef = useRef(false);

  useEffect(() => {
    if (!hasSession) {
      previousHasSessionRef.current = false;
      previousCanReviewOutcomeRef.current = false;
      onOpenStepChange("step-1");
      return;
    }

    if (!previousHasSessionRef.current) {
      onOpenStepChange("step-2");
    }

    if (canReviewOutcome && !previousCanReviewOutcomeRef.current) {
      onOpenStepChange("step-3");
    }

    previousHasSessionRef.current = hasSession;
    previousCanReviewOutcomeRef.current = canReviewOutcome;
  }, [canReviewOutcome, hasSession, onOpenStepChange]);
}

function useDemoStepScroll({ openStep }: { openStep: DemoStepId }) {
  const hasMountedRef = useRef(false);
  const hasProgressedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    // This is to prevent the scroll from happening on page load.
    if (!hasProgressedRef.current && openStep === "step-1") {
      return;
    }
    if (openStep === "step-2") {
      hasProgressedRef.current = true;
    }

    const panel = document.getElementById(getDemoStepSectionId(openStep));
    if (!panel) {
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const frameId = window.requestAnimationFrame(() => {
      panel.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [openStep]);
}

function useDemoRunPolling({
  onRunError,
  onRunLoaded,
  runId,
}: {
  onRunError: (message: string) => void;
  onRunLoaded: (nextRun: DemoRunView) => void;
  runId: string | null;
}) {
  useEffect(() => {
    if (!runId) {
      return;
    }

    let cancelled = false;

    const poll = () => {
      getDemoRun(runId)
        .then((nextRun) => {
          if (!cancelled) {
            onRunLoaded(nextRun);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            onRunError(
              error instanceof Error
                ? error.message
                : "Failed to refresh demo run."
            );
          }
        });
    };

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [onRunError, onRunLoaded, runId]);
}

function useProcessedWebhookReceipt({
  lastProcessedReceipt,
  onProcessedWebhookChange,
  onReceiptProcessed,
  privateKey,
  run,
  signingSecret,
}: {
  lastProcessedReceipt: string | null;
  onProcessedWebhookChange: (nextState: ProcessedWebhookState) => void;
  onReceiptProcessed: (receiptId: string) => void;
  privateKey: CryptoKey | null;
  run: DemoRunView | null;
  signingSecret: string | null;
}) {
  useEffect(() => {
    const receiptId = run?.webhook
      ? `${run.webhook.delivery_id ?? ""}:${run.webhook.received_at}`
      : null;

    if (!(receiptId && run?.webhook && privateKey && signingSecret)) {
      return;
    }

    if (receiptId === lastProcessedReceipt) {
      return;
    }

    onReceiptProcessed(receiptId);

    let cancelled = false;
    const webhook = run.webhook;

    onProcessedWebhookChange({
      decryptedPayload: null,
      error: null,
      status: "verified",
    });

    processWebhookReceipt({
      privateKey,
      secret: signingSecret,
      webhook,
    }).then((nextState) => {
      if (!cancelled) {
        onProcessedWebhookChange(nextState);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    lastProcessedReceipt,
    onProcessedWebhookChange,
    onReceiptProcessed,
    privateKey,
    run,
    signingSecret,
  ]);
}

function DemoErrorAlert({
  onReset,
  runError,
}: {
  onReset: () => void;
  runError: string | null;
}) {
  if (!runError) {
    return null;
  }

  return (
    <DemoNotice
      action={
        <Button onClick={onReset} type="button" variant="outline">
          Try again
        </Button>
      }
      title="Demo error"
    >
      {runError}
    </DemoNotice>
  );
}

function DemoComposerStep({
  ageThresholdText,
  fieldModes,
  hasSession,
  isCreatingRun,
  isCreatingSession,
  isRestartingDemo,
  onAgeThresholdChange,
  onClaimModeChange,
  onCreateSession,
  onOpenStep,
  onRestartDemo,
  openStep,
  runId,
  selectionResult,
}: {
  ageThresholdText: string;
  fieldModes: Record<string, DemoFieldMode>;
  hasSession: boolean;
  isCreatingRun: boolean;
  isCreatingSession: boolean;
  isRestartingDemo: boolean;
  onAgeThresholdChange: (value: string) => void;
  onClaimModeChange: (claimKey: string, mode: DemoFieldMode) => void;
  onCreateSession: () => void;
  onOpenStep: (step: DemoStepId) => void;
  onRestartDemo: () => void;
  openStep: DemoStepId;
  runId: string | null;
  selectionResult: SelectionResult;
}) {
  return (
    <DemoStepPanel
      description="Pick the claims you would like to request."
      isOpen={openStep === "step-1"}
      onOpen={() => onOpenStep("step-1")}
      stepId="step-1"
      stepNumber={1}
      title="Choose the fields you want to test"
    >
      <div className="space-y-6">
        {demoClaimSections.map((section) => (
          <section className="space-y-4" key={section.title}>
            <div>
              <h2 className="font-medium text-lg text-neutral-950">
                {section.title}
              </h2>
              <p className="text-neutral-500 text-sm">{section.description}</p>
            </div>
            <div className="border-neutral-200/80 border-t">
              {section.claims.map((claimKey) => (
                <ModeSelector
                  description={getClaimDescription(claimKey)}
                  disabled={isLockedDemoClaim(claimKey)}
                  key={claimKey}
                  label={getClaimLabel(claimKey)}
                  mode={fieldModes[claimKey] ?? "off"}
                  onChange={(mode) => {
                    onClaimModeChange(claimKey, mode);
                  }}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="space-y-4">
          <div>
            <h2 className="font-medium text-lg text-neutral-950">Age Gate</h2>
            <p className="text-neutral-500 text-sm">
              Use this when you need to check if a user meets a minimum age
              requirement.
            </p>
          </div>
          <div className="border-neutral-200/80 border-t">
            <AgeGateSelector
              errorMessage={selectionResult.ok ? null : selectionResult.message}
              onChange={onAgeThresholdChange}
              thresholdText={ageThresholdText}
            />
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {hasSession || isRestartingDemo ? (
            <Button
              disabled={isCreatingSession || isCreatingRun}
              onClick={onRestartDemo}
              type="button"
            >
              {isCreatingSession || isCreatingRun ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : null}
              Restart demo
            </Button>
          ) : (
            <Button
              disabled={
                isCreatingSession ||
                isCreatingRun ||
                !runId ||
                !selectionResult.ok
              }
              onClick={onCreateSession}
              type="button"
            >
              {isCreatingSession ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : null}
              Create session
            </Button>
          )}
        </div>
      </div>
    </DemoStepPanel>
  );
}

function DemoVerificationStep({
  hasSession,
  onOpenStep,
  openStep,
  run,
}: {
  hasSession: boolean;
  onOpenStep: (step: DemoStepId) => void;
  openStep: DemoStepId;
  run: DemoRunView | null;
}) {
  return (
    <DemoStepPanel
      description="Open the session on mobile."
      isLocked={!hasSession}
      isOpen={openStep === "step-2"}
      onOpen={() => onOpenStep("step-2")}
      stepId="step-2"
      stepNumber={2}
      title="Complete the live verification"
    >
      <RunStatusPanel run={run} />
    </DemoStepPanel>
  );
}

function DemoOutcomeStep({
  canReviewOutcome,
  onOpenStep,
  openStep,
  processedWebhook,
  run,
}: {
  canReviewOutcome: boolean;
  onOpenStep: (step: DemoStepId) => void;
  openStep: DemoStepId;
  processedWebhook: ProcessedWebhookState;
  run: DemoRunView | null;
}) {
  const sessionStatus = run?.session_status ?? null;
  const isWaitingForTerminalWebhook = Boolean(
    sessionStatus?.is_terminal && !run?.webhook
  );

  return (
    <DemoStepPanel
      description="Review the result or restart the demo."
      isLocked={!canReviewOutcome}
      isOpen={openStep === "step-3"}
      onOpen={() => onOpenStep("step-3")}
      stepId="step-3"
      stepNumber={3}
      title="Review the outcome"
    >
      <div className="space-y-8">
        {isWaitingForTerminalWebhook ? (
          <Alert>
            <AlertTitle>Waiting for the webhook delivery</AlertTitle>
            <AlertDescription>
              This run has ended, but the final webhook event has not arrived
              yet. Keep this page open or restart the demo to try again.
            </AlertDescription>
          </Alert>
        ) : null}

        <WebhookPanel processedWebhook={processedWebhook} run={run} />
      </div>
    </DemoStepPanel>
  );
}

export function Demo() {
  const [fieldModes, setFieldModes] =
    useState<Record<string, DemoFieldMode>>(initialFieldModes);
  const [ageThresholdText, setAgeThresholdText] = useState("");
  const [openStep, setOpenStep] = useState<DemoStepId>("step-1");
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [signingSecret, setSigningSecret] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<DemoRunView | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isRestartingDemo, setIsRestartingDemo] = useState(false);
  const [processedWebhook, setProcessedWebhook] =
    useState<ProcessedWebhookState>(defaultWebhookState);
  const [lastProcessedReceipt, setLastProcessedReceipt] = useState<
    string | null
  >(null);
  const [hasInitializedRun, setHasInitializedRun] = useState(false);

  const selectionResult = useMemo(
    () =>
      buildRequestedShareFields({
        ageThresholdText,
        fieldModes,
      }),
    [ageThresholdText, fieldModes]
  );
  const sessionStatus = run?.session_status ?? null;
  const hasSession = Boolean(run?.session_id);
  const canReviewOutcome = Boolean(sessionStatus?.is_terminal || run?.webhook);

  const clearRunState = useCallback(() => {
    setOpenStep("step-1");
    setPrivateKey(null);
    setSigningSecret(null);
    setRunId(null);
    setRun(null);
    setRunError(null);
    setIsCreatingRun(false);
    setIsCreatingSession(false);
    setIsRestartingDemo(false);
    setProcessedWebhook(defaultWebhookState);
    setLastProcessedReceipt(null);
    setHasInitializedRun(false);
  }, []);

  const handleReset = useCallback(() => {
    setFieldModes(initialFieldModes);
    setAgeThresholdText("");
    clearRunState();
  }, [clearRunState]);

  const provisionDemoRun = useCallback(async () => {
    const keyPair = await generateDemoKeyPair();
    const createdRun = await createDemoRun({
      publicJwk: keyPair.publicJwk,
    });
    const nextRun = createDemoRunView(createdRun);

    setPrivateKey(keyPair.privateKey);
    setSigningSecret(createdRun.signing_secret);
    setRunId(createdRun.demo_run_id);
    setRun(nextRun);

    return {
      nextRun,
      runId: createdRun.demo_run_id,
    };
  }, []);

  const handleGenerateRun = useCallback(async () => {
    setIsCreatingRun(true);
    setRunError(null);
    setProcessedWebhook(defaultWebhookState);
    setLastProcessedReceipt(null);

    try {
      await provisionDemoRun();
      toast.success("Secure demo run created");
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Failed to create demo run."
      );
    } finally {
      setIsCreatingRun(false);
    }
  }, [provisionDemoRun]);

  const handleOpenStep = useCallback((step: DemoStepId) => {
    setOpenStep(step);
  }, []);

  const handleClaimModeChange = useCallback(
    (claimKey: string, mode: DemoFieldMode) => {
      setFieldModes((current) => ({
        ...current,
        [claimKey]: mode,
      }));
    },
    []
  );

  const handleCreateSession = useCallback(async () => {
    if (!runId) {
      setRunError("Preparing the secure demo run. Try again in a moment.");
      return;
    }

    if (!selectionResult.ok) {
      setRunError(selectionResult.message);
      return;
    }

    setIsCreatingSession(true);
    setRunError(null);

    try {
      const session = await createDemoVerificationSession({
        runId,
        shareFields: selectionResult.shareFields,
      });

      setRun((current) =>
        current
          ? {
              ...current,
              session_id: session.session_id,
              share_fields: session.share_fields,
              verification_url: session.verification_url,
            }
          : null
      );
      toast.success("Verification session created");
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : "Failed to create demo session."
      );
    } finally {
      setIsCreatingSession(false);
    }
  }, [runId, selectionResult]);

  const handleRestartDemo = useCallback(async () => {
    if (!selectionResult.ok) {
      setRunError(null);
      setOpenStep("step-1");
      return;
    }

    clearRunState();
    setHasInitializedRun(true);
    setIsRestartingDemo(true);
    setIsCreatingRun(true);
    setIsCreatingSession(true);
    setRunError(null);

    try {
      const { nextRun, runId: nextRunId } = await provisionDemoRun();
      const session = await createDemoVerificationSession({
        runId: nextRunId,
        shareFields: selectionResult.shareFields,
      });

      setRun({
        ...nextRun,
        session_id: session.session_id,
        share_fields: session.share_fields,
        verification_url: session.verification_url,
      });
      toast.success("Demo restarted");
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Failed to restart demo."
      );
    } finally {
      setIsRestartingDemo(false);
      setIsCreatingRun(false);
      setIsCreatingSession(false);
    }
  }, [clearRunState, provisionDemoRun, selectionResult]);

  const handleRunLoaded = useCallback((nextRun: DemoRunView) => {
    setRun(nextRun);
    setRunError(null);
  }, []);

  const handleRunError = useCallback((message: string) => {
    setRunError(message);
  }, []);

  useDemoRunInitialization({
    handleGenerateRun,
    hasInitializedRun,
    setHasInitializedRun,
  });

  useDemoStepProgression({
    canReviewOutcome,
    hasSession,
    onOpenStepChange: handleOpenStep,
  });

  useDemoStepScroll({
    openStep,
  });

  useDemoRunPolling({
    onRunError: handleRunError,
    onRunLoaded: handleRunLoaded,
    runId,
  });

  useProcessedWebhookReceipt({
    lastProcessedReceipt,
    onProcessedWebhookChange: setProcessedWebhook,
    onReceiptProcessed: setLastProcessedReceipt,
    privateKey,
    run,
    signingSecret,
  });

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <PageHeading
          description="Test Kayle ID in your local browser — no data is stored as part of our privacy guarantee."
          title="See how Kayle ID works with a demo."
        />

        <div className="mt-12 space-y-8 sm:mt-16 lg:mt-20" id="demo-flow">
          <DemoErrorAlert onReset={handleReset} runError={runError} />

          <div className={accordionPanelClass}>
            <div className="divide-y divide-neutral-200/70">
              <DemoComposerStep
                ageThresholdText={ageThresholdText}
                fieldModes={fieldModes}
                hasSession={hasSession}
                isCreatingRun={isCreatingRun}
                isCreatingSession={isCreatingSession}
                isRestartingDemo={isRestartingDemo}
                onAgeThresholdChange={setAgeThresholdText}
                onClaimModeChange={handleClaimModeChange}
                onCreateSession={handleCreateSession}
                onOpenStep={handleOpenStep}
                onRestartDemo={handleRestartDemo}
                openStep={openStep}
                runId={runId}
                selectionResult={selectionResult}
              />

              <DemoVerificationStep
                hasSession={hasSession}
                onOpenStep={handleOpenStep}
                openStep={openStep}
                run={run}
              />

              <DemoOutcomeStep
                canReviewOutcome={canReviewOutcome}
                onOpenStep={handleOpenStep}
                openStep={openStep}
                processedWebhook={processedWebhook}
                run={run}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
