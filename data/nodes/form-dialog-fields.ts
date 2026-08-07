import { userIdentifierPattern } from "@/data/project/user-identifier";
import type { JsonValue, RuntimeDataField, RuntimeDataType } from "@/lib/types";
import { validateStaticColor } from "./color-match";
import type { SelectOption } from "./definitions/options";

export const FORM_DIALOG_MAX_FIELDS = 50;
export const FORM_DIALOG_MAX_CHOICES = 100;
export const FORM_DIALOG_MAX_KEY_CHARS = 64;
export const FORM_DIALOG_MAX_LABEL_CHARS = 200;
export const FORM_DIALOG_MAX_DESCRIPTION_CHARS = 2_048;
export const FORM_DIALOG_MAX_PLACEHOLDER_CHARS = 512;
export const FORM_DIALOG_MAX_DEFAULT_CHARS = 16_384;
export const FORM_DIALOG_MAX_CHOICE_CHARS = 512;
export const FORM_DIALOG_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const FORM_DIALOG_DEFAULT_ACCENT_COLOR = "#5B8AF5";
export const FORM_DIALOG_DEFAULT_IMAGE_HEIGHT = "240";

export const formDialogFieldTypes = [
	"text",
	"password",
	"multiline",
	"number",
	"checkbox",
	"single_choice",
	"multi_choice",
	"dropdown",
	"date",
	"time",
	"datetime",
	"color",
	"file",
	"folder",
	"slider",
	"information",
	"section_heading",
	"divider",
	"image",
] as const;

export type FormDialogFieldType = (typeof formDialogFieldTypes)[number];
export type FormDialogImageFit = "contain" | "cover";

export const formDialogFieldTypeOptions: SelectOption[] = [
	{ label: "Text input", value: "text" },
	{ label: "Password input", value: "password" },
	{ label: "Multiline text", value: "multiline" },
	{ label: "Number input", value: "number" },
	{ label: "Checkbox", value: "checkbox" },
	{ label: "Single choice", value: "single_choice" },
	{ label: "Multi choice", value: "multi_choice" },
	{ label: "Dropdown", value: "dropdown" },
	{ label: "Date", value: "date" },
	{ label: "Time", value: "time" },
	{ label: "Date and time", value: "datetime" },
	{ label: "Color picker", value: "color" },
	{ label: "File picker", value: "file" },
	{ label: "Folder picker", value: "folder" },
	{ label: "Slider", value: "slider" },
	{ label: "Information", value: "information" },
	{ label: "Section heading", value: "section_heading" },
	{ label: "Divider", value: "divider" },
	{ label: "Image", value: "image" },
];

export type FormDialogChoiceRow = {
	displayValue: string;
	id: string;
	key: string;
};

export type FormDialogFieldRow = {
	accentColor: string;
	assetPath: string;
	choices: FormDialogChoiceRow[];
	defaultChecked: boolean;
	defaultValue: string;
	description: string;
	id: string;
	imageFit: FormDialogImageFit;
	imageHeight: string;
	key: string;
	label: string;
	maximum: string;
	minimum: string;
	multiple: boolean;
	placeholder: string;
	required: boolean;
	step: string;
	timezone: string;
	type: FormDialogFieldType;
};

export function createFormDialogChoice(key = "", displayValue = ""): FormDialogChoiceRow {
	return { displayValue, id: crypto.randomUUID(), key };
}

export function createFormDialogField(type: FormDialogFieldType = "text"): FormDialogFieldRow {
	return {
		accentColor: FORM_DIALOG_DEFAULT_ACCENT_COLOR,
		assetPath: "",
		choices: usesChoices(type) ? [createFormDialogChoice()] : [],
		defaultChecked: false,
		defaultValue: type === "color" ? FORM_DIALOG_DEFAULT_ACCENT_COLOR : type === "slider" ? "50" : "",
		description: "",
		id: crypto.randomUUID(),
		imageFit: "contain",
		imageHeight: FORM_DIALOG_DEFAULT_IMAGE_HEIGHT,
		key: isPresentationFieldType(type) ? "" : "value",
		label: "",
		maximum: "100",
		minimum: "0",
		multiple: false,
		placeholder: "",
		required: !isPresentationFieldType(type),
		step: "1",
		timezone: "__local__",
		type,
	};
}

