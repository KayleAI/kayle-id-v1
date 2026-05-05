import { SidebarInset, SidebarProvider } from "@kayleai/ui/sidebar";
import { AppCommandProvider } from "./command-bar";
import { AppSidebar } from "./sidebar";
import { AppTopbar } from "./topbar";

export function AppLayout({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<AppCommandProvider>
				<SidebarInset>
					<div className="flex max-h-dvh flex-1 flex-col overflow-hidden">
						<AppTopbar />
						<div className="flex min-h-0 flex-1 flex-col lg:bg-sidebar lg:p-2">
							<div className="flex min-h-0 flex-1 flex-col bg-background lg:overflow-clip lg:rounded-lg lg:border">
								<div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-6 lg:p-10">
									<div className="flex flex-1 flex-col">{children}</div>
								</div>
							</div>
						</div>
					</div>
				</SidebarInset>
			</AppCommandProvider>
		</SidebarProvider>
	);
}
