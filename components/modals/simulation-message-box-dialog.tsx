"use client";

import { AlertTriangle, Info, OctagonX } from "lucide-react";
import type { ComponentType } from "react";
import { useId } from "react";
import { simulationDialogSizeClasses } from "@/components/modals/simulation-dialog-size";
import {
	SimulationDialogTimeoutCountdown,
	useSimulationDialogTimeout,
} from "@/components/modals/simulation-dialog-timeout";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { SimulationSideEffect } from "@/utils/simulation";

type MessageBoxSideEffect = Extract<SimulationSideEffect, { type: "message_box" }>;

type SimulationMessageBoxDialogProps = {
	messageBox: MessageBoxSideEffect | null;
	onSelect: (button: string) => void;
};

const variantIcon: Record<MessageBoxSideEffect["variant"], ComponentType<{ className?: string }>> = {
	error: OctagonX,
	info: Info,
	warning: AlertTriangle,
};

const variantClassName: Record<MessageBoxSideEffect["variant"], string> = {
	error: "text-baud-danger",
	info: "text-baud-blue",
	warning: "text-baud-amber",
};

export function SimulationMessageBoxDialog({ messageBox, onSelect }: SimulationMessageBoxDialogProps) {
	const titleId = useId();
	const Icon = messageBox ? variantIcon[messageBox.variant] : Info;
	const timeoutDeadline = useSimulationDialogTimeout(messageBox?.timeoutSeconds, messageBox?.nodeId ?? null, () =>
		onSelect("timeout"),
	);

	return (
		<Dialog open={!!messageBox} onOpenChange={() => undefined}>
			<DialogContent
				aria-labelledby={titleId}
				className={`${messageBox ? simulationDialogSizeClasses[messageBox.dialogSize] : simulationDialogSizeClasses.medium} grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-lg bg-baud-bg p-0 ring-baud-border`}
				showCloseButton={false}
				onEscapeKeyDown={(event) => event.preventDefault()}
				onInteractOutside={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
			>
				{messageBox && (
					<>
						<div className="min-h-0 overflow-y-auto px-5 py-5">
							<DialogHeader className="min-w-0 gap-0 text-left">
								<div className="flex min-w-0 items-center gap-3">
									<Icon className={`size-8 shrink-0 ${variantClassName[messageBox.variant]}`} />
									<DialogTitle id={titleId} className="min-w-0 break-words text-base text-baud-text">
										{messageBox.title || "Message"}
									</DialogTitle>
								</div>
								<DialogDescription className="mt-4 whitespace-pre-wrap break-words text-sm leading-5 text-baud-muted">
									{messageBox.message}
								</DialogDescription>
							</DialogHeader>
						</div>
						<DialogFooter className="min-w-0 flex-wrap items-center justify-between gap-3 border-t border-baud-border bg-baud-panel px-5 py-3 sm:justify-between">
							<SimulationDialogTimeoutCountdown deadline={timeoutDeadline} />
							<div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
								{messageBox.buttons.map((button) => (
									<Button
										key={button}
										type="button"
										onClick={() => onSelect(button)}
										variant={button === "cancel" || button === "no" ? "outline" : "toolbar"}
									>
										{formatButtonLabel(button)}
									</Button>
								))}
							</div>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function formatButtonLabel(button: string) {
	return button
		.split("_")
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