export function createFormDialogFieldWithUniqueKey(type: FormDialogFieldType, fields: readonly FormDialogFieldRow[]) {
	const field = createFormDialogField(type);
	return isPresentationFieldType(type)
		? field
		: { ...field, key: getUniqueFormDialogFieldKey(defaultKeyForType(type), fields) };
}

export function duplicateFormDialogField(field: FormDialogFieldRow, fields: readonly FormDialogFieldRow[]) {
	return {
		...field,
		choices: field.choices.map((choice) => ({ ...choice, id: crypto.randomUUID() })),
		id: crypto.randomUUID(),
		key: isPresentationFieldType(field.type) ? "" : getUniqueFormDialogFieldKey(field.key.trim() || "value", fields),
	};
}

export function getFormDialogFields(value: JsonValue | undefined): FormDialogFieldRow[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry, index) => {
		if (!isRecord(entry) || !isFormDialogFieldType(entry.type)) return [];
		const type = entry.type;
		return [
			{
				accentColor: typeof entry.accentColor === "string" ? entry.accentColor : FORM_DIALOG_DEFAULT_ACCENT_COLOR,
				assetPath: typeof entry.assetPath === "string" ? entry.assetPath : "",
				choices: getFormDialogChoices(entry.choices),
				defaultChecked: entry.defaultChecked === true,
				defaultValue: typeof entry.defaultValue === "string" ? entry.defaultValue : "",
				description: typeof entry.description === "string" ? entry.description : "",
				id: typeof entry.id === "string" && entry.id ? entry.id : `form-dialog-field-${index + 1}`,
				imageFit: entry.imageFit === "cover" ? "cover" : "contain",
				imageHeight: typeof entry.imageHeight === "string" ? entry.imageHeight : FORM_DIALOG_DEFAULT_IMAGE_HEIGHT,
				key: typeof entry.key === "string" ? entry.key : "",
				label: typeof entry.label === "string" ? entry.label : "",
				maximum: typeof entry.maximum === "string" ? entry.maximum : "100",
				minimum: typeof entry.minimum === "string" ? entry.minimum : "0",
				multiple: entry.multiple === true,
				placeholder: typeof entry.placeholder === "string" ? entry.placeholder : "",
				required: !isPresentationFieldType(type) && entry.required !== false,
				step: typeof entry.step === "string" ? entry.step : "1",
				timezone: typeof entry.timezone === "string" ? entry.timezone : "__local__",
				type,
			},
		];
	});
}

export function sanitizeFormDialogFields(value: JsonValue | undefined): JsonValue[] {
	return getFormDialogFields(value).map((field) => {
		const common = { type: field.type, label: field.label.trim(), description: field.description };
		if (field.type === "information" || field.type === "section_heading") {
			return { ...common, accentColor: field.accentColor };
		}
		if (field.type === "divider") return { ...common, accentColor: field.accentColor };
		if (field.type === "image") {
			return {
				...common,
				assetPath: field.assetPath,
				imageFit: field.imageFit,
				imageHeight: field.imageHeight,
			};
		}

		const input = { ...common, key: field.key, required: field.required };
		if (field.type === "checkbox") return { ...input, defaultChecked: field.defaultChecked };
		if (usesChoices(field.type)) {
			return {
				...input,
				choices: field.choices.map((choice) => ({ key: choice.key, displayValue: choice.displayValue })),
			};
		}
		if (field.type === "password") return { ...input, placeholder: field.placeholder };
		if (field.type === "file") return { ...input, multiple: field.multiple };
		if (field.type === "folder") return input;
		if (field.type === "datetime") return { ...input, defaultValue: field.defaultValue, timezone: field.timezone };
		if (field.type === "date" || field.type === "time" || field.type === "color") {
			return { ...input, defaultValue: field.defaultValue };
		}
		if (field.type === "slider") {
			return {
				...input,
				defaultValue: field.defaultValue,
				minimum: field.minimum,
				maximum: field.maximum,
				step: field.step,
			};
		}
		return { ...input, placeholder: field.placeholder, defaultValue: field.defaultValue };
	});
}

