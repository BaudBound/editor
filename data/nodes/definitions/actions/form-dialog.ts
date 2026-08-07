import { MessageSquareText } from "lucide-react";
import { formatTypedDatetimeForTemporalInput } from "@/data/project/datetime";
import type { VariableReferenceCandidate } from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import type { SimulationFormDialogField, SimulationSideEffect } from "@/utils/simulation-types";
import { colorValueToHex } from "../../color-match";
import { validateVariableInput } from "../../config-field-validation";
import {
	deriveFormDialogValueFields,
	FORM_DIALOG_MAX_CHOICE_CHARS,
	FORM_DIALOG_MAX_DEFAULT_CHARS,
	FORM_DIALOG_MAX_DESCRIPTION_CHARS,
	FORM_DIALOG_MAX_IMAGE_BYTES,
	FORM_DIALOG_MAX_LABEL_CHARS,
	FORM_DIALOG_MAX_PLACEHOLDER_CHARS,
	getFormDialogFields,
	isValidFormDialogTemporalDefault,
	sanitizeFormDialogFields,
	usesAccentColor,
	usesChoices,
	usesDefaultValue,
	usesPlaceholder,
	validateFormDialogFields,
} from "../../form-dialog-fields";
import { defineNode } from "../../node-definition";
import { runtimeNumberContract, validateNumericConfigValue } from "../../numeric-validation";
import { desktopDialogSizeOptions } from "../options";
import { fallible } from "../runtime-outputs";
import { configString, requiredConfig } from "../validators";
import { preserveDesktopDialogTimeout, resolveDesktopDialogTimeout } from "./desktop-dialog-timeout";

const MAX_TITLE_CHARS = 200;
const MAX_DIALOG_DESCRIPTION_CHARS = 16_384;
const dialogSizes = new Set(desktopDialogSizeOptions.map((option) => option.value));

