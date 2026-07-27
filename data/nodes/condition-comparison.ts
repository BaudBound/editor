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

export function compareConditionValues(left: JsonValue, operator: string, right: JsonValue) {
	const leftText = conditionValueToText(left);
	const rightText = conditionValueToText(right);
	const leftNumber = conditionNumber(left);
	const rightNumber = conditionNumber(right);

	switch (operator) {
		case "==":
			return conditionValuesEqual(left, right);
		case "!=":
			return !conditionValuesEqual(left, right);
		case ">":
			return leftNumber !== undefined && rightNumber !== undefined && leftNumber > rightNumber;
		case ">=":
			return leftNumber !== undefined && rightNumber !== undefined && leftNumber >= rightNumber;
		case "<":
			return leftNumber !== undefined && rightNumber !== undefined && leftNumber < rightNumber;
		case "<=":
			return leftNumber !== undefined && rightNumber !== undefined && leftNumber <= rightNumber;
		case "contains":
			return leftText.includes(rightText);
		case "equals_ignore_case":
			return leftText.toLowerCase() === rightText.toLowerCase();
		case "contains_ignore_case":
			return leftText.toLowerCase().includes(rightText.toLowerCase());
		case "does_not_contain":
			return !leftText.includes(rightText);
		case "starts_with":
			return leftText.startsWith(rightText);
		case "ends_with":
			return leftText.endsWith(rightText);
		case "regex_match":
			return safeRegexMatch(leftText, rightText);
		case "is_empty":
			return isConditionValueEmpty(left);
		case "is_null":
			return left === null;
		case "is_true":
			return left === true;
		case "is_false":
			return left === false;
		case "is_numeric":
			return conditionNumber(left) !== undefined;
		case "is_text":
			return typeof left === "string";
		case "is_boolean":
			return typeof left === "boolean";
		case "is_list":
			return Array.isArray(left);
		case "is_object":
			return left !== null && typeof left === "object" && !Array.isArray(left);
		case "is_not_empty":
			return !isConditionValueEmpty(left);
		case "has_key":
			return left !== null && typeof left === "object" && !Array.isArray(left) && Object.hasOwn(left, rightText);
		case "contains_item":
			return Array.isArray(left) && left.some((item) => conditionValuesEqual(item, right));
		case "length_equals":
			return compareConditionLength(left, right, (length, target) => length === target);
		case "length_greater_than":
			return compareConditionLength(left, right, (length, target) => length > target);
		case "length_less_than":
			return compareConditionLength(left, right, (length, target) => length < target);
		default:
			return false;
	}
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

function compareConditionLength(
	value: JsonValue,
	targetValue: JsonValue,
	compare: (length: number, target: number) => boolean,
) {
	const length = conditionValueLength(value);
	const target = conditionNumber(targetValue);
	return (
		length !== undefined && target !== undefined && Number.isInteger(target) && target >= 0 && compare(length, target)
	);
}

function conditionValueLength(value: JsonValue) {
	if (typeof value === "string") {
		return Array.from(value).length;
	}

	if (Array.isArray(value)) {
		return value.length;
	}

	if (value !== null && typeof value === "object") {
		return Object.keys(value).length;
	}

	return undefined;
}

function safeRegexMatch(value: string, pattern: string) {
	if (pattern.length > MAX_REGEX_PATTERN_LENGTH || UNSAFE_REGEX_PATTERN.test(pattern)) {
		return false;
	}

	try {
		return new RegExp(pattern).test(value);
	} catch {
		return false;
	}
}
