import { getClaimLabel, minAgeThreshold } from "@kayle-id/config/share-claims";
import {
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@kayleai/ui/command";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kayleai/ui/tooltip";
import { cn } from "@kayleai/ui/utils/cn";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	demoClaimSections,
	getClaimDescription,
	getModeLabel,
	isLockedDemoClaim,
} from "@/demo/claim-fields";
import type { DemoFieldMode } from "@/demo/types";
import { DemoComposerActions } from "@/marketing/demo/composer-actions";
import { DEFAULT_AGE_THRESHOLD } from "@/marketing/demo/constants";
import { DemoShell } from "@/marketing/demo/demo-shell";
import { DemoStepPanel } from "@/marketing/demo/demo-step-panel";
import type { DemoComposerProps, DemoCopy } from "@/marketing/demo/types";

const ID_DEMO_COPY: DemoCopy = {
	title: "See how Kayle ID works with a demo.",
	description:
		"Test Kayle ID in your local browser — demo session metadata and webhook deliveries are stored temporarily, then automatically deleted.",
};

const ID_COMPOSER_DESCRIPTION = "Pick the claims you would like to request.";
const ID_COMPOSER_TITLE = "Choose the fields you want to test";

function ClaimPicker({
	ageErrorMessage,
	ageThresholdText,
	fieldModes,
	onAgeThresholdChange,
	onClaimModeChange,
}: {
	ageErrorMessage?: string | null;
	ageThresholdText: string;
	fieldModes: Record<string, DemoFieldMode>;
	onAgeThresholdChange: (value: string) => void;
	onClaimModeChange: (claimKey: string, mode: DemoFieldMode) => void;
}) {
	const isAgeSelected = ageThresholdText.trim() !== "";
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		function handlePointerDown(event: PointerEvent) {
			const node = containerRef.current;
			if (node && !node.contains(event.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [open]);

	const selectedClaims = useMemo(
		() =>
			demoClaimSections.flatMap((section) =>
				section.claims
					.filter((claimKey) => !isLockedDemoClaim(claimKey))
					.filter((claimKey) => {
						const mode = fieldModes[claimKey] ?? "off";
						return mode === "optional" || mode === "required";
					})
					.map((claimKey) => ({ claimKey, sectionTitle: section.title })),
			),
		[fieldModes],
	);

	const sectionsForPicker = useMemo(
		() =>
			demoClaimSections
				.map((section) => ({
					title: section.title,
					claims: section.claims.filter(
						(claimKey) => !isLockedDemoClaim(claimKey),
					),
				}))
				.filter((section) => section.claims.length > 0),
		[],
	);

	return (
		<div className="space-y-4">
			<div className="relative" ref={containerRef}>
				<CommandPrimitive
					className="overflow-visible"
					label="Add claim"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							setOpen(false);
						}
					}}
					shouldFilter
				>
					<div className="flex h-11 items-center gap-2 rounded-[1rem] border border-border bg-background px-3 has-[input:focus]:border-ring">
						<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
						<CommandPrimitive.Input
							className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
							onClick={() => setOpen(true)}
							onFocus={() => setOpen(true)}
							onValueChange={setQuery}
							placeholder="Search claims to add…"
							value={query}
						/>
					</div>
					{open ? (
						<div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg ring-1 ring-border/60">
							<CommandList className="max-h-72 **:data-[slot=command-group-items]:space-y-0.5 **:[[data-slot=command-item][data-selected=false]]:bg-transparent **:[[data-slot=command-item][data-selected=true]]:bg-muted">
								<CommandEmpty>No matching claims.</CommandEmpty>
								<CommandGroup heading="Constraints">
									<CommandItem
										data-checked={isAgeSelected ? "true" : undefined}
										keywords={[
											"minimum age",
											"age gate",
											"age threshold",
											"over 18",
											"age verification",
										]}
										onSelect={() => {
											if (isAgeSelected) {
												onAgeThresholdChange("");
											} else {
												onAgeThresholdChange(DEFAULT_AGE_THRESHOLD);
											}
											setQuery("");
										}}
										value="minimum_age"
									>
										<span className="font-medium text-foreground">
											Age requirement
										</span>
										<span className="ml-2 flex-1 truncate text-muted-foreground text-xs">
											Check whether the person meets a selected age.
										</span>
									</CommandItem>
								</CommandGroup>
								{sectionsForPicker.map((section) => (
									<CommandGroup heading={section.title} key={section.title}>
										{section.claims.map((claimKey) => {
											const mode = fieldModes[claimKey] ?? "off";
											const isSelected =
												mode === "optional" || mode === "required";
											return (
												<CommandItem
													data-checked={isSelected ? "true" : undefined}
													key={claimKey}
													keywords={[
														getClaimLabel(claimKey),
														getClaimDescription(claimKey) ?? "",
													]}
													onSelect={() => {
														onClaimModeChange(
															claimKey,
															isSelected ? "off" : "optional",
														);
														setQuery("");
													}}
													value={claimKey}
												>
													<span className="font-medium text-foreground">
														{getClaimLabel(claimKey)}
													</span>
													{getClaimDescription(claimKey) ? (
														<span className="ml-2 flex-1 truncate text-muted-foreground text-xs">
															{getClaimDescription(claimKey)}
														</span>
													) : null}
												</CommandItem>
											);
										})}
									</CommandGroup>
								))}
							</CommandList>
						</div>
					) : null}
				</CommandPrimitive>
			</div>

			{selectedClaims.length === 0 && !isAgeSelected ? (
				<p className="rounded-[1rem] border border-border/70 border-dashed bg-background/50 px-4 py-4.5 text-center text-muted-foreground text-sm">
					Nothing selected — search above to add a claim or constraint.
				</p>
			) : (
				<ul className="divide-y divide-border/70 overflow-hidden rounded-[1rem] border border-border/70 bg-background">
					{isAgeSelected ? (
						<li className="flex items-center gap-3 px-3 py-2.5">
							<div className="min-w-0 flex-1">
								<div className="font-medium text-foreground text-sm">
									Age requirement
								</div>
								<div className="hidden truncate text-muted-foreground text-xs sm:block">
									Checks whether the person meets the selected age.
								</div>
								{ageErrorMessage ? (
									<div className="mt-1 text-red-700 text-xs dark:text-red-300">
										{ageErrorMessage}
									</div>
								) : null}
							</div>
							<Label className="sr-only" htmlFor="claim-age-threshold">
								Age requirement
							</Label>
							<Input
								aria-invalid={ageErrorMessage ? true : undefined}
								className={cn(
									"h-9 w-20 rounded-[0.75rem] text-center text-sm shadow-none",
									ageErrorMessage
										? "border-red-200 ring-1 ring-red-200 dark:border-red-900/70 dark:ring-red-900/70"
										: "border-border",
								)}
								id="claim-age-threshold"
								inputMode="numeric"
								min={minAgeThreshold}
								name="claim-age"
								onChange={(event) => {
									onAgeThresholdChange(event.target.value);
								}}
								placeholder={DEFAULT_AGE_THRESHOLD}
								value={ageThresholdText}
							/>
							<button
								aria-label="Remove age requirement"
								className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								onClick={() => onAgeThresholdChange("")}
								type="button"
							>
								<XIcon className="size-4" />
							</button>
						</li>
					) : null}
					{selectedClaims.map(({ claimKey }) => {
						const mode: DemoFieldMode =
							fieldModes[claimKey] === "required" ? "required" : "optional";
						return (
							<li
								className="flex items-center gap-3 px-3 py-2.5"
								key={claimKey}
							>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-foreground text-sm">
										{getClaimLabel(claimKey)}
									</div>
									{getClaimDescription(claimKey) ? (
										<div className="hidden truncate text-muted-foreground text-xs sm:block">
											{getClaimDescription(claimKey)}
										</div>
									) : null}
								</div>
								<select
									aria-label={`${getClaimLabel(claimKey)} mode`}
									className="shrink-0 rounded-full border border-border bg-muted/80 px-3 py-1 font-medium text-foreground text-xs sm:hidden"
									onChange={(event) => {
										onClaimModeChange(
											claimKey,
											event.target.value as DemoFieldMode,
										);
									}}
									value={mode}
								>
									<option
										disabled={claimKey === "date_of_birth" && isAgeSelected}
										value="optional"
									>
										{getModeLabel("optional")}
									</option>
									<option value="required">{getModeLabel("required")}</option>
								</select>
								<div className="hidden shrink-0 rounded-full border border-border bg-muted/80 p-0.5 sm:inline-flex">
									{(["optional", "required"] as const).map((option) => {
										const active = mode === option;
										const isDisabled =
											claimKey === "date_of_birth" &&
											isAgeSelected &&
											option === "optional";
										const button = (
											<button
												aria-pressed={active}
												className={cn(
													"rounded-full px-3 py-1 font-medium text-xs transition-colors",
													active
														? "bg-foreground text-background"
														: "text-muted-foreground hover:text-foreground",
													isDisabled &&
														"cursor-not-allowed text-muted-foreground/40 hover:text-muted-foreground/40",
												)}
												disabled={isDisabled}
												onClick={() => onClaimModeChange(claimKey, option)}
												type="button"
											>
												{getModeLabel(option)}
											</button>
										);
										if (isDisabled) {
											return (
												<Tooltip key={option}>
													<TooltipTrigger aria-label="Why is this disabled?">
														<span className="inline-flex">{button}</span>
													</TooltipTrigger>
													<TooltipContent className="max-w-xs text-center">
														Date of Birth is required when an age requirement is
														active
													</TooltipContent>
												</Tooltip>
											);
										}
										return <span key={option}>{button}</span>;
									})}
								</div>
								<button
									aria-label={`Remove ${getClaimLabel(claimKey)}`}
									className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
									onClick={() => onClaimModeChange(claimKey, "off")}
									type="button"
								>
									<XIcon className="size-4" />
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function IdDemoComposer({
	ageThresholdText,
	fieldModes,
	hasSession,
	isCreatingRun,
	isCreatingSession,
	isRestartingDemo,
	onAgeThresholdChange,
	onClaimModeChange,
	onCreateSession,
	onRestartDemo,
	runId,
	selectionResult,
}: DemoComposerProps) {
	return (
		<DemoStepPanel
			description={ID_COMPOSER_DESCRIPTION}
			stepId="step-1"
			title={ID_COMPOSER_TITLE}
		>
			<div className="space-y-6">
				<ClaimPicker
					ageErrorMessage={selectionResult.ok ? null : selectionResult.message}
					ageThresholdText={ageThresholdText}
					fieldModes={fieldModes}
					onAgeThresholdChange={onAgeThresholdChange}
					onClaimModeChange={onClaimModeChange}
				/>

				<DemoComposerActions
					hasSession={hasSession}
					isCreatingRun={isCreatingRun}
					isCreatingSession={isCreatingSession}
					isRestartingDemo={isRestartingDemo}
					onCreateSession={onCreateSession}
					onRestartDemo={onRestartDemo}
					runId={runId}
					selectionResult={selectionResult}
				/>
			</div>
		</DemoStepPanel>
	);
}

export function IdDemo() {
	return (
		<DemoShell
			Composer={IdDemoComposer}
			copy={ID_DEMO_COPY}
			initialAgeThresholdText=""
		/>
	);
}
