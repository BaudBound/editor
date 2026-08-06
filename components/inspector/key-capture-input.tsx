import type { KeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { FieldError } from "@/components/common/field-error";
import type { VariableCompletion } from "@/components/common/variable-code-input";
import { Input } from "@/components/ui/input";
import { OptionCombobox } from "@/components/ui/option-combobox";
import { filterCompatibleVariables, validateVariableReferenceTypes } from "@/data/nodes/config-field-validation";
import { canonicalWindowsKey, validateWindowsKeyTemplate } from "@/data/nodes/windows-key-contract";
import { KeyReferencePanel } from "./key-reference-panel";

type KeyCaptureInputProps = {
	allowVariables?: boolean;
	ariaLabel?: string;
	id?: string;
	label?: string;
	showReference?: boolean;
	value: string;
	variables?: VariableCompletion[];
	onChange: (value: string) => void;
};

export function KeyCaptureInput({
	allowVariables = false,
	ariaLabel,
	id,
	label,
	showReference = false,
	value,
	variables = [],
	onChange,
}: KeyCaptureInputProps) {
	const generatedId = useId();
	const inputId = id ?? generatedId;
	const errorId = `${inputId}-error`;
	const initialSource = isFullVariableReference(value) ? "variable" : "literal";
	const [source, setSource] = useState<"literal" | "variable">(initialSource);
	const compatibleVariables = filterCompatibleVariables(variables, "keyboard_key");
	const selectedVariableName = variableNameFromToken(value);
	const selectedVariable = compatibleVariables.find((variable) => variable.name === selectedVariableName);
	const selectedVariableTypeError = validateVariableReferenceTypes(value, variables, "keyboard_key");
	const error =
		allowVariables && source === "variable"
			? selectedVariableTypeError
				? selectedVariableTypeError
				: selectedVariable
					? ""
					: compatibleVariables.length === 0
						? "No hotkey variables are available."
						: "Select a hotkey variable."
			: !value.trim()
				? "Key is required."
				: validateWindowsKeyTemplate(value);
	const pressedKeys = useRef<string[]>([]);

	useEffect(() => {
		if (isFullVariableReference(value)) {
			setSource("variable");
		} else if (value.trim()) {
			setSource("literal");
		}
	}, [value]);

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if ((event.key === "Backspace" || event.key === "Delete") && pressedKeys.current.length === 0 && value.length > 0) {
			return;
		}

		const keyName = canonicalWindowsKey(event.key, event.code);
		if (!keyName) return;
		event.preventDefault();
		if (event.repeat || pressedKeys.current.includes(keyName)) return;

		pressedKeys.current = [...pressedKeys.current, keyName];
		onChange(formatCapturedKeys(pressedKeys.current));
	};
	const handleKeyUp = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		const keyName = canonicalWindowsKey(event.key, event.code);
		if (!keyName) return;
		pressedKeys.current = pressedKeys.current.filter((pressedKey) => pressedKey !== keyName);
	};
	const sharedProps = {
		id: inputId,
		onBlur: () => {
			pressedKeys.current = [];
		},
		onKeyDown: handleKeyDown,
		onKeyUp: handleKeyUp,
		placeholder: "Press a key combination",
	};

	return (
		<div>
			{label && (
				<label htmlFor={inputId} className="mb-1 block font-mono text-sm text-baud-muted">
					{label}
				</label>
			)}
			{allowVariables && (
				<div className="mb-2">
					<span className="mb-1 block font-mono text-sm text-baud-muted">Key source</span>
					<OptionCombobox
						ariaLabel="Key source"
						options={[
							{ label: "Literal key", value: "literal" },
							{ label: "Variable", value: "variable" },
						]}
						value={source}
						onChange={(nextSource) => {
							setSource(nextSource === "variable" ? "variable" : "literal");
							onChange("");
						}}
					/>
				</div>
			)}
			{source === "variable" && allowVariables ? (
				<OptionCombobox
					ariaDescribedBy={error ? errorId : undefined}
					ariaLabel={ariaLabel ?? label ?? "Hotkey variable"}
					hasError={!!error}
					emptyMessage="No hotkey variables."
					options={compatibleVariables.map((variable) => ({ label: variable.name, value: variable.name }))}
					placeholder="Select a hotkey variable"
					value={selectedVariable?.name ?? ""}
					onChange={(name) => {
						const variable = compatibleVariables.find((candidate) => candidate.name === name);
						onChange(variable?.token ?? "");
					}}
				/>
			) : (
				<Input
					{...sharedProps}
					aria-label={ariaLabel ?? label}
					aria-describedby={error ? errorId : undefined}
					aria-invalid={!!error || undefined}
					value={value}
					onChange={(event) => onChange(normalizeManualKeyInput(event.target.value))}
				/>
			)}
			<FieldError id={errorId} message={error} />
			{showReference && source === "literal" && (
				<div className="mt-3">
					<KeyReferencePanel value={value} onChange={onChange} />
				</div>
			)}
		</div>
	);
}

function isFullVariableReference(value: string) {
	return /^\{\{\s*[^{}]+\s*}}$/.test(value.trim());
}

function variableNameFromToken(value: string) {
	return (
		value
			.trim()
			.match(/^\{\{\s*([^{}]+?)\s*}}$/)?.[1]
			?.trim() ?? ""
	);
}

function formatCapturedKeys(keys: string[]) {
	const modifiers = ["Ctrl", "Alt", "Shift", "Windows"];
	return [
		...modifiers.filter((modifier) => keys.includes(modifier)),
		...keys.filter((key) => !modifiers.includes(key)),
	].join("+");
}

function normalizeManualKeyInput(value: string) {
	return value.length === 1 ? value.toUpperCase() : value;
}