export function deriveFormDialogValueFields(value: JsonValue | undefined): RuntimeDataField[] {
	const fields = getFormDialogFields(value);
	return fields.flatMap((field) => {
		const type = formDialogFieldRuntimeType(field);
		if (!type || validateFormDialogFieldKey(fields, field.id)) return [];
		return [
			{
				name: field.key.trim(),
				type,
				description: field.label.trim() || `${formDialogFieldTypeLabel(field.type)} result.`,
			},
		];
	});
}

export function validateFormDialogFields(value: JsonValue | undefined) {
	if (!Array.isArray(value)) return ["form fields must be a list."];
	if (value.length === 0) return ["form requires at least one component."];
	if (value.length > FORM_DIALOG_MAX_FIELDS) return [`form supports at most ${FORM_DIALOG_MAX_FIELDS} components.`];
	const fields = getFormDialogFields(value);
	if (fields.length !== value.length) return ["form contains an invalid component."];

	const errors: string[] = [];
	for (const [index, field] of fields.entries()) {
		const prefix = `component ${index + 1}`;
		const label = field.label.trim();
		if (isPresentationFieldType(field.type)) {
			if ((field.type === "information" || field.type === "section_heading") && !label && !field.description.trim()) {
				errors.push(`${prefix} requires a label or description.`);
			}
			if (usesAccentColor(field.type)) {
				const error = validateStaticColor(field.accentColor, `${prefix} accent color`);
				if (error) errors.push(error);
			}
			if (field.type === "image") {
				if (!field.assetPath.trim()) errors.push(`${prefix} image asset is required.`);
				validateStaticNumber(errors, field.imageHeight, 80, 600, `${prefix} image height`);
			}
		} else {
			const keyError = validateFormDialogFieldKey(fields, field.id);
			if (keyError) errors.push(`${prefix}: ${lowercaseFirst(keyError)}`);
			if (!label) errors.push(`${prefix} label is required.`);
		}
		pushMaximumError(errors, label, FORM_DIALOG_MAX_LABEL_CHARS, `${prefix} label`);
		pushMaximumError(errors, field.description, FORM_DIALOG_MAX_DESCRIPTION_CHARS, `${prefix} description`);
		if (usesPlaceholder(field.type))
			pushMaximumError(errors, field.placeholder, FORM_DIALOG_MAX_PLACEHOLDER_CHARS, `${prefix} placeholder`);
		if (usesDefaultValue(field.type))
			pushMaximumError(errors, field.defaultValue, FORM_DIALOG_MAX_DEFAULT_CHARS, `${prefix} default value`);
		if (usesChoices(field.type)) errors.push(...validateFormDialogChoices(field.choices, prefix));
		if (field.type === "color" && !field.defaultValue.includes("{{")) {
			const error = validateStaticColor(field.defaultValue, `${prefix} default color`);
			if (error) errors.push(error);
		}
		if (field.type === "slider") validateStaticSlider(errors, field, prefix);
		if (
			(field.type === "date" || field.type === "time" || field.type === "datetime") &&
			field.defaultValue &&
			!field.defaultValue.includes("{{") &&
			!isValidFormDialogTemporalDefault(field.type, field.defaultValue)
		) {
			errors.push(
				`${prefix} default value must be a valid ${field.type === "datetime" ? "date and time" : field.type}.`,
			);
		}
		if (field.type === "datetime" && !isValidTimeZone(field.timezone)) errors.push(`${prefix} timezone is invalid.`);
	}
	return errors;
}

