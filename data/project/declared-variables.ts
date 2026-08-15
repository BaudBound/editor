import { validateVariableName } from "@/data/project/variables";
import type { DeclaredVariable, SecretDeclaration } from "@/lib/types";

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
