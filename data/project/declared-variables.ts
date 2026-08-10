import {
	runtimeIntegerContract,
	runtimeNumberContract,
	validateNumericConfigValue,
} from "@/data/nodes/numeric-validation";
import { type VariableType, validateVariableName, validateVariableValue } from "@/data/project/variables";
import type { DeclaredVariable, JsonValue, SecretDeclaration } from "@/lib/types";

export function formatDefaultValue(type: VariableType, value: JsonValue) {
	if (type === "string" || type === "color" || type === "hotkey") {
		return typeof value === "string" ? value : "";
	}
	if (type === "integer" || type === "float" || type === "boolean") {
		return String(value);
	}
	return JSON.stringify(value, null, 2);
}

export function parseDefaultValue(type: VariableType, rawValue: string): JsonValue | undefined {
	if (type === "string" || type === "color" || type === "hotkey") {
		return rawValue;
	}
	if (type === "integer" || type === "float") {
		const trimmed = rawValue.trim();
		const contract = type === "integer" ? runtimeIntegerContract : runtimeNumberContract;
		return trimmed && !validateNumericConfigValue(trimmed, contract) ? Number(trimmed) : undefined;
	}
	if (type === "boolean") {
		return rawValue === "true" ? true : rawValue === "false" ? false : undefined;
	}
	try {
		return JSON.parse(rawValue) as JsonValue;
	} catch {
		return undefined;
	}
}

export function defaultValueError(type: VariableType, rawValue: string) {
	if (!rawValue.trim()) {
		return "Default value is required.";
	}
	const parsed = parseDefaultValue(type, rawValue);
	if (parsed === undefined) {
		return type === "integer" || type === "float" ? "Enter a finite number." : "Enter valid JSON.";
	}
	const validation = validateVariableValue(type, formatDefaultValue(type, parsed));
	return validation || null;
}

export function validateDeclaredVariable(
	variable: DeclaredVariable,
	existing: DeclaredVariable[],
	secrets: SecretDeclaration[],
	originalName?: string,
) {
	const name = variable.name.trim();
	const nameError = validateVariableName(name);
	if (nameError) return nameError;
	if (existing.some((candidate) => candidate.name === name && candidate.name !== originalName)) {
		return `A declared variable named "${name}" already exists.`;
	}
	if (secrets.some((secret) => secret.name === name)) {
		return `A secret named "${name}" already exists.`;
	}
	return null;
}
