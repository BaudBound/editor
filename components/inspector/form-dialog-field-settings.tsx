"use client";

import { GripVertical, Plus, X } from "lucide-react";
import Image from "next/image";
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useState } from "react";
import { FieldError } from "@/components/common/field-error";
import { NumericField } from "@/components/common/numeric-field";
import { ReorderDragOverlay } from "@/components/common/reorder-drag-overlay";
import { VariableCodeInput, type VariableCompletion } from "@/components/common/variable-code-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionCombobox } from "@/components/ui/option-combobox";
import { Switch } from "@/components/ui/switch";
import {
	createFormDialogChoice,
	FORM_DIALOG_MAX_CHOICE_CHARS,
	FORM_DIALOG_MAX_CHOICES,
	FORM_DIALOG_MAX_IMAGE_BYTES,
	FORM_DIALOG_MAX_KEY_CHARS,
	type FormDialogChoiceRow,
	type FormDialogFieldRow,
	isPresentationFieldType,
	usesAccentColor,
	usesChoices,
	usesDefaultValue,
	usesPlaceholder,
	validateFormDialogChoiceDisplayValue,
	validateFormDialogChoiceKey,
	validateFormDialogFieldKey,
} from "@/data/nodes/form-dialog-fields";
import { runtimeNumberContract } from "@/data/nodes/numeric-validation";
import { createTimeZoneOptions, initialTimeZoneOptions } from "@/data/project/datetime";
import { type ActiveReorderDragState, useReorderController } from "@/hooks/use-reorder-controller";
import type { EditorAsset } from "@/lib/types";
import { ColorConfigInput } from "./color-config-input";
import {
	validateFormDialogColorValue,
	validateFormDialogNumericValue,
	validateFormDialogTemporalValue,
	validateFormDialogTextVariables,
} from "./form-dialog-validation";