export const formDialogNode = defineNode({
	actionType: "action.form_dialog",
	capabilities: ["action.form_dialog"],
	configFields: [
		{
			key: "title",
			label: "Window title",
			type: "text",
			usesVariables: true,
			variableTypes: "string",
			nonEmpty: true,
		},
		{
			key: "description",
			label: "Description",
			type: "textarea",
			usesVariables: true,
			variableTypes: "string",
			required: false,
		},
		{
			key: "dialogSize",
			label: "Window size",
			type: "select",
			options: desktopDialogSizeOptions,
		},
		{
			key: "fields",
			label: "Form components",
			type: "form-field-list",
			required: true,
			validate: (config) => validateFormDialogFields(config.fields)[0] ?? "",
		},
		{
			key: "timeoutSeconds",
			label: "Timeout (seconds)",
			type: "number",
			numeric: {
				kind: "float",
				signed: false,
				minimum: "0",
				maximum: "86400",
				minimumInclusive: false,
				maximumInclusive: true,
			},
			usesVariables: true,
			variableTypes: "float",
			required: false,
		},
	],
	defaultConfig: () => ({
		title: "",
		description: "",
		dialogSize: "medium",
		fields: [],
		timeoutSeconds: "",
	}),
	deriveRuntimeOutputs: (config) =>
		fallible([
			{
				name: "values",
				type: "object",
				description: "Submitted form values keyed by the configured component keys.",
				fields: deriveFormDialogValueFields(config.fields),
			},
			{ name: "submitted", type: "boolean", description: "Whether the user submitted the form." },
			{ name: "button", type: "string", description: "Dialog result: ok, cancel, or timeout." },
		]),
	description: "Show a typed form in a separate desktop window and return the submitted values.",
	desktopOnly: true,
	fallible: true,
	group: "actions",
	icon: MessageSquareText,
	kind: "action",
	label: "Form Dialog",
	permission: { name: "formDialog.show", risk: "medium" },
	risk: "medium",
	runnerType: "form_dialog",
	sanitizeConfig: sanitizeFormDialogConfig,
	supportedTargetRuntimes: ["Windows Desktop", "Linux Desktop"],
	validateConfig: validateFormDialogConfig,
	validateVariables: validateFormDialogVariableInputs,
	validateGraph: ({ context, node }) => {
		const imageAssets = new Map(
			context.assets.filter((asset) => asset.kind === "image").map((asset) => [asset.packagePath.toLowerCase(), asset]),
		);
		return getFormDialogFields(node.data.config.fields).flatMap((field, index) => {
			if (field.type !== "image") return [];
			const asset = imageAssets.get(field.assetPath.toLowerCase());
			if (!asset) return [`${node.id} form component ${index + 1} references a missing or non-image asset.`];
			return asset.size > FORM_DIALOG_MAX_IMAGE_BYTES
				? [`${node.id} form component ${index + 1} image asset must be 8 MiB or smaller.`]
				: [];
		});
	},
	simulation: {
		createOutput: ({ api, context, node }) => {
			const resolved = resolveSimulationFormDialog(api, context, node);
			return typeof resolved === "string"
				? {
						failed: true,
						outputData: { error: api.createError(resolved, "FORM_DIALOG_INVALID", "validation") },
					}
				: { failed: false, outputData: {} as Record<string, JsonValue> };
		},
		describe: ({ api, context, failed, node }) => [
			{
				level: failed ? "error" : "info",
				message: failed
					? `[Simulation] Form Dialog (${node.id}) failed validation.`
					: `[Simulation] Form Dialog (${node.id}) opened a form titled "${String(
							api.resolveTemplate(api.getConfigString(node, "title"), context),
						)}".`,
			},
		],
		sideEffects: ({ api, context, node }) => {
			const resolved = resolveSimulationFormDialog(api, context, node);
			return typeof resolved === "string" ? [] : [resolved];
		},
		afterExecute: ({ context, node, sideEffectResults }) => {
			const result = sideEffectResults.find((entry) => entry.type === "form_dialog" && entry.nodeId === node.id);
			if (!result || result.type !== "form_dialog") return [];
			context.nodeOutputs[node.id] = {
				values: result.values,
				submitted: result.submitted,
				button: result.button,
			};
			if (result.submitted) {
				for (const field of getFormDialogFields(node.data.config.fields)) {
					if (field.type !== "password") continue;
					const value = result.values[field.key.trim()];
					if (typeof value === "string" && value && !context.secretValues.includes(value)) {
						context.secretValues.push(value);
					}
				}
			}
			return [
				{
					level: "info",
					message: `[Simulation] Form Dialog (${node.id}) returned "${result.button}".`,
				},
			];
		},
	},
});

type SimulationApi = Parameters<NonNullable<NonNullable<typeof formDialogNode.simulation>["sideEffects"]>>[0]["api"];
type SimulationContext = Parameters<
	NonNullable<NonNullable<typeof formDialogNode.simulation>["sideEffects"]>
>[0]["context"];
type SimulationNode = Parameters<NonNullable<NonNullable<typeof formDialogNode.simulation>["sideEffects"]>>[0]["node"];

function resolveSimulationFormDialog(
	api: SimulationApi,
	context: SimulationContext,
	node: SimulationNode,
): Extract<SimulationSideEffect, { type: "form_dialog" }> | string {
	const title = resolveText(api, context, api.getConfigString(node, "title"), "window title");
	if (typeof title !== "string") return title.error;
	if (!title.trim()) return "Window title must not resolve to empty text.";
	const titleLengthError = validateMaximum(title, MAX_TITLE_CHARS, "window title");
	if (titleLengthError) return titleLengthError;
	const description = resolveText(api, context, api.getConfigString(node, "description"), "description");
	if (typeof description !== "string") return description.error;
	const descriptionLengthError = validateMaximum(description, MAX_DIALOG_DESCRIPTION_CHARS, "description");
	if (descriptionLengthError) return descriptionLengthError;
	const timeout = resolveDesktopDialogTimeout(node.data.config.timeoutSeconds, (template) =>
		api.resolveTemplate(template, context),
	);
	if (typeof timeout === "string") return timeout;
	const fields = resolveSimulationFields(api, context, node.data.config.fields);
	if (typeof fields === "string") return fields;
	const dialogSize = configString(node.data.config, "dialogSize");
	if (!isDialogSize(dialogSize)) return "Window size must be Small, Medium, or Large.";
	return {
		type: "form_dialog",
		nodeId: node.id,
		title,
		description,
		dialogSize,
		fields,
		...(timeout === undefined ? {} : { timeoutSeconds: timeout }),
	};
}

