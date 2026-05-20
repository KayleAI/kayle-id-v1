import { Logo } from "@kayle-id/ui/components/logo";
import type { ReactNode } from "react";

type PageShellProps = {
	heading: ReactNode;
	description: ReactNode;
	children?: ReactNode;
	actions?: ReactNode;
};

export function PageShell({
	heading,
	description,
	children,
	actions,
}: PageShellProps) {
	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex w-full max-w-md flex-col">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{heading}
					</h1>
					<div className="text-lg text-muted-foreground">{description}</div>
				</div>

				{children}

				{actions ? (
					<div className="flex flex-col space-y-4">{actions}</div>
				) : null}
			</div>
		</div>
	);
}