export function FormDialogFieldSettings({
	field,
	fields,
	index,
	onChange,
	variables,
	assets,
}: {
	assets: EditorAsset[];
	field: FormDialogFieldRow;
	fields: FormDialogFieldRow[];
	index: number;
	onChange: (patch: Partial<FormDialogFieldRow>) => void;
	variables: VariableCompletion[];
}) {
	const accentColorErrorId = useId();
	const defaultColorErrorId = useId();
	const keyError = validateFormDialogFieldKey(fields, field.id);
	const accentColorError = validateFormDialogColorValue(field.accentColor, variables);
	const labelError =
		(!isPresentationFieldType(field.type) && !field.label.trim() ? "Label is required." : "") ||
		validateFormDialogTextVariables(field.label, variables);
	const imageAssets = assets.filter((asset) => asset.kind === "image");
	const selectedImageAsset = imageAssets.find((asset) => asset.packagePath === field.assetPath);
	const imageAssetError =
		field.type !== "image"
			? ""
			: !selectedImageAsset
				? "Select an image asset from this project."
				: selectedImageAsset.size > FORM_DIALOG_MAX_IMAGE_BYTES
					? "Image asset must be 8 MiB or smaller."
					: "";

	return (
		<div className="space-y-4 pb-2">
			{!isPresentationFieldType(field.type) && (
				<FormDialogKeyField
					error={keyError}
					label="Output key"
					maxLength={FORM_DIALOG_MAX_KEY_CHARS}
					value={field.key}
					onChange={(key) => onChange({ key })}
				/>
			)}
			{field.type !== "divider" && (
				<VariableTextField
					error={labelError}
					label={
						field.type === "information" || field.type === "section_heading"
							? "Heading"
							: field.type === "image"
								? "Alternative text"
								: "Label"
					}
					value={field.label}
					variables={variables}
					onChange={(label) => onChange({ label })}
				/>
			)}

			{usesAccentColor(field.type) && (
				<LabeledControl label="Accent color">
					<ColorConfigInput
						error={accentColorError}
						errorId={accentColorErrorId}
						label="Accent color"
						value={field.accentColor}
						variables={variables}
						onChange={(accentColor) => onChange({ accentColor })}
					/>
					<FieldError id={accentColorErrorId} message={accentColorError} />
				</LabeledControl>
			)}
			{field.type !== "divider" && (
				<VariableTextField
					error={validateFormDialogTextVariables(field.description, variables)}
					label={field.type === "information" ? "Content" : field.type === "image" ? "Caption" : "Description"}
					multiline
					value={field.description}
					variables={variables}
					onChange={(description) => onChange({ description })}
				/>
			)}

			{field.type === "image" && (
				<>
					<LabeledControl label="Image asset">
						<OptionCombobox
							ariaLabel={`Component ${index} image asset`}
							hasError={!!imageAssetError}
							options={imageAssets.map((asset) => ({ label: asset.name, value: asset.packagePath }))}
							placeholder="Select image"
							value={field.assetPath}
							onChange={(assetPath) => onChange({ assetPath })}
						/>
						<FieldError id={`${accentColorErrorId}-image`} message={imageAssetError} />
						{selectedImageAsset && !imageAssetError && (
							<ImageAssetPreview asset={selectedImageAsset} fit={field.imageFit} />
						)}
					</LabeledControl>
					<LabeledControl label="Image fit">
						<OptionCombobox
							ariaLabel={`Component ${index} image fit`}
							options={[
								{ label: "Contain", value: "contain" },
								{ label: "Cover", value: "cover" },
							]}
							value={field.imageFit}
							onChange={(imageFit) =>
								imageFit === "contain" || imageFit === "cover" ? onChange({ imageFit }) : undefined
							}
						/>
					</LabeledControl>
					<LabeledControl label="Height (pixels)">
						<NumericField
							allowVariables
							ariaLabel={`Component ${index} image height`}
							contract={{
								kind: "integer",
								signed: false,
								minimum: "80",
								maximum: "600",
								minimumInclusive: true,
								maximumInclusive: true,
							}}
							value={field.imageHeight}
							variables={variables}
							onChange={(imageHeight) => onChange({ imageHeight })}
						/>
					</LabeledControl>
				</>
			)}

			{usesPlaceholder(field.type) && (
				<VariableTextField
					error={validateFormDialogTextVariables(field.placeholder, variables)}
					label="Placeholder"
					value={field.placeholder}
					variables={variables}
					onChange={(placeholder) => onChange({ placeholder })}
				/>
			)}

			{usesDefaultValue(field.type) &&
				!["number", "slider", "color", "date", "time", "datetime"].includes(field.type) && (
					<VariableTextField
						error={validateFormDialogTextVariables(field.defaultValue, variables)}
						label="Default value"
						multiline={field.type === "multiline"}
						value={field.defaultValue}
						variables={variables}
						onChange={(defaultValue) => onChange({ defaultValue })}
					/>
				)}

			{(field.type === "date" || field.type === "time" || field.type === "datetime") && (
				<TemporalDefaultField
					field={field}
					index={index}
					temporalType={field.type}
					variables={variables}
					onChange={(defaultValue) => onChange({ defaultValue })}
				/>
			)}

			{field.type === "number" && (
				<LabeledControl label="Default value">
					<NumericField
						allowVariables
						ariaLabel={`Component ${index} default value`}
						contract={runtimeNumberContract}
						required={false}
						validationError={validateFormDialogNumericValue(field.defaultValue, variables)}
						value={field.defaultValue}
						variables={variables}
						onChange={(defaultValue) => onChange({ defaultValue })}
					/>
				</LabeledControl>
			)}

			{field.type === "color" && (
				<LabeledControl label="Default color">
					<ColorConfigInput
						error={validateFormDialogColorValue(field.defaultValue, variables)}
						errorId={defaultColorErrorId}
						label="Default color"
						value={field.defaultValue}
						variables={variables}
						onChange={(defaultValue) => onChange({ defaultValue })}
					/>
					<FieldError id={defaultColorErrorId} message={validateFormDialogColorValue(field.defaultValue, variables)} />
				</LabeledControl>
			)}

			{field.type === "datetime" && (
				<TimeZoneField value={field.timezone} onChange={(timezone) => onChange({ timezone })} />
			)}

			{field.type === "slider" && (
				<SliderSettings field={field} index={index} variables={variables} onChange={onChange} />
			)}

			{usesChoices(field.type) && (
				<FormDialogChoicesEditor
					choices={field.choices}
					fieldIndex={index}
					variables={variables}
					onChange={(choices) => onChange({ choices })}
				/>
			)}

			{field.type === "checkbox" && (
				<ToggleRow
					checked={field.defaultChecked}
					label="Checked by default"
					onChange={(defaultChecked) => onChange({ defaultChecked })}
				/>
			)}
			{field.type === "file" && (
				<ToggleRow
					checked={field.multiple}
					label="Allow multiple files"
					onChange={(multiple) => onChange({ multiple })}
				/>
			)}
			{!isPresentationFieldType(field.type) && (
				<ToggleRow checked={field.required} label="Required" onChange={(required) => onChange({ required })} />
			)}
		</div>
	);
}