function resolveSimulationFields(
	api: SimulationApi,
	context: SimulationContext,
	value: JsonValue | undefined,
): SimulationFormDialogField[] | string {
	const configurationError = validateFormDialogFields(value)[0];
	if (configurationError) return configurationError;
	const sourceFields = getFormDialogFields(value);
	const resolved: SimulationFormDialogField[] = [];
	for (const [index, field] of sourceFields.entries()) {
		const prefix = `component ${index + 1}`;
		const label = resolveText(api, context, field.label, `${prefix} label`);
		if (typeof label !== "string") return label.error;
		const description = resolveText(api, context, field.description, `${prefix} description`);
		if (typeof description !== "string") return description.error;
		const labelLengthError = validateMaximum(label, FORM_DIALOG_MAX_LABEL_CHARS, `${prefix} label`);
		if (labelLengthError) return labelLengthError;
		const descriptionLengthError = validateMaximum(
			description,
			FORM_DIALOG_MAX_DESCRIPTION_CHARS,
			`${prefix} description`,
		);
		if (descriptionLengthError) return descriptionLengthError;
		if (field.type === "information" || field.type === "section_heading") {
			if (!label.trim() && !description.trim()) return `${prefix} requires a label or description.`;
			const accentColorValue = api.resolveTemplate(field.accentColor, context);
			const accentColor = colorValueToHex(accentColorValue);
			if (!accentColor) return `${prefix} accent color must resolve to a supported color.`;
			resolved.push({ accentColor, description, label, type: field.type });
			continue;
		}
		if (field.type === "divider") {
			const accentColorValue = api.resolveTemplate(field.accentColor, context);
			const accentColor = colorValueToHex(accentColorValue);
			if (!accentColor) return `${prefix} accent color must resolve to a supported color.`;
			resolved.push({ accentColor, type: "divider" });
			continue;
		}
		if (field.type === "image") {
			const asset = context.assetsByPackagePath.get(field.assetPath.toLowerCase());
			if (!asset || asset.kind !== "image") return `${prefix} must reference an image asset in this project.`;
			const imageHeight = resolveFiniteNumber(api, context, field.imageHeight);
			if (imageHeight === null || !Number.isInteger(imageHeight) || imageHeight < 80 || imageHeight > 600) {
				return `${prefix} image height must resolve to an integer from 80 to 600.`;
			}
			resolved.push({
				assetPath: asset.packagePath,
				description,
				imageFit: field.imageFit,
				imageHeight,
				label,
				type: "image",
			});
			continue;
		}
		if (!label.trim()) return `${prefix} label must not resolve to empty text.`;
		const common = {
			description,
			key: field.key.trim(),
			label,
			required: field.required,
		};
		if (field.type === "checkbox") {
			resolved.push({ ...common, defaultChecked: field.defaultChecked, type: "checkbox" });
			continue;
		}
		if (usesChoices(field.type)) {
			const choices: { displayValue: string; key: string }[] = [];
			for (const [choiceIndex, choice] of field.choices.entries()) {
				const displayValue = resolveText(
					api,
					context,
					choice.displayValue,
					`${prefix}, choice ${choiceIndex + 1} displayed value`,
				);
				if (typeof displayValue !== "string") return displayValue.error;
				const normalizedKey = choice.key;
				const normalizedDisplayValue = displayValue.trim();
				if (!normalizedKey) return `${prefix}, choice ${choiceIndex + 1} key must not resolve to empty text.`;
				if (!normalizedDisplayValue) {
					return `${prefix}, choice ${choiceIndex + 1} displayed value must not resolve to empty text.`;
				}
				const keyLengthError = validateMaximum(
					normalizedKey,
					FORM_DIALOG_MAX_CHOICE_CHARS,
					`${prefix}, choice ${choiceIndex + 1} key`,
				);
				if (keyLengthError) return keyLengthError;
				const displayLengthError = validateMaximum(
					normalizedDisplayValue,
					FORM_DIALOG_MAX_CHOICE_CHARS,
					`${prefix}, choice ${choiceIndex + 1} displayed value`,
				);
				if (displayLengthError) return displayLengthError;
				choices.push({ key: normalizedKey, displayValue: normalizedDisplayValue });
			}
			const duplicateKey = findDuplicate(choices.map((choice) => choice.key));
			if (duplicateKey) return `${prefix} choice keys must be unique; duplicate "${duplicateKey}".`;
			const duplicateLabel = findDuplicate(choices.map((choice) => choice.displayValue));
			if (duplicateLabel) {
				return `${prefix} displayed values must be unique; duplicate "${duplicateLabel}".`;
			}
			resolved.push({ ...common, choices, type: field.type });
			continue;
		}
		if (field.type === "file" || field.type === "folder") {
			resolved.push({ ...common, ...(field.type === "file" ? { multiple: field.multiple } : {}), type: field.type });
			continue;
		}
		const resolvedDefault = api.resolveTemplate(field.defaultValue, context);
		if (field.type === "color") {
			const defaultValue = colorValueToHex(resolvedDefault);
			if (!defaultValue) return `${prefix} default color must resolve to a supported color.`;
			resolved.push({ ...common, defaultValue, type: "color" });
			continue;
		}
		if (field.type === "date" || field.type === "time" || field.type === "datetime") {
			const defaultValue =
				typeof resolvedDefault === "string"
					? resolvedDefault
					: formatTypedDatetimeForTemporalInput(resolvedDefault, field.type, field.timezone);
			if (defaultValue === null) {
				return `${prefix} default value must resolve to text or a valid datetime.`;
			}
			if (defaultValue && !isValidFormDialogTemporalDefault(field.type, defaultValue)) {
				return `${prefix} default value is not a valid ${field.type === "datetime" ? "date and time" : field.type}.`;
			}
			resolved.push({
				...common,
				defaultValue,
				...(field.type === "datetime" ? { timezone: field.timezone } : {}),
				type: field.type,
			});
			continue;
		}
		if (field.type === "slider") {
			const minimum = resolveFiniteNumber(api, context, field.minimum);
			const maximum = resolveFiniteNumber(api, context, field.maximum);
			const step = resolveFiniteNumber(api, context, field.step);
			const defaultValue = resolveFiniteNumber(api, context, field.defaultValue);
			if (minimum === null || maximum === null || step === null || defaultValue === null)
				return `${prefix} slider values must resolve to finite numbers.`;
			if (maximum <= minimum) return `${prefix} slider maximum must be greater than minimum.`;
			if (step <= 0) return `${prefix} slider step must be greater than zero.`;
			if (defaultValue < minimum || defaultValue > maximum)
				return `${prefix} slider default value must be within its range.`;
			resolved.push({ ...common, defaultValue, maximum, minimum, step, type: "slider" });
			continue;
		}
		const placeholder = resolveText(api, context, field.placeholder, `${prefix} placeholder`);
		if (typeof placeholder !== "string") return placeholder.error;
		const placeholderLengthError = validateMaximum(
			placeholder,
			FORM_DIALOG_MAX_PLACEHOLDER_CHARS,
			`${prefix} placeholder`,
		);
		if (placeholderLengthError) return placeholderLengthError;
		if (field.type === "password") {
			resolved.push({ ...common, placeholder, type: "password" });
			continue;
		}
		const defaultValue = api.resolveTemplate(field.defaultValue, context);
		if (field.type === "number") {
			const numberText = typeof defaultValue === "number" ? String(defaultValue) : defaultValue;
			if (
				typeof numberText !== "string" ||
				(numberText.trim() && validateNumericConfigValue(numberText, runtimeNumberContract))
			) {
				return `${prefix} default value must resolve to a supported finite number.`;
			}
			resolved.push({
				...common,
				defaultValue: numberText.trim() ? Number(numberText) : "",
				placeholder,
				type: "number",
			});
			continue;
		}
		if (typeof defaultValue !== "string") return `${prefix} default value must resolve to text.`;
		const defaultLengthError = validateMaximum(defaultValue, FORM_DIALOG_MAX_DEFAULT_CHARS, `${prefix} default value`);
		if (defaultLengthError) return defaultLengthError;
		resolved.push({ ...common, defaultValue, placeholder, type: field.type });
	}
	return resolved;
}

