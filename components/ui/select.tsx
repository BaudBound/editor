"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return <SelectPrimitive.Group data-slot="select-group" className={cn("scroll-my-1 p-1", className)} {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
	size?: "sm" | "default";
}) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			data-size={size}
			className={cn(
				"flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-0 pr-2 pl-2.5 text-sm leading-none whitespace-nowrap transition-[border-color,background-color,box-shadow] outline-none select-none focus-visible:border-baud-red/75 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_rgb(230_45_62_/_0.14)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/80 aria-invalid:ring-0 aria-invalid:shadow-[0_0_0_2px_rgb(224_92_92_/_0.14)] data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:h-full *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/70 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	position = "popper",
	align = "start",
	side = "bottom",
	sideOffset = 6,
	avoidCollisions = false,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot="select-content"
				data-align-trigger={position === "item-aligned"}
				className={cn(
					"relative z-50 max-h-72 overflow-x-hidden overflow-y-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
					position === "popper"
						? "w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width) max-w-(--radix-select-trigger-width)"
						: "min-w-36",
					className,
				)}
				position={position}
				align={align}
				side={side}
				sideOffset={sideOffset}
				avoidCollisions={avoidCollisions}
				{...props}
			>
				<SelectPrimitive.Viewport
					data-position={position}
					className={cn(
						"max-h-64 min-w-0 max-w-full overflow-x-hidden overflow-y-auto p-1",
						position === "popper" && "w-full",
					)}
				>
					{children}
				</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			data-slot="select-label"
			className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex min-h-8 min-w-0 w-full cursor-default items-center gap-1.5 overflow-hidden rounded-md py-0 pr-8 pl-1.5 text-sm leading-none outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:min-h-8 *:[span]:last:min-w-0 *:[span]:last:items-center *:[span]:last:gap-2 *:[span]:last:overflow-hidden *:[span]:last:text-ellipsis *:[span]:last:whitespace-nowrap",
				className,
			)}
			{...props}
		>
			<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<CheckIcon className="pointer-events-none" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
	return (
		<SelectPrimitive.Separator
			data-slot="select-separator"
			className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue };
