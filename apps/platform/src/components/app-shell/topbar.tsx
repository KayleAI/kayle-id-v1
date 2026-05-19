import { SidebarTrigger } from "@kayleai/ui/sidebar";
import { AppCommandBar } from "./command-bar";

export function AppTopbar() {
	return (
		<header className="flex h-14 min-w-0 shrink-0 items-center gap-3 bg-sidebar px-6">
			<SidebarTrigger className="-ml-1.5 md:hidden" />
			<AppCommandBar />
		</header>
	);
}