function resolveFiniteNumber(api: SimulationApi, context: SimulationContext, value: string) {
	const resolved = api.resolveTemplate(value, context);
	const number = typeof resolved === "number" ? resolved : typeof resolved === "string" ? Number(resolved) : Number.NaN;
	return Number.isFinite(number) ? number : null;
}

function sanitizeFormDialogConfig(config: Record<string, JsonValue>) {
	return preserveDesktopDialogTimeout(config, {
		title: configString(config, "title"),
		description: configString(config, "description"),
		dialogSize: configString(config, "dialogSize"),
		fields: sanitizeFormDialogFields(config.fields),
		...(typeof config.customName === "string" ? { customName: config.customName } : {}),
	});
}

function validateFormDialogConfig(config: Record<string, JsonValue>) {
	return [
		requiredConfig(config, "title", "form dialog title"),
		isDialogSize(configString(config, "dialogSize")) ? "" : "Window size must be Small, Medium, or Large.",
		validateMaximum(configString(config, "title"), MAX_TITLE_CHARS, "form dialog title"),
		validateMaximum(configString(config, "description"), MAX_DIALOG_DESCRIPTION_CHARS, "form dialog description"),
		...validateFormDialogFields(config.fields),
	].filter(Boolean);
}

function validateFormDialogVariableInputs(
	config: Record<string, JsonValue>,
	variables: readonly VariableReferenceCandidate[],
) {
	return getFormDialogFields(config.fields).flatMap((field, index) => {
		const prefix = `component ${index + 1}`;
		const inputs: Array<[string, string, "color" | "datetime" | "float" | "integer" | "string"]> = [
			["label", field.label, "string"],
			["description", field.description, "string"],
		];
		if (usesAccentColor(field.type)) inputs.push(["accent color", field.accentColor, "color"]);
		if (usesPlaceholder(field.type)) inputs.push(["placeholder", field.placeholder, "string"]);
		if (field.type === "image") inputs.push(["image height", field.imageHeight, "integer"]);
		if (usesChoices(field.type)) {
			for (const [choiceIndex, choice] of field.choices.entries()) {
				inputs.push([`choice ${choiceIndex + 1} displayed value`, choice.displayValue, "string"]);
			}
		}
		if (field.type === "number") inputs.push(["default value", field.defaultValue, "float"]);
		else if (field.type === "color") inputs.push(["default color", field.defaultValue, "color"]);
		else if (field.type === "date" || field.type === "time" || field.type === "datetime") {
			inputs.push(["default value", field.defaultValue, "datetime"]);
		} else if (field.type === "slider") {
			inputs.push(["minimum", field.minimum, "float"]);
			inputs.push(["maximum", field.maximum, "float"]);
			inputs.push(["step", field.step, "float"]);
			inputs.push(["default value", field.defaultValue, "float"]);
		} else if (usesDefaultValue(field.type)) inputs.push(["default value", field.defaultValue, "string"]);

		return inputs.flatMap(([label, value, contract]) => {
			const error = validateVariableInput(value, variables, contract);
			if (error) return [`${prefix} ${label}: ${error}`];
			if (contract === "datetime" && value.includes("{{") && !/^\{\{\s*[^{}]+?\s*}}$/.test(value)) {
				return [`${prefix} ${label}: a datetime variable must be the entire value.`];
			}
			return [];
		});
	});
}

function isDialogSize(value: string): value is "large" | "medium" | "small" {
	return dialogSizes.has(value);
}

function resolveText(api: SimulationApi, context: SimulationContext, value: string, label: string) {
	const resolved = api.resolveTemplate(value, context);
	return typeof resolved === "string" ? resolved : { error: `${label} must resolve to text.` };
}

function findDuplicate(values: string[]) {
	const seen = new Set<string>();
	for (const value of values) {
		if (value && seen.has(value)) return value;
		seen.add(value);
	}
	return "";
}

function validateMaximum(value: string, maximum: number, label: string) {
	return Array.from(value).length <= maximum ? "" : `${label} must contain at most ${maximum} characters.`;
}
