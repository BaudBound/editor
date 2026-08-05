import type { VariableReferenceCandidate } from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import { validateVariableInput } from "./config-field-validation";
import { isSwitchCaseRow, type SwitchCaseRow } from "./definitions/rows";

export function validateSwitchConfig(config: Record<string, JsonValue>) {
	const errors: string[] = [];
	if (typeof config.value !== "string" || !config.value.trim()) {
		errors.push("must define a switch value.");
	}

	const rawCases = config.cases;
	if (!Array.isArray(rawCases) || rawCases.length === 0) {
		errors.push("must define at least one switch case.");
		return errors;
	}

	const cases = rawCases.filter(isSwitchCaseRow);
	if (cases.length !== rawCases.length) {
		errors.push("contains an invalid switch case.");
	}

	const duplicateIds = duplicateValues(cases.map((switchCase) => switchCase.id));
	if (duplicateIds.size > 0) {
		errors.push("contains duplicate switch case identifiers.");
	}

	for (const [index, switchCase] of cases.entries()) {
		const nameError = validateSwitchCaseName(cases, switchCase.id);
		const valueError = validateSwitchCaseValue(cases, switchCase.id);
		if (nameError) {
			errors.push(`case ${index + 1}: ${lowercaseFirst(nameError)}`);
		}
		if (valueError) {
			errors.push(`case ${index + 1}: ${lowercaseFirst(valueError)}`);
		}
	}

	return errors;
}

export function validateSwitchVariableInputs(
	config: Record<string, JsonValue>,
	variables: readonly VariableReferenceCandidate[],
) {
	const inputs: Array<[string, string]> = [["switch value", typeof config.value === "string" ? config.value : ""]];
	if (Array.isArray(config.cases)) {
		for (const [index, value] of config.cases.entries()) {
			if (isSwitchCaseRow(value)) inputs.push([`case ${index + 1} value`, value.value]);
		}
	}
	return inputs.flatMap(([label, input]) => {
		const error = validateVariableInput(input, variables, "any");
		return error ? [`${label}: ${error}`] : [];
	});
}

export function validateSwitchCaseName(cases: SwitchCaseRow[], caseId: string) {
	const switchCase = cases.find((candidate) => candidate.id === caseId);
	if (!switchCase?.name.trim()) {
		return "Name is required.";
	}

	const normalizedName = switchCase.name.trim().toLowerCase();
	const duplicate = cases.some(
		(candidate) => candidate.id !== caseId && candidate.name.trim().toLowerCase() === normalizedName,
	);
	return duplicate ? "Name must be unique." : "";
}

export function validateSwitchCaseValue(cases: SwitchCaseRow[], caseId: string) {
	const switchCase = cases.find((candidate) => candidate.id === caseId);
	if (!switchCase?.value.trim()) {
		return "Value is required.";
	}

	const normalizedValue = switchCase.value.trim();
	const duplicate = cases.some((candidate) => candidate.id !== caseId && candidate.value.trim() === normalizedValue);
	return duplicate ? "Value must be unique." : "";
}

function duplicateValues(values: string[]) {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			duplicates.add(value);
		}
		seen.add(value);
	}
	return duplicates;
}

function lowercaseFirst(value: string) {
	return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}