function ImageAssetPreview({ asset, fit }: { asset: EditorAsset; fit: "contain" | "cover" }) {
	const [source, setSource] = useState("");
	useEffect(() => {
		const url = URL.createObjectURL(asset.file);
		setSource(url);
		return () => URL.revokeObjectURL(url);
	}, [asset]);
	return source ? (
		<div className="relative mt-2 h-32 overflow-hidden rounded border border-baud-border bg-baud-panel">
			<Image alt="" aria-hidden fill sizes="640px" src={source} style={{ objectFit: fit }} unoptimized />
		</div>
	) : null;
}

function TimeZoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	const [options, setOptions] = useState(initialTimeZoneOptions);
	useEffect(() => setOptions(createTimeZoneOptions()), []);
	return (
		<LabeledControl label="Timezone">
			<OptionCombobox ariaLabel="Date and time timezone" options={options} value={value} onChange={onChange} />
		</LabeledControl>
	);
}

function TemporalDefaultField({
	field,
	index,
	onChange,
	temporalType,
	variables,
}: {
	field: FormDialogFieldRow;
	index: number;
	onChange: (value: string) => void;
	temporalType: "date" | "datetime" | "time";
	variables: VariableCompletion[];
}) {
	const inputId = useId();
	const errorId = `${inputId}-error`;
	const [mode, setMode] = useState<"picker" | "variable">(() =>
		field.defaultValue.includes("{{") ? "variable" : "picker",
	);
	useEffect(() => {
		setMode(field.defaultValue.includes("{{") ? "variable" : "picker");
	}, [field.id]);
	const validationError = validateFormDialogTemporalValue(temporalType, field.defaultValue, variables);
	const error =
		mode === "variable" && field.defaultValue && !/^\{\{\s*[^{}]+?\s*}}$/.test(field.defaultValue)
			? validationError || "Select one datetime variable."
			: validationError;
	const selectMode = (nextMode: "picker" | "variable") => {
		if (nextMode === mode) return;
		setMode(nextMode);
		onChange("");
	};

	return (
		<div className="grid gap-1.5">
			<div className="flex min-w-0 items-center justify-between gap-3">
				<label className="font-mono text-xs text-baud-muted" htmlFor={inputId}>
					Default value
				</label>
				<fieldset className="grid grid-cols-2 overflow-hidden rounded-md border border-baud-border">
					<legend className="sr-only">Component {index} default value mode</legend>
					{(["picker", "variable"] as const).map((option) => (
						<button
							aria-pressed={mode === option}
							className={`h-7 border-baud-border px-2.5 text-xs transition-colors first:border-r ${
								mode === option
									? "bg-baud-red text-white"
									: "bg-baud-panel text-baud-muted hover:bg-baud-soft hover:text-baud-text"
							}`}
							key={option}
							onClick={() => selectMode(option)}
							type="button"
						>
							{option === "picker" ? "Picker" : "Variable"}
						</button>
					))}
				</fieldset>
			</div>
			{mode === "picker" ? (
				<Input
					aria-describedby={error ? errorId : undefined}
					aria-invalid={!!error || undefined}
					aria-label="Default value"
					id={inputId}
					onChange={(event) => onChange(event.target.value)}
					step={temporalType === "date" ? undefined : "1"}
					type={temporalType === "datetime" ? "datetime-local" : temporalType}
					value={field.defaultValue}
				/>
			) : (
				<VariableCodeInput
					ariaDescribedBy={error ? errorId : undefined}
					ariaLabel="Default value"
					hasError={!!error}
					id={inputId}
					onChange={onChange}
					value={field.defaultValue}
					variableTypes="datetime"
					variables={variables}
				/>
			)}
			<FieldError id={errorId} message={error} />
		</div>
	);
}

