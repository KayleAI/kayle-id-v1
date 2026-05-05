import { SidebarTrigger } from "@kayleai/ui/sidebar";
import { AppCommandBar } from "./command-bar";

export function AppTopbar() {
	return (
		<header className="flex h-14 shrink-0 items-center gap-3 bg-sidebar px-6 lg:px-4 -mb-2">
			<SidebarTrigger className="-ml-1.5 lg:hidden" />
			<AppCommandBar />
		</header>
	);
}
