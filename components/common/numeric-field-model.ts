import type { NumericConfigContract } from "@/data/nodes/node-definition";
import { validateNumericConfigValue } from "@/data/nodes/numeric-validation";

const VARIABLE_PATTERN = /^\{\{\s*[^{}]+\s*}}$/;
const INTEGER_PATTERN = /^-?(?:0|[1-9][0-9]*)$/;
const FLOAT_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

export type NumericStepDirection = -1 | 1;

export function containsNumericVariable(value: string) {
	return VARIABLE_PATTERN.test(value);
}

export function getNumericDraftError(
	value: string,
	contract: NumericConfigContract,
	allowVariables: boolean,
	required: boolean,
) {
	const trimmed = value.trim();
	if (!trimmed) {
		return required ? "Enter a number." : "";
	}
	if (allowVariables && containsNumericVariable(trimmed)) {
		return "";
	}
	return validateNumericConfigValue(trimmed, contract);
}

export function stepNumericDraft(
	value: string,
	contract: NumericConfigContract,
	direction: NumericStepDirection,
	step = contract.kind === "integer" ? "1" : "1",
	multiplier = 1,
) {
	const trimmed = value.trim();
	if (containsNumericVariable(trimmed) || !Number.isInteger(multiplier) || multiplier < 1) {
		return null;
	}
	return contract.kind === "integer"
		? stepIntegerDraft(trimmed, contract, direction, step, multiplier)
		: stepFloatDraft(trimmed, contract, direction, step, multiplier);
}

export function numericAriaValue(value: string) {
	if (!value.trim() || containsNumericVariable(value)) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function stepIntegerDraft(
	value: string,
	contract: NumericConfigContract,
	direction: NumericStepDirection,
	step: string,
	multiplier: number,
) {
	const zero = BigInt(0);
	const one = BigInt(1);
	if (!INTEGER_PATTERN.test(step) || BigInt(step) <= zero) {
		return null;
	}
	const minimum = BigInt(contract.minimum) + (contract.minimumInclusive ? zero : one);
	const maximum = BigInt(contract.maximum) - (contract.maximumInclusive ? zero : one);
	if (minimum > maximum) {
		return null;
	}
	if (!value) {
		return initialIntegerValue(minimum, maximum).toString();
	}
	if (!INTEGER_PATTERN.test(value)) {
		return null;
	}

	const current = BigInt(value);
	const delta = BigInt(step) * BigInt(multiplier) * BigInt(direction);
	const next = clampBigInt(current + delta, minimum, maximum);
	return next === current ? null : next.toString();
}

function initialIntegerValue(minimum: bigint, maximum: bigint) {
	const zero = BigInt(0);
	if (minimum > zero) {
		return minimum;
	}
	if (maximum < zero) {
		return maximum;
	}
	return zero;
}

function stepFloatDraft(
	value: string,
	contract: NumericConfigContract,
	direction: NumericStepDirection,
	step: string,
	multiplier: number,
) {
	const parsedStep = Number(step);
	const minimum = Number(contract.minimum);
	const maximum = Number(contract.maximum);
	if (!Number.isFinite(parsedStep) || parsedStep <= 0 || !Number.isFinite(minimum) || !Number.isFinite(maximum)) {
		return null;
	}
	if (!value) {
		const initial = initialFloatValue(contract, minimum, maximum, parsedStep);
		return initial === null ? null : formatFloat(initial, decimalPlaces(step));
	}
	if (!FLOAT_PATTERN.test(value) || !Number.isFinite(Number(value))) {
		return null;
	}

	const current = Number(value);
	const precision = Math.min(12, Math.max(decimalPlaces(value), decimalPlaces(step)));
	const delta = parsedStep * multiplier * direction;
	const stepped = addDecimal(current, delta, precision);
	if ((!contract.minimumInclusive && stepped <= minimum) || (!contract.maximumInclusive && stepped >= maximum)) {
		return null;
	}
	const next = clampNumber(stepped, minimum, maximum);
	if (!Number.isFinite(next) || Object.is(next, current)) {
		return null;
	}
	return formatFloat(next, precision);
}

function initialFloatValue(contract: NumericConfigContract, minimum: number, maximum: number, step: number) {
	let candidate = 0;
	if (candidate < minimum || (!contract.minimumInclusive && candidate <= minimum)) {
		candidate = contract.minimumInclusive ? minimum : minimum + step;
	}
	if (candidate > maximum || (!contract.maximumInclusive && candidate >= maximum)) {
		candidate = contract.maximumInclusive ? maximum : maximum - step;
	}
	if (!isFloatWithinBounds(candidate, contract, minimum, maximum)) {
		candidate = minimum / 2 + maximum / 2;
	}
	return Number.isFinite(candidate) && isFloatWithinBounds(candidate, contract, minimum, maximum) ? candidate : null;
}

function isFloatWithinBounds(value: number, contract: NumericConfigContract, minimum: number, maximum: number) {
	const aboveMinimum = contract.minimumInclusive ? value >= minimum : value > minimum;
	const belowMaximum = contract.maximumInclusive ? value <= maximum : value < maximum;
	return aboveMinimum && belowMaximum;
}

function addDecimal(value: number, delta: number, precision: number) {
	const scale = 10 ** precision;
	if (Number.isSafeInteger(value * scale) && Number.isSafeInteger(delta * scale)) {
		return (Math.round(value * scale) + Math.round(delta * scale)) / scale;
	}
	return value + delta;
}

function decimalPlaces(value: string) {
	const normalized = value.toLowerCase();
	const [coefficient, exponentText] = normalized.split("e");
	const fractionLength = coefficient?.split(".")[1]?.length ?? 0;
	const exponent = exponentText ? Number(exponentText) : 0;
	return Number.isFinite(exponent) ? Math.max(0, fractionLength - exponent) : fractionLength;
}

function formatFloat(value: number, precision: number) {
	if (!Number.isFinite(value)) {
		return "";
	}
	if (precision > 0 && Math.abs(value) < 1e21) {
		return value.toFixed(precision).replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
	}
	return String(value);
}

function clampBigInt(value: bigint, minimum: bigint, maximum: bigint) {
	if (value < minimum) {
		return minimum;
	}
	if (value > maximum) {
		return maximum;
	}
	return value;
}

function clampNumber(value: number, minimum: number, maximum: number) {
	return Math.min(Math.max(value, minimum), maximum);
}