export function validateFormDialogFieldKey(fields: readonly FormDialogFieldRow[], fieldId: string) {
	const field = fields.find((candidate) => candidate.id === fieldId);
	if (!field || isPresentationFieldType(field.type)) return "";
	const key = field.key;
	if (!key) return "Key is required.";
	if (Array.from(key).length > FORM_DIALOG_MAX_KEY_CHARS)
		return `Key must contain at most ${FORM_DIALOG_MAX_KEY_CHARS} characters.`;
	if (!userIdentifierPattern.test(key)) {
		return "Key may contain only letters A-Z, a-z, numbers 0-9, hyphens, and underscores.";
	}
	return fields.some(
		(candidate) => candidate.id !== fieldId && !isPresentationFieldType(candidate.type) && candidate.key === key,
	)
		? "Key must be unique."
		: "";
}

export function validateFormDialogChoiceKey(choices: readonly FormDialogChoiceRow[], choiceId: string) {
	const choice = choices.find((candidate) => candidate.id === choiceId);
	const key = choice?.key ?? "";
	if (!key) return "Key is required.";
	if (Array.from(key).length > FORM_DIALOG_MAX_CHOICE_CHARS)
		return `Key must contain at most ${FORM_DIALOG_MAX_CHOICE_CHARS} characters.`;
	if (!userIdentifierPattern.test(key)) {
		return "Key may contain only letters A-Z, a-z, numbers 0-9, hyphens, and underscores.";
	}
	return choices.some((candidate) => candidate.id !== choiceId && candidate.key === key) ? "Key must be unique." : "";
}

export function validateFormDialogChoiceDisplayValue(choices: readonly FormDialogChoiceRow[], choiceId: string) {
	const choice = choices.find((candidate) => candidate.id === choiceId);
	const displayValue = choice?.displayValue.trim() ?? "";
	if (!displayValue) return "Displayed value is required.";
	return choices.some((candidate) => candidate.id !== choiceId && candidate.displayValue.trim() === displayValue)
		? "Displayed value must be unique."
		: "";
}

export function formDialogFieldRuntimeType(field: FormDialogFieldRow): RuntimeDataType | null {
	if (field.type === "number" || field.type === "slider") return "float";
	if (field.type === "checkbox") return "boolean";
	if (field.type === "multi_choice" || (field.type === "file" && field.multiple)) return "list";
	if (field.type === "file" || field.type === "folder") return "string";
	if (field.type === "color") return "color";
	if (isPresentationFieldType(field.type)) return null;
	return "string";
}

export function formDialogFieldTypeLabel(type: FormDialogFieldType) {
	return formDialogFieldTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function isChoiceFieldType(type: FormDialogFieldType) {
	return type === "single_choice" || type === "multi_choice";
}

export function usesChoices(type: FormDialogFieldType) {
	return isChoiceFieldType(type) || type === "dropdown";
}

export function isPresentationFieldType(type: FormDialogFieldType) {
	return type === "information" || type === "section_heading" || type === "divider" || type === "image";
}

export function usesAccentColor(type: FormDialogFieldType) {
	return type === "information" || type === "section_heading" || type === "divider";
}

export function usesPlaceholder(type: FormDialogFieldType) {
	return type === "text" || type === "password" || type === "multiline" || type === "number";
}

export function usesDefaultValue(type: FormDialogFieldType) {
	return ["text", "multiline", "number", "date", "time", "datetime", "color", "slider"].includes(type);
}

export function isFormDialogFieldType(value: JsonValue | undefined): value is FormDialogFieldType {
	return typeof value === "string" && formDialogFieldTypes.includes(value as FormDialogFieldType);
}

export function isValidTimeZone(value: string) {
	if (value === "__local__") return true;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
		return true;
	} catch {
		return false;
	}
}

