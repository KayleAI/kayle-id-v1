import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

// Section-keyed sidebar nav. Each section is one logical product
// surface; items inside are the individual debug pages. Adding a new
// debug surface (MRZ parser, DG2 viewer, etc.) is one new entry here
// + the matching route file(s) under `src/routes/`.
const SECTIONS: ReadonlyArray<{
	label: string;
	items: ReadonlyArray<{ path: string; label: string }>;
}> = [
	{
		label: "Biometric Verifier",
		items: [
			{ path: "/biometric/full-pipeline", label: "Full pipeline" },
			{ path: "/biometric/liveness", label: "Liveness only" },
			{ path: "/biometric/face-match", label: "Face match only" },
		],
	},
];

function RootLayout() {
	return (
		<div className="flex min-h-screen bg-zinc-950 text-zinc-100">
			<aside className="flex w-64 flex-col gap-6 border-r border-zinc-800 bg-zinc-950 p-6">
				<div>
					<h1 className="text-lg font-semibold tracking-tight">
						Kayle ID Debugger
					</h1>
				</div>
				<nav className="flex flex-col gap-6 w-full -mx-2">
					{SECTIONS.map((section) => (
						<div key={section.label} className="flex flex-col gap-1">
							<div className="px-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
								{section.label}
							</div>
							{section.items.map((item) => (
								<Link
									key={item.path}
									to={item.path}
									className="rounded px-2 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
									activeProps={{
										className:
											"rounded px-2 py-1.5 text-sm bg-zinc-900 text-emerald-300",
									}}
								>
									{item.label}
								</Link>
							))}
						</div>
					))}
				</nav>
			</aside>
			<main className="flex-1 overflow-x-hidden">
				<div className="mx-auto max-w-5xl space-y-8 p-8">
					<Outlet />
				</div>
			</main>
		</div>
	);
}

export const Route = createRootRoute({
	component: RootLayout,
});
