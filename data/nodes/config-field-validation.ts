import { validateUserIdentifier } from "@/data/project/user-identifier";
import type { VariableReferenceCandidate, VariableType } from "@/data/project/variables";
import { getVariableReferenceStatus, variableTypes } from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import { validateStaticColor } from "./color-match";
import { getFormDialogFields } from "./form-dialog-fields";
import { configVisibilityConditionMatches, type NodeConfigField, type VariableInputContract } from "./node-definition";
import { numericContractApplies, validateNumericConfigValue } from "./numeric-validation";

const TEMPLATE_PATTERN = /\{\{([^{}]*)}}/g;

export function validateConfigField(
	field: NodeConfigField,
	config: Record<string, JsonValue>,
	variables: readonly VariableReferenceCandidate[] = [],
) {
	if (!configVisibilityConditionMatches(field.visibleWhen, config)) {
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

	if (field.identifier) {
		if (typeof value !== "string") {
			return `${field.label} must be text.`;
		}
		const identifierError = validateUserIdentifier(value, field.label);
		if (identifierError) {
			return identifierError;
		}
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
	const values = getVariableAwareStrings(value);
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
		return field.numeric?.kind === "integer" ? "integer" : "float";
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
	return variables.filter((variable) => isVariableTypeCompatible(variable.type, contract));
}

// Matching is exact. There is no subtyping, so a color is not usable where a
// string is required. Moving between types is done with an explicit cast.
export function isVariableTypeCompatible(type: VariableReferenceCandidate["type"], contract: VariableInputContract) {
	return contract === "any" || type === contract;
}

/**
 * Splits a template expression into its reference and optional cast target.
 *
 * The split happens outside quote context so a pipe inside a quoted accessor,
 * as in node["a|b"], stays part of the key. Mirrors split_cast in the runner.
 */
export function splitCast(expression: string): { reference: string; target: string | null } {
	let quote: string | null = null;
	let escaped = false;
	let separator = -1;

	for (let index = 0; index < expression.length; index += 1) {
		const character = expression[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" && quote) {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "|") separator = index;
	}

	if (separator < 0) return { reference: expression.trim(), target: null };
	return {
		reference: expression.slice(0, separator).trim(),
		target: expression.slice(separator + 1).trim(),
	};
}

export function validateVariableReferenceTypes(
	value: string,
	variables: readonly VariableReferenceCandidate[],
	contract: VariableInputContract,
) {
	for (const match of value.matchAll(TEMPLATE_PATTERN)) {
		const { reference, target } = splitCast(match[1]?.trim() ?? "");

		if (target !== null) {
			if (!(variableTypes as readonly string[]).includes(target)) {
				return `Unknown cast target "${target}". Use one of ${variableTypes.join(", ")}.`;
			}
			if (!isVariableTypeCompatible(target as VariableType, contract)) {
				return `This field accepts ${formatVariableInputContract(contract)} variables, but the cast produces ${target}.`;
			}
			// The cast decides the type, so the variable's own type is not checked.
			continue;
		}

		const variable = variables.find((candidate) => candidate.name === reference);
		if (variable && !isVariableTypeCompatible(variable.type, contract)) {
			return `Variable "${reference}" has type ${variable.type}; this field accepts ${formatVariableInputContract(contract)} variables. Add a cast such as {{${reference}|${contract}}} to convert it.`;
		}
		if (!variable && contract !== "any" && getVariableReferenceStatus(reference, variables) === "possible") {
			return `Variable "${reference}" has an unknown type; this field accepts ${formatVariableInputContract(contract)} variables. Use a declared typed variable or output.`;
		}
	}

	return "";
}

export function validateVariableInput(
	value: string,
	variables: readonly VariableReferenceCandidate[],
	contract: VariableInputContract,
) {
	return validateVariableReferences(value, variables) || validateVariableReferenceTypes(value, variables, contract);
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
	if (field.type === "form-field-list") {
		return Array.isArray(value) && getFormDialogFields(value).length === value.length
			? ""
			: `${field.label} must be a list of valid form components.`;
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

function getVariableAwareStrings(value: JsonValue) {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [String(value)];
}

function isEmptyValue(value: JsonValue) {
	return typeof value === "string" ? !value.trim() : false;
}

function isFullTemplateReference(value: string) {
	return /^\{\{\s*[^{}]+\s*}}$/.test(value);
}

export function formatVariableInputContract(contract: VariableInputContract) {
	return contract.replace("-", " ");
}

function sentence(value: string) {
	return /[.!?]$/.test(value) ? value : `${value}.`;
}
