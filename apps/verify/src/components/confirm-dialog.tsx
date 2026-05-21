import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kayle-id/ui/components/alert-dialog";
import type { ReactNode } from "react";

type ConfirmDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description: ReactNode;
	confirmLabel: ReactNode;
	dismissLabel: ReactNode;
	onConfirm: () => void;
	inFlight?: boolean;
	confirmVariant?: "destructive";
	testId?: string;
};

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	dismissLabel,
	onConfirm,
	inFlight = false,
	confirmVariant = "destructive",
	testId,
}: ConfirmDialogProps) {
	return (
		<AlertDialog
			onOpenChange={(next) => {
				if (inFlight) {
					return;
				}
				onOpenChange(next);
			}}
			open={open}
		>
			<AlertDialogContent data-testid={testId}>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={inFlight}>
						{dismissLabel}
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={inFlight}
						onClick={onConfirm}
						variant={confirmVariant}
					>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
