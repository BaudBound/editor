import type { VariableReferenceCandidate } from "@/data/project/variables";
import { getVariableReferenceStatus } from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import { validateStaticColor } from "./color-match";
import type { NodeConfigField, VariableInputContract } from "./node-definition";
import { numericContractApplies, validateNumericConfigValue } from "./numeric-validation";

const TEMPLATE_PATTERN = /\{\{([^{}]*)}}/g;
const compatibleTypes: Record<VariableInputContract, ReadonlySet<string> | undefined> = {
	any: undefined,
	boolean: new Set(["boolean"]),
	color: new Set(["color"]),
	datetime: new Set(["datetime"]),
	duration: new Set(["duration"]),
	"file-path": new Set(["file_path", "string"]),
	"keyboard-key": new Set(["keyboard_key"]),
	list: new Set(["list"]),
	numeric: new Set(["number", "http_status_code", "duration_ms", "process_id", "exit_code"]),
	object: new Set(["object", "http_headers"]),
	string: new Set(["string", "file_content", "file_path", "keyboard_key", "color"]),
	text: undefined,
};

export function validateConfigField(
	field: NodeConfigField,
	config: Record<string, JsonValue>,
	variables: readonly VariableReferenceCandidate[] = [],
) {
	if (field.visibleWhen && config[field.visibleWhen.key] !== field.visibleWhen.equals) {
		return "";
	}

	const value = config[field.key];
	if (value === undefined || value === null) {
		return field.required === false ? "" : `${field.label} is required.`;
	}
	if (isEmptyValue(value)) {
		if (field.required === false) {
			return "";
		}
		if (field.type === "number" || field.colorPicker || field.nonEmpty) {
			return `${field.label} is required.`;
		}
		return field.validate?.(config) ?? "";
	}

	const typeError = validateFieldType(field, value);
	if (typeError) {
		return typeError;
	}

	if (numericContractApplies(field, config)) {
		if (!field.numeric) {
			return `${field.label} is missing its numeric validation contract.`;
		}
		const text = typeof value === "string" ? value.trim() : "";
		if (!(field.usesVariables && isFullTemplateReference(text))) {
			const numericError = validateNumericConfigValue(value, field.numeric);
			if (numericError) {
				return numericError;
			}
		}
	}

	if (field.colorPicker) {
		const colorError = validateStaticColor(value, field.label.toLowerCase());
		if (colorError) {
			return sentence(colorError);
		}
	}

	const domainError = field.validate?.(config);
	if (domainError) {
		return domainError;
	}

	if (!field.usesVariables) {
		return "";
	}

	const variableContract = getEffectiveVariableContract(field, config);
	const values = Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [String(value)];
	for (const candidate of values) {
		const variableError =
			validateVariableReferences(candidate, variables) ||
			validateVariableReferenceTypes(candidate, variables, variableContract);
		if (variableError) {
			return variableError;
		}
	}

	return "";
}

export function getEffectiveVariableContract(field: NodeConfigField, config: Record<string, JsonValue>) {
	if (!field.usesVariables) {
		return "any";
	}
	if (numericContractApplies(field, config)) {
		return "numeric";
	}
	if (field.colorPicker) {
		return "color";
	}
	return field.variableTypes;
}

export function filterCompatibleVariables<TVariable extends VariableReferenceCandidate>(
	variables: readonly TVariable[],
	contract: VariableInputContract,
) {
	const allowedTypes = compatibleTypes[contract];
	return allowedTypes ? variables.filter((variable) => allowedTypes.has(variable.type)) : [...variables];
}

export function validateVariableReferenceTypes(
	value: string,
	variables: readonly VariableReferenceCandidate[],
	contract: VariableInputContract,
) {
	const allowedTypes = compatibleTypes[contract];
	if (!allowedTypes) {
		return "";
	}

	for (const match of value.matchAll(TEMPLATE_PATTERN)) {
		const reference = match[1]?.trim() ?? "";
		const variable = variables.find((candidate) => candidate.name === reference);
		if (variable && !allowedTypes.has(variable.type)) {
			return `Variable "${reference}" has type ${variable.type}; this field accepts ${formatContract(contract)} variables.`;
		}
	}

	return "";
}

export function validateVariableReferences(value: string, variables: readonly VariableReferenceCandidate[]) {
	const matches = [...value.matchAll(TEMPLATE_PATTERN)];
	const remainder = value.replace(TEMPLATE_PATTERN, "");
	if (remainder.includes("{{")) {
		return "Variable reference syntax is incomplete.";
	}

	for (const match of matches) {
		const reference = match[1]?.trim() ?? "";
		if (!reference) {
			return "Variable reference cannot be empty.";
		}
		if (getVariableReferenceStatus(reference, variables) === "invalid") {
			return `Variable "${reference}" is not available here.`;
		}
	}

	return "";
}

function validateFieldType(field: NodeConfigField, value: JsonValue) {
	if (field.type === "switch") {
		return typeof value === "boolean" ? "" : `${field.label} must be enabled or disabled.`;
	}
	if (field.type === "string-list") {
		return Array.isArray(value) && value.every((item) => typeof item === "string")
			? ""
			: `${field.label} must be a list of text values.`;
	}
	if (field.type === "select") {
		if (typeof value !== "string") {
			return `${field.label} must be selected.`;
		}
		return field.options?.some((option) => option.value === value)
			? ""
			: `${field.label} must be one of the available options.`;
	}
	if (field.type === "text" || field.type === "textarea" || field.type === "number") {
		return typeof value === "string" || typeof value === "number" ? "" : `${field.label} must be text.`;
	}
	return "";
}

function isEmptyValue(value: JsonValue) {
	return typeof value === "string" ? !value.trim() : false;
}

function isFullTemplateReference(value: string) {
	return /^\{\{\s*[^{}]+\s*}}$/.test(value);
}

function formatContract(contract: VariableInputContract) {
	return contract.replace("-", " ");
}

function sentence(value: string) {
	return /[.!?]$/.test(value) ? value : `${value}.`;
}