export function isValidFormDialogTemporalDefault(type: "date" | "datetime" | "time", value: string): boolean {
	if (type === "time") return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
	if (type === "date") {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (!match) return false;
		const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
		return date.toISOString().slice(0, 10) === value;
	}
	const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)$/.exec(value);
	return (
		!!match && isValidFormDialogTemporalDefault("date", match[1]) && isValidFormDialogTemporalDefault("time", match[2])
	);
}

function defaultKeyForType(type: FormDialogFieldType) {
	if (usesChoices(type)) return "choice";
	if (type === "datetime") return "dateTime";
	return type;
}

function getUniqueFormDialogFieldKey(base: string, fields: readonly FormDialogFieldRow[]) {
	const usedKeys = new Set(
		fields.filter((field) => !isPresentationFieldType(field.type)).map((field) => field.key.trim()),
	);
	let key = base;
	let suffix = 2;
	while (usedKeys.has(key)) key = `${base}${suffix++}`;
	return key;
}

function getFormDialogChoices(value: JsonValue | undefined): FormDialogChoiceRow[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry, index) => {
		if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.displayValue !== "string") return [];
		return [
			{
				displayValue: entry.displayValue,
				id: typeof entry.id === "string" && entry.id ? entry.id : `form-dialog-choice-${index + 1}`,
				key: entry.key,
			},
		];
	});
}

function validateFormDialogChoices(choices: FormDialogChoiceRow[], prefix: string) {
	if (choices.length === 0) return [`${prefix} requires at least one choice.`];
	if (choices.length > FORM_DIALOG_MAX_CHOICES)
		return [`${prefix} supports at most ${FORM_DIALOG_MAX_CHOICES} choices.`];
	const errors: string[] = [];
	for (const [index, choice] of choices.entries()) {
		const keyError = validateFormDialogChoiceKey(choices, choice.id);
		const displayError = validateFormDialogChoiceDisplayValue(choices, choice.id);
		if (keyError) errors.push(`${prefix}, choice ${index + 1}: ${lowercaseFirst(keyError)}`);
		if (displayError) errors.push(`${prefix}, choice ${index + 1}: ${lowercaseFirst(displayError)}`);
		pushMaximumError(errors, choice.key.trim(), FORM_DIALOG_MAX_CHOICE_CHARS, `${prefix}, choice ${index + 1} key`);
		pushMaximumError(
			errors,
			choice.displayValue.trim(),
			FORM_DIALOG_MAX_CHOICE_CHARS,
			`${prefix}, choice ${index + 1} displayed value`,
		);
	}
	return errors;
}

function validateStaticSlider(errors: string[], field: FormDialogFieldRow, prefix: string) {
	if ([field.minimum, field.maximum, field.step, field.defaultValue].some((value) => value.includes("{{"))) return;
	const minimum = Number(field.minimum);
	const maximum = Number(field.maximum);
	const step = Number(field.step);
	const value = Number(field.defaultValue);
	if (![minimum, maximum, step, value].every(Number.isFinite)) {
		errors.push(`${prefix} slider values must be finite numbers.`);
		return;
	}
	if (maximum <= minimum) errors.push(`${prefix} slider maximum must be greater than minimum.`);
	if (step <= 0) errors.push(`${prefix} slider step must be greater than zero.`);
	if (value < minimum || value > maximum) errors.push(`${prefix} slider default value must be within its range.`);
}

function validateStaticNumber(errors: string[], value: string, minimum: number, maximum: number, label: string) {
	if (value.includes("{{")) return;
	const number = Number(value);
	if (!Number.isInteger(number) || number < minimum || number > maximum)
		errors.push(`${label} must be an integer from ${minimum} to ${maximum}.`);
}

function pushMaximumError(errors: string[], value: string, maximum: number, label: string) {
	if (Array.from(value).length > maximum) errors.push(`${label} must contain at most ${maximum} characters.`);
}

function lowercaseFirst(value: string) {
	return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
