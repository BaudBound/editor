import type { JsonValue } from "@/lib/types";

export type ConditionRow = {
	id: string;
	invert?: boolean;
	left: string;
	combinator?: string;
	operator: string;
	right: string;
	rightEnd?: string;
};

export type SwitchCaseRow = {
	id: string;
	name: string;
	value: string;
	expectedValue?: string;
};

export type HeaderRow = {
	id: string;
	name: string;
	value: string;
};

export type TextTransformOperationRow = {
	id: string;
	operation: string;
	template: string;
	search: string;
	replacement: string;
	delimiter: string;
	start: string;
	length: string;
	targetLength: string;
	pad: string;
};

export function createConditionRow(left = "", right = "", combinator?: string): ConditionRow {
	const row = {
		id: crypto.randomUUID(),
		left,
		operator: "==",
		right,
	};

	return combinator === undefined ? row : { ...row, combinator };
}

export function createSwitchCaseRow(name = ""): SwitchCaseRow {
	return {
		id: crypto.randomUUID(),
		name,
		value: name,
	};
}

export function createTextTransformOperationRow(operation = "trim"): TextTransformOperationRow {
	return {
		id: crypto.randomUUID(),
		operation,
		template: "",
		search: "",
		replacement: "",
		delimiter: "",
		start: "",
		length: "",
		targetLength: "",
		pad: "",
	};
}

export function createHeaderRow(name = "", value = ""): HeaderRow {
	return {
		id: crypto.randomUUID(),
		name,
		value,
	};
}

export function createSwitchOutputPorts(cases: SwitchCaseRow[], defaultOutput = "default") {
	return [
		...cases.map((switchCase, index) => ({
			id: `case-${switchCase.id}`,
			label: switchCase.name.trim() || `case ${index + 1}`,
		})),
		{ id: defaultOutput, label: "default" },
	];
}

export function isConditionRow(value: JsonValue): value is ConditionRow {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.left === "string" &&
		typeof value.operator === "string" &&
		typeof value.right === "string" &&
		(typeof value.rightEnd === "string" || value.rightEnd === undefined) &&
		(typeof value.invert === "boolean" || value.invert === undefined) &&
		(typeof value.combinator === "string" || value.combinator === undefined)
	);
}

export function isSwitchCaseRow(value: JsonValue): value is SwitchCaseRow {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		(typeof value.value === "string" || typeof value.expectedValue === "string")
	);
}

export function isHeaderRow(value: JsonValue): value is HeaderRow {
	return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

export function isTextTransformOperationRow(value: JsonValue): value is TextTransformOperationRow {
	return isRecord(value) && typeof value.id === "string" && typeof value.operation === "string";
}

export function getTextTransformOperationRows(value: JsonValue | undefined): TextTransformOperationRow[] {
	if (!Array.isArray(value)) {
		return [createTextTransformOperationRow()];
	}

	const rows = value.filter(isTextTransformOperationRow).map((row) => ({
		...createTextTransformOperationRow(row.operation),
		...row,
	}));
	return rows.length > 0 ? rows : [createTextTransformOperationRow()];
}

export function getSwitchCaseRowsFromValue(value: JsonValue | undefined): SwitchCaseRow[] {
	if (!Array.isArray(value)) {
		return [createSwitchCaseRow()];
	}

	const rows = value.filter(isSwitchCaseRow).map((row) => ({
		id: row.id,
		name: row.name,
		value: row.value ?? String(row.expectedValue ?? ""),
	}));

	return rows.length > 0 ? rows : [createSwitchCaseRow()];
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
