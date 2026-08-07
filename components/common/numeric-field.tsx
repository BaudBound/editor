"use client";

import { Minus, Plus } from "lucide-react";
import {
	type FocusEventHandler,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { NumericConfigContract } from "@/data/nodes/node-definition";
import { cn } from "@/lib/utils";
import {
	getNumericDraftError,
	type NumericStepDirection,
	numericAriaValue,
	stepNumericDraft,
} from "./numeric-field-model";
import { VariableCodeInput, type VariableCompletion } from "./variable-code-input";

export type NumericFieldProps = {
	allowVariables?: boolean;
	ariaDescribedBy?: string;
	ariaLabel?: string;
	className?: string;
	compact?: boolean;
	contract: NumericConfigContract;
	controlClassName?: string;
	disabled?: boolean;
	id?: string;
	onBlur?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
	onChange: (value: string) => void;
	onFocus?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
	placeholder?: string;
	readOnly?: boolean;
	required?: boolean;
	showError?: boolean;
	step?: string;
	validationError?: string;
	value: number | string;
	variables?: VariableCompletion[];
};

export function NumericField({
	allowVariables = false,
	ariaDescribedBy,
	ariaLabel = "Numeric value",
	className,
	compact = false,
	contract,
	controlClassName,
	disabled = false,
	id,
	onBlur,
	onChange,
	onFocus,
	placeholder,
	readOnly = false,
	required = true,
	showError = true,
	step,
	validationError,
	value,
	variables = [],
}: NumericFieldProps) {
	const generatedId = useId();
	const inputId = id ?? `${generatedId}-input`;
	const errorId = `${inputId}-error`;
	const externalValue = valueToDraft(value);
	const [draft, setDraft] = useState(externalValue);
	const draftRef = useRef(draft);

	useEffect(() => {
		draftRef.current = externalValue;
		setDraft(externalValue);
	}, [externalValue]);

	const error = getNumericDraftError(draft, contract, allowVariables, required) || validationError || "";
	const describedBy = [ariaDescribedBy, error && showError ? errorId : ""].filter(Boolean).join(" ") || undefined;
	const currentAriaValue = numericAriaValue(draft);
	const minimum = finiteNumber(contract.minimum);
	const maximum = finiteNumber(contract.maximum);
	const canDecrease = canStep(draft, contract, -1, step);
	const canIncrease = canStep(draft, contract, 1, step);

	const updateDraft = (next: string) => {
		draftRef.current = next;
		setDraft(next);
		onChange(next);
	};

	const applyStep = (direction: NumericStepDirection, multiplier = 1) => {
		const next = stepNumericDraft(draftRef.current, contract, direction, step, multiplier);
		if (next !== null) {
			updateDraft(next);
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			updateDraft(externalValue);
			event.currentTarget.blur();
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			return;
		}
		event.preventDefault();
		applyStep(event.key === "ArrowUp" ? 1 : -1, event.shiftKey ? 10 : 1);
	};

	const decreasePress = useRepeatingPress(() => applyStep(-1));
	const increasePress = useRepeatingPress(() => applyStep(1));
	const inputClassName = cn(
		"h-8 min-w-0 border-0 bg-transparent px-2.5 text-left font-mono text-sm tabular-nums text-baud-text outline-none placeholder:text-baud-muted disabled:cursor-not-allowed disabled:opacity-50",
		controlClassName && "h-full",
		compact && "px-2 text-xs",
	);

	return (
		<div className={cn("grid gap-1", className)}>
			<div
				className={cn(
					"grid h-8 min-w-0 overflow-hidden rounded-lg border bg-baud-panel/70 transition-[border-color,box-shadow]",
					compact ? "grid-cols-[minmax(2.5rem,1fr)_1.375rem_1.375rem]" : "grid-cols-[minmax(0,1fr)_1.5rem_1.5rem]",
					error
						? "border-baud-danger shadow-[0_0_0_2px_rgb(224_92_92/0.14)]"
						: "border-baud-border focus-within:border-baud-red/75 focus-within:shadow-[0_0_0_2px_rgb(230_45_62/0.14)]",
					disabled && "opacity-60",
					controlClassName,
				)}
			>
				{allowVariables ? (
					<VariableCodeInput
						id={inputId}
						ariaLabel={ariaLabel}
						ariaDescribedBy={describedBy}
						className="rounded-none border-0 bg-transparent shadow-none focus-within:border-0 focus-within:shadow-none"
						contentClassName={cn("text-left tabular-nums", compact && "px-2 text-xs")}
						containerClassName="min-w-0"
						disabled={disabled}
						hasError={!!error}
						inputMode={contract.kind === "integer" ? "numeric" : "decimal"}
						onBlur={onBlur}
						onChange={updateDraft}
						onFocus={onFocus}
						onKeyDown={handleKeyDown}
						placeholder={placeholder}
						readOnly={readOnly}
						value={draft}
						variableTypes={contract.kind === "integer" ? "integer" : "float"}
						variables={variables}
					/>
				) : (
					<input
						id={inputId}
						aria-label={ariaLabel}
						aria-describedby={describedBy}
						aria-invalid={!!error || undefined}
						aria-valuemax={maximum}
						aria-valuemin={minimum}
						aria-valuenow={currentAriaValue}
						aria-valuetext={draft || undefined}
						className={inputClassName}
						disabled={disabled}
						inputMode={contract.kind === "integer" ? "numeric" : "decimal"}
						onBlur={onBlur}
						onChange={(event) => updateDraft(event.target.value)}
						onFocus={onFocus}
						onKeyDown={handleKeyDown}
						placeholder={placeholder}
						readOnly={readOnly}
						role="spinbutton"
						type="text"
						value={draft}
					/>
				)}
				<StepButton
					ariaLabel={`Decrease ${ariaLabel}`}
					disabled={disabled || readOnly || !canDecrease}
					pressHandlers={decreasePress}
				>
					<Minus />
				</StepButton>
				<StepButton
					ariaLabel={`Increase ${ariaLabel}`}
					disabled={disabled || readOnly || !canIncrease}
					pressHandlers={increasePress}
				>
					<Plus />
				</StepButton>
			</div>
			{error && showError && (
				<p id={errorId} className="text-xs leading-4 text-baud-danger">
					{error}
				</p>
			)}
		</div>
	);
}

function StepButton({
	ariaLabel,
	children,
	disabled,
	pressHandlers,
}: {
	ariaLabel: string;
	children: ReactNode;
	disabled: boolean;
	pressHandlers: ReturnType<typeof useRepeatingPress>;
}) {
	return (
		<button
			type="button"
			aria-label={ariaLabel}
			title={ariaLabel}
			className="grid h-full place-items-center border-l border-baud-border bg-baud-soft text-baud-muted outline-none transition-colors hover:bg-baud-line hover:text-baud-text focus-visible:bg-baud-line focus-visible:text-baud-text disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-3"
			disabled={disabled}
			{...pressHandlers}
		>
			{children}
		</button>
	);
}

function useRepeatingPress(action: () => void) {
	const actionRef = useRef(action);
	const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	actionRef.current = action;

	const stop = () => {
		if (delayRef.current) {
			clearTimeout(delayRef.current);
			delayRef.current = null;
		}
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	};

	useEffect(() => stop, []);

	return {
		onClick: (event: MouseEvent<HTMLButtonElement>) => {
			if (event.detail === 0) {
				actionRef.current();
			}
		},
		onPointerCancel: stop,
		onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			actionRef.current();
			delayRef.current = setTimeout(() => {
				intervalRef.current = setInterval(() => actionRef.current(), 75);
			}, 400);
		},
		onPointerLeave: stop,
		onPointerUp: stop,
	};
}

function canStep(value: string, contract: NumericConfigContract, direction: NumericStepDirection, step?: string) {
	return stepNumericDraft(value, contract, direction, step) !== null;
}

function valueToDraft(value: number | string) {
	return typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
}

function finiteNumber(value: string) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
