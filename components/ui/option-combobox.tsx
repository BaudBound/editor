"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
	/** Optional second line, for telling similarly named options apart. */
	description?: string;
	label: string;
	value: string;
};

type OptionComboboxProps = {
	ariaDescribedBy?: string;
	ariaLabel?: string;
	className?: string;
	disabled?: boolean;
	emptyMessage?: string;
	hasError?: boolean;
	options: ComboboxOption[];
	placeholder?: string;
	value: string;
	onChange: (value: string) => void;
};

export function OptionCombobox({
	ariaDescribedBy,
	ariaLabel,
	className,
	disabled = false,
	emptyMessage = "No options.",
	hasError = false,
	options,
	placeholder = "Select...",
	value,
	onChange,
}: OptionComboboxProps) {
	const listboxId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const selectedOption = options.find((option) => option.value === value) ?? null;
	const [open, setOpen] = useState(false);
	const [highlightedIndex, setHighlightedIndex] = useState(() => getSelectedIndex(options, value));

	useEffect(() => {
		if (!open) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
				return;
			}

			setOpen(false);
		};
		document.addEventListener("pointerdown", handlePointerDown);

		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [open]);

	useEffect(() => {
		if (open) {
			setHighlightedIndex(Math.max(0, getSelectedIndex(options, value)));
		}
	}, [open, options, value]);

	const selectOption = (option: ComboboxOption) => {
		onChange(option.value);
		setOpen(false);
		triggerRef.current?.focus();
	};
	const handleEscapeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
		if (!open || event.key !== "Escape") return false;
		event.preventDefault();
		event.stopPropagation();
		setOpen(false);
		triggerRef.current?.focus();
		return true;
	};

	const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (handleEscapeKeyDown(event)) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
			setHighlightedIndex((currentIndex) => {
				const nextIndex = event.key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
				return clampIndex(nextIndex, 0, Math.max(0, options.length - 1));
			});
			return;
		}

		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			if (!open) {
				setOpen(true);
				return;
			}

			const option = options[highlightedIndex];
			if (option) {
				selectOption(option);
			}
		}
	};

	return (
		<div ref={rootRef} className="relative" data-option-combobox-open={open || undefined}>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-label={ariaLabel}
				aria-describedby={ariaDescribedBy}
				aria-invalid={hasError || undefined}
				aria-controls={open ? listboxId : undefined}
				onClick={() => {
					if (!disabled) setOpen((currentOpen) => !currentOpen);
				}}
				onKeyDown={handleTriggerKeyDown}
				className={cn(
					"flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-baud-border bg-baud-soft px-3 py-0 font-mono text-sm leading-none text-baud-text shadow-none outline-none transition-[border-color,box-shadow] hover:border-baud-line focus-visible:border-baud-red/75 focus-visible:shadow-[0_0_0_2px_rgb(230_45_62_/_0.14)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-baud-border",
					hasError && "border-baud-danger shadow-[0_0_0_2px_rgb(224_92_92/0.14)]",
					open && "border-baud-red/75",
					className,
				)}
			>
				<span className={cn("flex h-full min-w-0 items-center truncate", !selectedOption && "text-baud-muted")}>
					{selectedOption?.label ?? placeholder}
				</span>
				<ChevronDownIcon className={cn("size-4 shrink-0 text-baud-muted transition-transform", open && "rotate-180")} />
			</button>

			{open && (
				<div
					id={listboxId}
					role="listbox"
					onKeyDown={handleEscapeKeyDown}
					className="absolute top-[calc(100%+6px)] left-0 z-[70] max-h-72 w-full min-w-full overflow-y-auto rounded-lg border border-baud-border bg-baud-panel p-1 text-baud-text shadow-md"
				>
					{options.length === 0 ? (
						<div className="px-2 py-2 text-sm text-baud-muted">{emptyMessage}</div>
					) : (
						options.map((option, index) => {
							const selected = option.value === value;
							const highlighted = index === highlightedIndex;

							return (
								<button
									key={option.value}
									type="button"
									role="option"
									aria-selected={selected}
									onClick={() => selectOption(option)}
									onMouseEnter={() => setHighlightedIndex(index)}
									className={cn(
										"relative flex min-h-8 w-full cursor-pointer items-center rounded-md py-0 pr-8 pl-2 text-left text-sm leading-none outline-none select-none",
										highlighted && "bg-baud-soft text-baud-text",
										selected ? "text-baud-text" : "text-baud-muted",
										option.description && "flex-col items-start justify-center gap-0.5 py-1.5",
									)}
								>
									<span className="flex min-w-0 max-w-full items-center truncate">{option.label}</span>
									{option.description && (
										<span className="min-w-0 max-w-full truncate text-xs text-baud-muted">{option.description}</span>
									)}
									{selected && (
										<span className="absolute right-2 flex size-4 items-center justify-center text-baud-red">
											<CheckIcon className="size-4" />
										</span>
									)}
								</button>
							);
						})
					)}
				</div>
			)}
		</div>
	);
}

function getSelectedIndex(options: ComboboxOption[], value: string) {
	const index = options.findIndex((option) => option.value === value);
	return index < 0 ? 0 : index;
}

function clampIndex(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}
