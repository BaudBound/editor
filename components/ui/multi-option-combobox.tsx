"use client";

import { ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ComboboxOption } from "./option-combobox";

type MultiOptionComboboxProps = {
	ariaLabel: string;
	className?: string;
	options: ComboboxOption[];
	placeholder?: string;
	values: string[];
	onChange: (values: string[]) => void;
};

export function MultiOptionCombobox({
	ariaLabel,
	className,
	options,
	placeholder = "Select...",
	values,
	onChange,
}: MultiOptionComboboxProps) {
	const selected = new Set(values);
	const toggle = (value: string) => {
		onChange(
			selected.has(value)
				? values.filter((candidate) => candidate !== value)
				: options
						.filter((option) => selected.has(option.value) || option.value === value)
						.map((option) => option.value),
		);
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={ariaLabel}
					className={cn(
						"flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-baud-border bg-baud-soft px-2 py-1 text-left font-mono text-sm text-baud-text outline-none transition-[border-color,box-shadow] hover:border-baud-line focus-visible:border-baud-red/75 focus-visible:shadow-[0_0_0_2px_rgb(230_45_62_/_0.14)]",
						className,
					)}
				>
					<span className="flex min-w-0 flex-1 flex-wrap gap-1">
						{values.length === 0 ? (
							<span className="px-1 text-baud-muted">{placeholder}</span>
						) : (
							values.map((value) => (
								<Badge key={value} variant="outline" className="border-baud-line bg-baud-panel text-baud-text">
									{options.find((option) => option.value === value)?.label ?? value}
								</Badge>
							))
						)}
					</span>
					<ChevronDownIcon className="size-4 shrink-0 text-baud-muted" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
				{options.map((option) => (
					<div
						key={option.value}
						aria-selected={selected.has(option.value)}
						className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-baud-text outline-none hover:bg-baud-soft focus-visible:bg-baud-soft"
						onClick={() => toggle(option.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								toggle(option.value);
							}
						}}
						role="option"
						tabIndex={0}
					>
						<Checkbox checked={selected.has(option.value)} className="pointer-events-none" tabIndex={-1} />
						<span>{option.label}</span>
					</div>
				))}
			</PopoverContent>
		</Popover>
	);
}
