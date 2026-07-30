import type { JsonValue } from "@/lib/types";

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_REGEX_PATTERN_LENGTH = 256;
const UNSAFE_REGEX_PATTERN =
	/(\([^)]*[+*][^)]*\)[+*?])|(\[[^\]]+\][+*?].*\[[^\]]+\][+*?])|((?:\.\*){2,})|((?:\w|\)|\]|\.|\+|\*)\{\d+,?\d*\}[+*?])/;

export function conditionValuesEqual(left: JsonValue, right: JsonValue) {
	if (left === right) {
		return true;
	}

	if (typeof left === "number" || typeof right === "number") {
		const leftNumber = conditionNumber(left);
		const rightNumber = conditionNumber(right);
		if (leftNumber !== undefined && rightNumber !== undefined) {
			return leftNumber === rightNumber;
		}
	}

	return String(left) === String(right);
}

export function conditionNumber(value: JsonValue) {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}

	if (typeof value !== "string" || !DECIMAL_NUMBER.test(value)) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function compareConditionValues(
	left: JsonValue,
	operator: string,
	right: JsonValue,
	rightEnd: JsonValue = null,
) {
	const result = evaluateConditionValues(left, operator, right, rightEnd);
	return result.error ? false : result.value;
}

export type ConditionEvaluationResult = { error?: never; value: boolean } | { error: string; value?: never };

export function evaluateConditionValues(
	left: JsonValue,
	operator: string,
	right: JsonValue,
	rightEnd: JsonValue = null,
): ConditionEvaluationResult {
	const leftText = conditionValueToText(left);
	const rightText = conditionValueToText(right);
	const leftNumber = conditionNumber(left);
	const rightNumber = conditionNumber(right);
	const rightEndNumber = conditionNumber(rightEnd);

	switch (operator) {
		case "==":
			return conditionResult(conditionValuesEqual(left, right));
		case ">":
			return compareConditionNumbers(leftNumber, rightNumber, (leftValue, rightValue) => leftValue > rightValue);
		case ">=":
			return compareConditionNumbers(leftNumber, rightNumber, (leftValue, rightValue) => leftValue >= rightValue);
		case "<":
			return compareConditionNumbers(leftNumber, rightNumber, (leftValue, rightValue) => leftValue < rightValue);
		case "<=":
			return compareConditionNumbers(leftNumber, rightNumber, (leftValue, rightValue) => leftValue <= rightValue);
		case "is_between":
			return compareConditionRange(leftNumber, rightNumber, rightEndNumber);
		case "contains":
			return conditionResult(leftText.includes(rightText));
		case "equals_ignore_case":
			return conditionResult(leftText.toLowerCase() === rightText.toLowerCase());
		case "contains_ignore_case":
			return conditionResult(leftText.toLowerCase().includes(rightText.toLowerCase()));
		case "starts_with":
			return conditionResult(leftText.startsWith(rightText));
		case "ends_with":
			return conditionResult(leftText.endsWith(rightText));
		case "regex_match":
			return safeRegexMatch(leftText, rightText);
		case "is_empty":
			return conditionResult(isConditionValueEmpty(left));
		case "is_true":
			return conditionResult(left === true);
		case "is_false":
			return conditionResult(left === false);
		case "is_numeric":
			return conditionResult(conditionNumber(left) !== undefined);
		case "is_string":
			return conditionResult(typeof left === "string");
		case "is_boolean":
			return conditionResult(typeof left === "boolean");
		case "is_list":
			return conditionResult(Array.isArray(left));
		case "is_object":
			return conditionResult(left !== null && typeof left === "object" && !Array.isArray(left));
		case "has_key":
			return conditionResult(
				left !== null && typeof left === "object" && !Array.isArray(left) && Object.hasOwn(left, rightText),
			);
		case "contains_item":
			return conditionResult(Array.isArray(left) && left.some((item) => conditionValuesEqual(item, right)));
		case "is_null_or_missing":
			return { error: "null or missing checks require an unresolved variable expression" };
		default:
			return { error: `unsupported comparison operator ${operator}` };
	}
}

function compareConditionRange(
	value: number | undefined,
	start: number | undefined,
	end: number | undefined,
): ConditionEvaluationResult {
	if (value === undefined || start === undefined || end === undefined) {
		return { error: "between comparison requires numeric input, start, and end values" };
	}
	if (start > end) {
		return { error: "between comparison start must be less than or equal to end" };
	}

	return conditionResult(value >= start && value <= end);
}

function conditionResult(value: boolean): ConditionEvaluationResult {
	return { value };
}

function compareConditionNumbers(
	left: number | undefined,
	right: number | undefined,
	compare: (leftValue: number, rightValue: number) => boolean,
): ConditionEvaluationResult {
	if (left === undefined || right === undefined) {
		return { error: "numeric comparison requires numeric values" };
	}

	return conditionResult(compare(left, right));
}

function conditionValueToText(value: JsonValue) {
	if (value === null) {
		return "";
	}

	if (typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
}

function isConditionValueEmpty(value: JsonValue) {
	if (value === null) {
		return true;
	}

	if (typeof value === "string" || Array.isArray(value)) {
		return value.length === 0;
	}

	return typeof value === "object" && Object.keys(value).length === 0;
}

function safeRegexMatch(value: string, pattern: string) {
	if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
		return {
			error: `regex pattern exceeds ${MAX_REGEX_PATTERN_LENGTH} characters`,
		} satisfies ConditionEvaluationResult;
	}
	if (UNSAFE_REGEX_PATTERN.test(pattern)) {
		return { error: "regex pattern is unsafe to simulate" } satisfies ConditionEvaluationResult;
	}

	try {
		return conditionResult(new RegExp(pattern).test(value));
	} catch (error) {
		return {
			error: `invalid regex pattern: ${error instanceof Error ? error.message : "unknown syntax error"}`,
		} satisfies ConditionEvaluationResult;
	}
}