function SliderSettings({
	field,
	index,
	onChange,
	variables,
}: {
	field: FormDialogFieldRow;
	index: number;
	onChange: (patch: Partial<FormDialogFieldRow>) => void;
	variables: VariableCompletion[];
}) {
	const rows: Array<[string, keyof Pick<FormDialogFieldRow, "minimum" | "maximum" | "step" | "defaultValue">]> = [
		["Minimum", "minimum"],
		["Maximum", "maximum"],
		["Step", "step"],
		["Default value", "defaultValue"],
	];
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{rows.map(([label, key]) => (
				<LabeledControl key={key} label={label}>
					<NumericField
						allowVariables
						ariaLabel={`Component ${index} slider ${label.toLowerCase()}`}
						contract={runtimeNumberContract}
						value={field[key]}
						variables={variables}
						onChange={(value) => onChange({ [key]: value })}
					/>
				</LabeledControl>
			))}
		</div>
	);
}

function FormDialogChoicesEditor({
	choices,
	fieldIndex,
	onChange,
	variables,
}: {
	choices: FormDialogChoiceRow[];
	fieldIndex: number;
	onChange: (choices: FormDialogChoiceRow[]) => void;
	variables: VariableCompletion[];
}) {
	const reorder = useReorderController({ rows: choices, onCommit: onChange });
	const draggedChoice = reorder.drag ? choices.find((choice) => choice.id === reorder.drag?.draggedId) : null;
	const update = (choiceId: string, patch: Partial<FormDialogChoiceRow>) =>
		onChange(choices.map((choice) => (choice.id === choiceId ? { ...choice, ...patch } : choice)));
	let visibleIndex = 0;

	return (
		<div className="space-y-2 border-t border-baud-border pt-4">
			<div className="flex items-center justify-between gap-2">
				<span className="font-mono text-xs text-baud-muted">Choices</span>
				<span className="text-xs text-baud-muted">
					{choices.length}/{FORM_DIALOG_MAX_CHOICES}
				</span>
			</div>
			<ul aria-label={`Component ${fieldIndex} choices`} className="space-y-2" ref={reorder.listRef}>
				{reorder.entries.map((entry) => {
					if (entry.type === "drop-space") {
						return <li aria-hidden="true" key={entry.id} style={{ height: entry.height }} />;
					}
					visibleIndex += 1;
					const choiceIndex = choices.findIndex((choice) => choice.id === entry.row.id);
					const choice = entry.row;
					return (
						<li
							className="space-y-3 rounded-lg border border-baud-border bg-baud-soft/55 p-3 shadow-[0_1px_0_rgba(255,255,255,0.02)]"
							key={choice.id}
							ref={reorder.registerRow(choice.id)}
						>
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<DragHandle
										label={`Reorder component ${fieldIndex} choice ${visibleIndex}`}
										onKeyboardMove={(direction) => onChange(moveRow(choices, choiceIndex, direction))}
										onPointerDown={(event) => reorder.startDrag(choice.id, event)}
									/>
									<span className="font-mono text-xs text-baud-muted">Choice {visibleIndex}</span>
								</div>
								<Button
									aria-label={`Remove component ${fieldIndex} choice ${visibleIndex}`}
									onClick={() => onChange(choices.filter((candidate) => candidate.id !== choice.id))}
									size="xsIcon"
									type="button"
									variant="destructive"
								>
									<X size={13} />
								</Button>
							</div>
							<FormDialogKeyField
								error={validateFormDialogChoiceKey(choices, choice.id)}
								label="Key"
								maxLength={FORM_DIALOG_MAX_CHOICE_CHARS}
								value={choice.key}
								onChange={(key) => update(choice.id, { key })}
							/>
							<VariableTextField
								error={
									validateFormDialogChoiceDisplayValue(choices, choice.id) ||
									validateFormDialogTextVariables(choice.displayValue, variables)
								}
								label="Displayed value"
								value={choice.displayValue}
								variables={variables}
								onChange={(displayValue) => update(choice.id, { displayValue })}
							/>
						</li>
					);
				})}
			</ul>
			{draggedChoice && reorder.drag && (
				<FloatingChoice drag={reorder.drag} value={draggedChoice.displayValue || draggedChoice.key} />
			)}
			<Button
				disabled={choices.length >= FORM_DIALOG_MAX_CHOICES}
				onClick={() => onChange([...choices, createFormDialogChoice()])}
				size="sm"
				type="button"
			>
				<Plus /> Add choice
			</Button>
		</div>
	);
}

