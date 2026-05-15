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
						<div className="flex min-h-0 flex-1 flex-col bg-sidebar">
							<div className="flex min-h-0 flex-1 flex-col bg-background md:rounded-lg">
								<div className="flex min-h-0 w-full flex-1 flex-col overflow-y-scroll p-6 lg:p-10">
									<div className="flex flex-1 flex-col relative">
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
