import { SidebarInset, SidebarProvider } from "@kayleai/ui/sidebar";
import { AppCommandProvider } from "./command-bar";
import { AppSidebar } from "./sidebar";
import { AppTopbar } from "./topbar";

export function AppLayout({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<AppCommandProvider>
				<SidebarInset className="min-w-0">
					<div className="flex max-h-dvh min-w-0 flex-1 flex-col overflow-hidden">
						<AppTopbar />
						<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
							<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background md:rounded-lg">
								<div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-scroll p-6 lg:p-10">
									<div className="flex min-w-0 flex-1 flex-col relative">
										{children}
									</div>
								</div>
							</div>
						</div>
					</div>
				</SidebarInset>
			</AppCommandProvider>
		</SidebarProvider>
	);
}