function VariableTextField({
	error,
	label,
	multiline = false,
	onChange,
	value,
	variables,
}: {
	error: string;
	label: string;
	multiline?: boolean;
	onChange: (value: string) => void;
	value: string;
	variables: VariableCompletion[];
}) {
	const id = useId();
	const errorId = `${id}-error`;
	return (
		<LabeledControl label={label}>
			<VariableCodeInput
				ariaDescribedBy={error ? errorId : undefined}
				ariaLabel={label}
				hasError={!!error}
				id={id}
				multiline={multiline}
				onChange={onChange}
				value={value}
				variableTypes="text"
				variables={variables}
			/>
			<FieldError id={errorId} message={error} />
		</LabeledControl>
	);
}

function FormDialogKeyField({
	error,
	label,
	maxLength,
	onChange,
	value,
}: {
	error: string;
	label: string;
	maxLength: number;
	onChange: (value: string) => void;
	value: string;
}) {
	const id = useId();
	const errorId = `${id}-error`;
	return (
		<LabeledControl label={label}>
			<Input
				aria-describedby={error ? errorId : undefined}
				aria-invalid={!!error || undefined}
				aria-label={label}
				autoCapitalize="none"
				autoCorrect="off"
				id={id}
				maxLength={maxLength}
				onChange={(event) => onChange(event.target.value)}
				pattern="[A-Za-z0-9_-]+"
				spellCheck={false}
				value={value}
			/>
			<FieldError id={errorId} message={error} />
		</LabeledControl>
	);
}

function ToggleRow({
	checked,
	label,
	onChange,
}: {
	checked: boolean;
	label: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex min-h-9 items-center justify-between gap-3 border-y border-baud-border py-2">
			<span className="text-sm text-baud-text">{label}</span>
			<Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
		</div>
	);
}

function LabeledControl({ children, label }: { children: React.ReactNode; label: string }) {
	return (
		<div>
			<span className="mb-1 block font-mono text-xs text-baud-muted">{label}</span>
			{children}
		</div>
	);
}

function DragHandle({
	label,
	onKeyboardMove,
	onPointerDown,
}: {
	label: string;
	onKeyboardMove: (direction: -1 | 1) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
	return (
		<Button
			aria-label={label}
			className="cursor-grab active:cursor-grabbing"
			onKeyDown={(event) => {
				if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
				event.preventDefault();
				onKeyboardMove(event.key === "ArrowUp" ? -1 : 1);
			}}
			onPointerDown={onPointerDown}
			size="xsIcon"
			style={{ touchAction: "none" }}
			title={`${label}. Alt+Up or Alt+Down also moves it.`}
			type="button"
			variant="ghost"
		>
			<GripVertical />
		</Button>
	);
}

function FloatingChoice({ drag, value }: { drag: ActiveReorderDragState; value: string }) {
	return (
		<ReorderDragOverlay className="flex items-center gap-2 p-2 text-sm text-baud-text" drag={drag}>
			<GripVertical /> <span className="truncate">{value || "Choice"}</span>
		</ReorderDragOverlay>
	);
}

function moveRow<Row>(rows: Row[], index: number, direction: -1 | 1) {
	const targetIndex = index + direction;
	if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return rows;
	const nextRows = [...rows];
	const [row] = nextRows.splice(index, 1);
	nextRows.splice(targetIndex, 0, row);
	return nextRows;
}
