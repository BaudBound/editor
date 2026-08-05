"use client";

import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ActiveReorderDragState } from "@/hooks/use-reorder-controller";
import { cn } from "@/lib/utils";

export function ReorderDragOverlay({
	children,
	className,
	drag,
	style,
}: {
	children: ReactNode;
	className?: string;
	drag: ActiveReorderDragState;
	style?: CSSProperties;
}) {
	if (typeof document === "undefined") return null;

	return createPortal(
		<div
			data-reorder-drag-overlay
			className={cn(
				"pointer-events-none fixed z-9999 rounded border border-baud-red bg-baud-panel opacity-95 shadow-[0_18px_42px_rgba(0,0,0,0.38)]",
				className,
			)}
			style={{
				left: drag.pointerX - drag.pointerOffsetX,
				minHeight: drag.cardHeight,
				top: drag.pointerY - drag.pointerOffsetY,
				width: drag.cardWidth,
				...style,
			}}
		>
			{children}
		</div>,
		document.body,
	);
}
