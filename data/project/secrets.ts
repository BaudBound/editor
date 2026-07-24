import { validateVariableName } from "@/data/project/variables";
import type { JsonValue, SecretDeclaration } from "@/lib/types";

export function validateSecretDeclaration(
	declaration: SecretDeclaration,
	existing: SecretDeclaration[],
	originalName?: string,
	reservedVariableNames: ReadonlySet<string> = new Set(),
) {
	const nameError = validateVariableName(declaration.name);
	if (nameError) {
		return nameError;
	}
	if (existing.some((secret) => secret.name === declaration.name && secret.name !== originalName)) {
		return `A secret named "${declaration.name}" already exists.`;
	}
	if (reservedVariableNames.has(declaration.name)) {
		return `A default variable named "${declaration.name}" already exists.`;
	}
	return null;
}

export function parseSecretSimulationValue(_type: "string", rawValue: string): JsonValue | undefined {
	if (rawValue === "") {
		return undefined;
	}
	return rawValue;
}

export function secretSimulationValueError(_type: "string", _rawValue: string) {
	return null;
}

export function createSimulationSecretValues(declarations: SecretDeclaration[], rawValues: Record<string, string>) {
	return Object.fromEntries(
		declarations.flatMap((declaration) => {
			const value = parseSecretSimulationValue(declaration.type, rawValues[declaration.name] ?? "");
			return value === undefined ? [] : [[declaration.name, value]];
		}),
	);
}

export function getSecretSimulationProblems(declarations: SecretDeclaration[], rawValues: Record<string, string>) {
	return declarations.flatMap((declaration) => {
		const rawValue = rawValues[declaration.name] ?? "";
		if (declaration.required && rawValue === "") {
			return [`Required simulation secret "${declaration.name}" has no value.`];
		}
		const error = secretSimulationValueError(declaration.type, rawValue);
		return error ? [`Simulation secret "${declaration.name}": ${error}`] : [];
	});
}
