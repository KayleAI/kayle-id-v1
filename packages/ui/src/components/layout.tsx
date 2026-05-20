import { cn } from "@kayle-id/ui/lib/utils";
import type { ReactNode } from "react";

export function Layout({
  children,
  notCenter = false,
  className,
}: {
  children: ReactNode;
  notCenter?: boolean;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-accent p-2">
      <div
        className={cn(
          "relative flex grow overflow-hidden p-6 lg:rounded-lg lg:bg-background lg:p-10 lg:shadow-xs lg:ring-1 lg:ring-foreground/5",
          notCenter ? null : "items-center justify-center",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
