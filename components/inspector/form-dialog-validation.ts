import { getNumericDraftError } from "@/components/common/numeric-field-model";
import type { VariableCompletion } from "@/components/common/variable-code-input";
import { validateStaticColor } from "@/data/nodes/color-match";
import { validateVariableReferences, validateVariableReferenceTypes } from "@/data/nodes/config-field-validation";
import {
	FORM_DIALOG_MAX_IMAGE_BYTES,
	type FormDialogFieldRow,
	isValidFormDialogTemporalDefault,
	usesAccentColor,
	usesChoices,
	usesDefaultValue,
	usesPlaceholder,
	validateFormDialogFields,
} from "@/data/nodes/form-dialog-fields";
import { runtimeIntegerContract, runtimeNumberContract } from "@/data/nodes/numeric-validation";
import type { EditorAsset } from "@/lib/types";

export type FormDialogIssue = {
	fieldId?: string;
	message: string;
};

export function getFormDialogIssues(
	fields: FormDialogFieldRow[],
	variables: readonly VariableCompletion[],
	assets: readonly EditorAsset[] = [],
): FormDialogIssue[] {
	const issues: FormDialogIssue[] = validateFormDialogFields(fields).map((message) => ({
		fieldId: fieldIdFromValidationMessage(message, fields),
		message,
	}));

	for (const field of fields) {
		pushTextVariableIssue(issues, field.id, "Label", field.label, variables);
		pushTextVariableIssue(issues, field.id, "Description", field.description, variables);
		if (usesAccentColor(field.type)) {
			pushColorIssue(issues, field.id, field.accentColor, variables);
		}
		if (usesPlaceholder(field.type)) {
			pushTextVariableIssue(issues, field.id, "Placeholder", field.placeholder, variables);
		}
		if (
			usesDefaultValue(field.type) &&
			!["number", "slider", "color", "date", "time", "datetime"].includes(field.type)
		) {
			pushTextVariableIssue(issues, field.id, "Default value", field.defaultValue, variables);
		}
		if (
			(field.type === "date" || field.type === "time" || field.type === "datetime") &&
			field.defaultValue.includes("{")
		) {
			const error = validateFormDialogTemporalValue(field.type, field.defaultValue, variables);
			if (error) issues.push({ fieldId: field.id, message: `Default value: ${lowercaseFirst(error)}` });
		}
		if (field.type === "number") {
			pushNumericIssue(issues, field, variables);
		}
		if (field.type === "color") pushColorIssue(issues, field.id, field.defaultValue, variables, "Default color");
		if (field.type === "slider") {
			for (const [label, value] of [
				["Minimum", field.minimum],
				["Maximum", field.maximum],
				["Step", field.step],
				["Default value", field.defaultValue],
			] as const) {
				const error = validateFormDialogNumericValue(value, variables);
				if (error) issues.push({ fieldId: field.id, message: `${label}: ${lowercaseFirst(error)}` });
			}
		}
		if (field.type === "image") {
			const asset = assets.find((candidate) => candidate.packagePath === field.assetPath && candidate.kind === "image");
			if (!asset) issues.push({ fieldId: field.id, message: "Image asset: select an image asset from this project." });
			else if (asset.size > FORM_DIALOG_MAX_IMAGE_BYTES)
				issues.push({ fieldId: field.id, message: "Image asset must be 8 MiB or smaller." });
			const error = validateFormDialogNumericValue(field.imageHeight, variables, "integer");
			if (error) issues.push({ fieldId: field.id, message: `Image height: ${lowercaseFirst(error)}` });
		}
		if (usesChoices(field.type)) {
			for (const [index, choice] of field.choices.entries()) {
				pushTextVariableIssue(issues, field.id, `Choice ${index + 1} key`, choice.key, variables);
				pushTextVariableIssue(issues, field.id, `Choice ${index + 1} displayed value`, choice.displayValue, variables);
			}
		}
	}

	return deduplicateIssues(issues);
}

export function getFormDialogFieldIssues(issues: FormDialogIssue[], fieldId: string) {
	return issues.filter((issue) => issue.fieldId === fieldId);
}

export function validateFormDialogTextVariables(value: string, variables: readonly VariableCompletion[]) {
	return validateVariableReferences(value, variables) || validateVariableReferenceTypes(value, variables, "string");
}

export function validateFormDialogNumericValue(
	value: string,
	variables: readonly VariableCompletion[],
	kind: "float" | "integer" = "float",
) {
	const contract = kind === "integer" ? runtimeIntegerContract : runtimeNumberContract;
	return (
		validateVariableReferences(value, variables) ||
		validateVariableReferenceTypes(value, variables, kind) ||
		getNumericDraftError(value, contract, true, false)
	);
}

export function validateFormDialogColorValue(value: string, variables: readonly VariableCompletion[]) {
	return (
		validateVariableReferences(value, variables) ||
		validateVariableReferenceTypes(value, variables, "color") ||
		validateStaticColor(value, "accent color")
	);
}

export function validateFormDialogTemporalValue(
	type: "date" | "datetime" | "time",
	value: string,
	variables: readonly VariableCompletion[],
) {
	const variableError =
		validateVariableReferences(value, variables) || validateVariableReferenceTypes(value, variables, "datetime");
	if (variableError) return variableError;
	if (/\{\{/.test(value) && !/^\{\{\s*[^{}]+?\s*}}$/.test(value)) {
		return "A datetime variable must be the entire default value.";
	}
	if (!value || value.includes("{{") || isValidFormDialogTemporalDefault(type, value)) return "";
	return `Enter a valid ${type === "datetime" ? "date and time" : type}.`;
}

function pushTextVariableIssue(
	issues: FormDialogIssue[],
	fieldId: string,
	label: string,
	value: string,
	variables: readonly VariableCompletion[],
) {
	const error = validateFormDialogTextVariables(value, variables);
	if (error) issues.push({ fieldId, message: `${label}: ${lowercaseFirst(error)}` });
}

function pushNumericIssue(
	issues: FormDialogIssue[],
	field: FormDialogFieldRow,
	variables: readonly VariableCompletion[],
) {
	const error = validateFormDialogNumericValue(field.defaultValue, variables, field.numberType);
	if (error) issues.push({ fieldId: field.id, message: `Default value: ${lowercaseFirst(error)}` });
}

function pushColorIssue(
	issues: FormDialogIssue[],
	fieldId: string,
	value: string,
	variables: readonly VariableCompletion[],
	label = "Accent color",
) {
	const error =
		validateVariableReferences(value, variables) || validateVariableReferenceTypes(value, variables, "color");
	if (error) issues.push({ fieldId, message: `${label}: ${lowercaseFirst(error)}` });
}

function fieldIdFromValidationMessage(message: string, fields: FormDialogFieldRow[]) {
	const match = /^component (\d+)/i.exec(message);
	if (!match) return undefined;
	const index = Number(match[1]) - 1;
	return fields[index]?.id;
}

function deduplicateIssues(issues: FormDialogIssue[]) {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = `${issue.fieldId ?? "form"}\0${issue.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function lowercaseFirst(value: string) {
	return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}
