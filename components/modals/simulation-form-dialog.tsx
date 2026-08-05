"use client";

import { Check, Eye, EyeOff, FolderOpen } from "lucide-react";
import Image from "next/image";
import { type FormEvent, type PointerEvent, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { NumericField } from "@/components/common/numeric-field";
import { simulationDialogSizeClasses } from "@/components/modals/simulation-dialog-size";
import {
	SimulationDialogTimeoutCountdown,
	useSimulationDialogTimeout,
} from "@/components/modals/simulation-dialog-timeout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { runtimeNumberContract, validateNumericConfigValue } from "@/data/nodes/numeric-validation";
import { datetimeInTimeZoneToIso } from "@/data/project/datetime";
import type { EditorAsset, JsonValue } from "@/lib/types";
import type { SimulationSideEffect, SimulationSideEffectResult } from "@/utils/simulation";
import type { SimulationFormDialogField } from "@/utils/simulation-types";

type FormDialogRequest = Extract<SimulationSideEffect, { type: "form_dialog" }>;
type FormDialogResult = Omit<Extract<SimulationSideEffectResult, { type: "form_dialog" }>, "nodeId" | "type">;

export function SimulationFormDialog({
	assets,
	dialog,
	onComplete,
}: {
	assets: EditorAsset[];
	dialog: FormDialogRequest | null;
	onComplete: (result: FormDialogResult) => void;
}) {
	const descriptionId = useId();
	const titleId = useId();
	const [values, setValues] = useState<Record<string, JsonValue>>({});
	const [revealedPasswords, setRevealedPasswords] = useState<Set<string>>(new Set());

	useEffect(() => {
		setValues(dialog ? createInitialValues(dialog.fields) : {});
		setRevealedPasswords(new Set());
	}, [dialog]);

	const timeoutDeadline = useSimulationDialogTimeout(dialog?.timeoutSeconds, dialog?.nodeId ?? null, () => {
		setValues({});
		setRevealedPasswords(new Set());
		onComplete({ button: "timeout", submitted: false, values: {} });
	});

	const validationErrors = useMemo(
		() => (dialog ? validateValues(dialog.fields, values) : new Map<string, string>()),
		[dialog, values],
	);

	if (!dialog) return <Dialog open={false} onOpenChange={() => undefined} />;

	const finish = (result: FormDialogResult) => {
		setValues({});
		setRevealedPasswords(new Set());
		onComplete(result);
	};
	const cancel = () => finish({ button: "cancel", submitted: false, values: {} });
	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		if (validationErrors.size > 0) return;
		finish({ button: "ok", submitted: true, values: normalizeSubmittedValues(dialog.fields, values) });
	};
	const updateValue = (key: string, value: JsonValue) => setValues((current) => ({ ...current, [key]: value }));
	const initialFocusIndex = firstInputIndex(dialog.fields);

	return (
		<Dialog open onOpenChange={() => undefined}>
			<DialogContent
				aria-describedby={dialog.description ? descriptionId : undefined}
				aria-labelledby={titleId}
				className={`${simulationDialogSizeClasses[dialog.dialogSize]} gap-0 overflow-hidden rounded-lg bg-baud-bg p-0 ring-baud-border`}
				data-simulation-form-dialog-shell
				showCloseButton={false}
				onEscapeKeyDown={(event) => {
					event.preventDefault();
					cancel();
				}}
				onInteractOutside={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
			>
				<form className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]" onSubmit={submit}>
					<header className="border-b border-baud-border bg-baud-panel px-5 py-3">
						<div className="flex min-w-0 items-center justify-between gap-4">
							<div className="flex shrink-0 items-center gap-2">
								<Image
									alt=""
									aria-hidden="true"
									className="size-5 shrink-0"
									height="20"
									src="/logo-notext.svg"
									width="20"
								/>
								<span className="text-sm font-semibold text-baud-text">BaudBound</span>
							</div>
							<span className="min-w-0 truncate text-xs text-baud-muted" title={`Simulating ${dialog.nodeId}`}>
								Requested by editor simulator
							</span>
						</div>
					</header>

					<section className="min-h-0 overflow-x-hidden overflow-y-auto px-5 py-5" data-simulation-form-dialog-content>
						<h1 className="break-words text-base font-semibold text-baud-text" id={titleId}>
							{dialog.title}
						</h1>
						{dialog.description && (
							<p id={descriptionId} className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-baud-muted">
								{dialog.description}
							</p>
						)}
						<div className="mt-5 grid gap-5">
							{dialog.fields.map((field, index) => (
								<SimulationFormField
									assets={assets}
									autoFocus={index === initialFocusIndex}
									error={"key" in field ? (validationErrors.get(field.key) ?? "") : ""}
									field={field}
									key={"key" in field ? field.key : `display-${index}`}
									revealed={"key" in field && revealedPasswords.has(field.key)}
									value={"key" in field ? values[field.key] : undefined}
									onPasswordReveal={(revealed) => {
										if (!("key" in field)) return;
										setRevealedPasswords((current) => {
											const next = new Set(current);
											if (revealed) next.add(field.key);
											else next.delete(field.key);
											return next;
										});
									}}
									onValueChange={(value) => {
										if ("key" in field) updateValue(field.key, value);
									}}
								/>
							))}
						</div>
					</section>

					<footer
						className="flex min-h-15 flex-wrap items-center justify-between gap-3 border-t border-baud-border bg-baud-panel px-5 py-3"
						data-simulation-form-dialog-footer
					>
						<SimulationDialogTimeoutCountdown deadline={timeoutDeadline} />
						<div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
							<Button type="button" variant="outline" onClick={cancel}>
								Cancel
							</Button>
							<Button type="submit" disabled={validationErrors.size > 0} variant="primary">
								Submit
							</Button>
						</div>
					</footer>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function SimulationDialogImage({
	assets,
	field,
}: {
	assets: EditorAsset[];
	field: Extract<SimulationFormDialogField, { type: "image" }>;
}) {
	const asset = assets.find((candidate) => candidate.kind === "image" && candidate.packagePath === field.assetPath);
	const [source, setSource] = useState("");
	useEffect(() => {
		if (!asset) {
			setSource("");
			return;
		}
		const url = URL.createObjectURL(asset.file);
		setSource(url);
		return () => URL.revokeObjectURL(url);
	}, [asset]);
	if (!source) return null;
	return (
		<figure>
			<div
				className="relative w-full overflow-hidden rounded border border-baud-border bg-baud-panel"
				style={{ height: field.imageHeight }}
			>
				<Image alt={field.label} fill sizes="720px" src={source} style={{ objectFit: field.imageFit }} unoptimized />
			</div>
			{field.description && <figcaption className="mt-1 text-xs text-baud-muted">{field.description}</figcaption>}
		</figure>
	);
}

function SimulationFormField({
	assets,
	autoFocus,
	error,
	field,
	onPasswordReveal,
	onValueChange,
	revealed,
	value,
}: {
	assets: EditorAsset[];
	autoFocus: boolean;
	error: string;
	field: SimulationFormDialogField;
	onPasswordReveal: (revealed: boolean) => void;
	onValueChange: (value: JsonValue) => void;
	revealed: boolean;
	value: JsonValue | undefined;
}) {
	const inputId = useId();
	const errorId = `${inputId}-error`;
	const descriptionId = `${inputId}-description`;
	if (field.type === "information") {
		return (
			<section
				className="rounded border border-baud-border border-l-[3px] bg-baud-soft/60 px-4 py-3 shadow-[0_1px_0_rgb(255_255_255/0.025)]"
				data-form-dialog-information
				style={{ borderLeftColor: field.accentColor }}
			>
				{field.label && <h2 className="text-sm font-semibold text-baud-text">{field.label}</h2>}
				{field.description && (
					<p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-baud-muted">{field.description}</p>
				)}
			</section>
		);
	}
	if (field.type === "section_heading") {
		return (
			<section className="border-b pb-2" style={{ borderColor: field.accentColor }}>
				{field.label && <h2 className="text-base font-semibold text-baud-text">{field.label}</h2>}
				{field.description && (
					<p className="mt-1 whitespace-pre-wrap break-words text-sm text-baud-muted">{field.description}</p>
				)}
			</section>
		);
	}
	if (field.type === "divider") {
		return <hr className="border-0 border-t" style={{ borderColor: field.accentColor }} />;
	}
	if (field.type === "image") {
		return <SimulationDialogImage assets={assets} field={field} />;
	}

	const label = (
		<span className="w-fit text-sm font-medium text-baud-text" id={`${inputId}-label`}>
			{field.label}
			{field.required && (
				<span aria-hidden="true" className="ml-1 text-baud-red">
					*
				</span>
			)}
		</span>
	);
	const description = field.description ? (
		<p className="whitespace-pre-wrap break-words text-xs leading-5 text-baud-muted" id={descriptionId}>
			{field.description}
		</p>
	) : null;
	const describedBy =
		[field.description ? descriptionId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;

	if (field.type === "checkbox") {
		return (
			<div className="grid gap-1.5">
				<div className="flex min-w-0 items-center justify-between gap-4">
					{label}
					<Switch
						aria-describedby={describedBy}
						aria-invalid={!!error || undefined}
						aria-labelledby={`${inputId}-label`}
						autoFocus={autoFocus}
						checked={value === true}
						id={inputId}
						onCheckedChange={onValueChange}
					/>
				</div>
				{description}
				<SimulationFieldError id={errorId} message={error} />
			</div>
		);
	}

	if (field.type === "dropdown") {
		return (
			<div className="grid gap-1.5">
				{label}
				{description}
				<Select value={typeof value === "string" && value ? value : undefined} onValueChange={onValueChange}>
					<SelectTrigger
						aria-describedby={describedBy}
						aria-invalid={!!error || undefined}
						aria-labelledby={`${inputId}-label`}
						autoFocus={autoFocus}
						className="h-9 w-full rounded-md bg-baud-bg"
					>
						<SelectValue placeholder="Select a choice" />
					</SelectTrigger>
					<SelectContent>
						{field.choices.map((choice) => (
							<SelectItem key={choice.key} value={choice.key}>
								{choice.displayValue}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<SimulationFieldError id={errorId} message={error} />
			</div>
		);
	}

	if (field.type === "single_choice" || field.type === "multi_choice") {
		const selected =
			field.type === "multi_choice" && Array.isArray(value)
				? value.filter((item): item is string => typeof item === "string")
				: [];
		return (
			<fieldset
				aria-describedby={field.description ? descriptionId : undefined}
				aria-invalid={!!error || undefined}
				className="grid min-w-0 gap-2"
			>
				<legend className="text-sm font-medium text-baud-text" id={`${inputId}-label`}>
					{field.label}
					{field.required && (
						<span aria-hidden="true" className="ml-1 text-baud-red">
							*
						</span>
					)}
				</legend>
				{description}
				<div className="grid max-h-72 gap-2 overflow-x-hidden overflow-y-auto pr-1">
					{field.choices.map((choice, choiceIndex) => {
						const checked = field.type === "multi_choice" ? selected.includes(choice.key) : value === choice.key;
						return (
							<label
								className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md border bg-baud-panel px-3 py-2 text-left text-sm transition-colors has-[:focus-visible]:border-baud-red has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-baud-red/30 ${checked ? "border-baud-red text-baud-text" : "border-baud-border text-baud-muted hover:border-baud-red/60 hover:text-baud-text"}`}
								key={choice.key}
							>
								<span className="relative grid size-4 shrink-0 place-items-center">
									<input
										checked={checked}
										className="peer col-start-1 row-start-1 size-4 cursor-pointer appearance-none rounded-full border border-baud-muted outline-none checked:border-baud-red checked:bg-baud-red"
										id={`${inputId}-choice-${choiceIndex}`}
										name={field.type === "single_choice" ? inputId : undefined}
										onChange={() => {
											if (field.type === "single_choice") onValueChange(choice.key);
											else
												onValueChange(
													checked ? selected.filter((key) => key !== choice.key) : [...selected, choice.key],
												);
										}}
										type={field.type === "multi_choice" ? "checkbox" : "radio"}
									/>
									<Check
										aria-hidden="true"
										className="pointer-events-none col-start-1 row-start-1 size-3 text-white opacity-0 peer-checked:opacity-100"
										strokeWidth={3}
									/>
								</span>
								<span className="min-w-0 break-words">{choice.displayValue}</span>
							</label>
						);
					})}
				</div>
				<SimulationFieldError id={errorId} message={error} />
			</fieldset>
		);
	}
	if (field.type === "file" || field.type === "folder") {
		const displayed = Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string").join("\n")
			: typeof value === "string"
				? value
				: "";
		return (
			<div className="grid gap-1.5">
				{label}
				{description}
				<div className="relative">
					{field.type === "file" && field.multiple ? (
						<Textarea
							aria-describedby={describedBy}
							aria-invalid={!!error || undefined}
							aria-labelledby={`${inputId}-label`}
							autoFocus={autoFocus}
							className="min-h-24 rounded-md bg-baud-bg pr-3 pl-10"
							placeholder="One simulated path per line"
							value={displayed}
							onChange={(event) => onValueChange(event.target.value.split(/\r?\n/).filter(Boolean))}
						/>
					) : (
						<Input
							aria-describedby={describedBy}
							aria-invalid={!!error || undefined}
							aria-labelledby={`${inputId}-label`}
							autoFocus={autoFocus}
							className="min-h-9 rounded-md bg-baud-bg pr-3 pl-10"
							placeholder="Simulated path"
							value={displayed}
							onChange={(event) => onValueChange(event.target.value)}
						/>
					)}
					<FolderOpen
						aria-hidden="true"
						className="pointer-events-none absolute top-2.5 left-3 size-4 text-baud-muted"
					/>
				</div>
				<SimulationFieldError id={errorId} message={error} />
			</div>
		);
	}
	if (field.type === "slider") {
		const numericValue = typeof value === "number" ? value : field.defaultValue;
		return (
			<div className="grid gap-1.5">
				{label}
				{description}
				<div className="flex items-center gap-3 rounded border border-baud-border bg-baud-panel px-3 py-2">
					<input
						aria-describedby={describedBy}
						aria-labelledby={`${inputId}-label`}
						className="min-w-0 flex-1 accent-baud-red"
						max={field.maximum}
						min={field.minimum}
						step={field.step}
						type="range"
						value={numericValue}
						onChange={(event) => onValueChange(Number(event.target.value))}
					/>
					<output className="w-20 truncate text-right font-mono text-sm text-baud-text">{numericValue}</output>
				</div>
				<SimulationFieldError id={errorId} message={error} />
			</div>
		);
	}
	if (field.type === "color") {
		const color = typeof value === "string" ? value : field.defaultValue;
		return (
			<div className="grid gap-1.5">
				{label}
				{description}
				<div
					className={`flex h-9 overflow-hidden rounded-md border bg-baud-panel ${error ? "border-baud-danger" : "border-baud-border"}`}
				>
					<input
						aria-label={`${field.label} color`}
						className="h-full w-12 cursor-pointer border-0 bg-transparent p-1"
						type="color"
						value={color}
						onChange={(event) => onValueChange(event.target.value.toUpperCase())}
					/>
					<Input
						aria-describedby={describedBy}
						aria-invalid={!!error || undefined}
						aria-labelledby={`${inputId}-label`}
						className="h-full rounded-none border-0 border-l border-baud-border font-mono"
						value={color}
						onChange={(event) => onValueChange(event.target.value)}
					/>
				</div>
				<SimulationFieldError id={errorId} message={error} />
			</div>
		);
	}

	return (
		<div className="grid gap-1.5">
			{label}
			{description}
			<div className="relative">
				{field.type === "multiline" ? (
					<Textarea
						aria-describedby={describedBy}
						aria-invalid={!!error || undefined}
						aria-labelledby={`${inputId}-label`}
						autoFocus={autoFocus}
						className="min-h-24 w-full resize-y rounded-md bg-baud-bg px-3 py-2"
						id={inputId}
						maxLength={16_384}
						placeholder={"placeholder" in field ? field.placeholder : ""}
						value={typeof value === "string" ? value : ""}
						onChange={(event) => onValueChange(event.target.value)}
					/>
				) : field.type === "number" ? (
					<NumericField
						ariaDescribedBy={field.description ? descriptionId : undefined}
						ariaLabel={field.label}
						contract={runtimeNumberContract}
						controlClassName="h-9 rounded-md bg-baud-bg"
						id={inputId}
						placeholder={"placeholder" in field ? field.placeholder : ""}
						required={field.required}
						validationError={error}
						value={typeof value === "number" || typeof value === "string" ? value : ""}
						onChange={onValueChange}
					/>
				) : field.type === "date" || field.type === "time" || field.type === "datetime" ? (
					<Input
						aria-describedby={describedBy}
						aria-invalid={!!error || undefined}
						aria-labelledby={`${inputId}-label`}
						autoFocus={autoFocus}
						className="min-h-9 rounded-md bg-baud-bg px-3 py-2"
						id={inputId}
						step={field.type === "date" ? undefined : "1"}
						type={field.type === "datetime" ? "datetime-local" : field.type}
						value={typeof value === "string" ? value : ""}
						onChange={(event) => onValueChange(event.target.value)}
					/>
				) : (
					<Input
						aria-describedby={describedBy}
						aria-invalid={!!error || undefined}
						aria-labelledby={`${inputId}-label`}
						autoComplete={field.type === "password" ? "off" : undefined}
						autoFocus={autoFocus}
						className={`min-h-9 rounded-md bg-baud-bg px-3 py-2 ${field.type === "password" ? "secret-value-input pr-10" : ""}`}
						id={inputId}
						maxLength={16_384}
						placeholder={"placeholder" in field ? field.placeholder : ""}
						type={field.type === "password" && !revealed ? "password" : "text"}
						value={typeof value === "string" ? value : ""}
						onChange={(event) => onValueChange(event.target.value)}
					/>
				)}
				{field.type === "password" && (
					<PasswordRevealButton onReveal={onPasswordReveal}>
						{revealed ? <EyeOff size={15} /> : <Eye size={15} />}
					</PasswordRevealButton>
				)}
			</div>
			{field.type !== "number" && <SimulationFieldError id={errorId} message={error} />}
		</div>
	);
}

function SimulationFieldError({ id, message }: { id: string; message?: string }) {
	return message ? (
		<p className="text-xs leading-4 text-baud-danger" id={id} role="alert">
			{message}
		</p>
	) : null;
}

function PasswordRevealButton({ children, onReveal }: { children: ReactNode; onReveal: (revealed: boolean) => void }) {
	const conceal = (event?: PointerEvent<HTMLButtonElement>) => {
		if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		onReveal(false);
	};
	return (
		<Button
			aria-label="Hold to reveal password"
			className="absolute inset-y-0 right-0"
			onBlur={() => onReveal(false)}
			onPointerCancel={conceal}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				onReveal(true);
			}}
			onPointerUp={conceal}
			size="icon"
			type="button"
			variant="ghost"
		>
			{children}
		</Button>
	);
}

function createInitialValues(fields: SimulationFormDialogField[]) {
	const values: Record<string, JsonValue> = {};
	for (const field of fields) {
		if (!("key" in field)) continue;
		if (field.type === "checkbox") values[field.key] = field.defaultChecked;
		else if (field.type === "multi_choice") values[field.key] = [];
		else if (field.type === "file") values[field.key] = field.multiple ? [] : "";
		else if (
			field.type === "single_choice" ||
			field.type === "dropdown" ||
			field.type === "password" ||
			field.type === "folder"
		)
			values[field.key] = "";
		else values[field.key] = "defaultValue" in field ? field.defaultValue : "";
	}
	return values;
}

function validateValues(fields: SimulationFormDialogField[], values: Record<string, JsonValue>) {
	const errors = new Map<string, string>();
	for (const field of fields) {
		if (!("key" in field)) continue;
		const value = values[field.key];
		if (field.type === "number") {
			const text = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
			if (field.required && !text) errors.set(field.key, "A number is required.");
			else if (text && validateNumericConfigValue(text, runtimeNumberContract))
				errors.set(field.key, "Enter a supported finite number.");
			continue;
		}
		if (field.type === "slider") {
			if (typeof value !== "number" || !Number.isFinite(value) || value < field.minimum || value > field.maximum) {
				errors.set(field.key, "Select a value within the configured range.");
			}
			continue;
		}
		if (field.type === "checkbox") {
			if (field.required && value !== true) errors.set(field.key, "This checkbox is required.");
			continue;
		}
		if (field.type === "multi_choice") {
			if (field.required && (!Array.isArray(value) || value.length === 0))
				errors.set(field.key, "Select at least one choice.");
			continue;
		}
		if (field.type === "file" && field.multiple) {
			if (field.required && (!Array.isArray(value) || value.length === 0))
				errors.set(field.key, "Select at least one file.");
			continue;
		}
		if (field.type === "color" && (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value))) {
			errors.set(field.key, "Select a valid color.");
			continue;
		}
		if (field.required && (typeof value !== "string" || !value)) {
			errors.set(
				field.key,
				field.type === "single_choice" || field.type === "dropdown" ? "Select a choice." : "A value is required.",
			);
		}
	}
	return errors;
}

function normalizeSubmittedValues(fields: SimulationFormDialogField[], values: Record<string, JsonValue>) {
	const normalized: Record<string, JsonValue> = {};
	for (const field of fields) {
		if (!("key" in field)) continue;
		const value = values[field.key];
		if (field.type === "number" || field.type === "slider") {
			const text = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
			if (text) normalized[field.key] = Number(text);
			continue;
		}
		if (field.type === "datetime" && typeof value === "string" && value) {
			const iso = datetimeInTimeZoneToIso(value.length === 16 ? `${value}:00` : value, field.timezone ?? "__local__");
			if (iso) normalized[field.key] = iso;
			continue;
		}
		if (field.type === "multi_choice") {
			const selected = Array.isArray(value)
				? new Set(value.filter((item): item is string => typeof item === "string"))
				: new Set<string>();
			normalized[field.key] = field.choices.filter((choice) => selected.has(choice.key)).map((choice) => choice.key);
			continue;
		}
		normalized[field.key] = value ?? "";
	}
	return normalized;
}

function firstInputIndex(fields: SimulationFormDialogField[]) {
	return fields.findIndex((field) => "key" in field);
}
