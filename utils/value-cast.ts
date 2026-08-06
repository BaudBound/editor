import { validateWindowsHotkey } from "@/data/nodes/windows-key-contract";
import { typedDatetimeIso } from "@/data/project/datetime";

/**
 * The type rules and the cast, kept out of the simulator module.
 *
 * A node definition needs the cast, and the simulator imports the node
 * registry, so importing the simulator from a node definition would form a
 * cycle and leave the registry undefined while it initialises.
 */
const MAX_SAFE_TYPE_INTEGER = 9007199254740991;

/**
 * Reports why a value fails its type, or null when it satisfies it.
 *
 * Mirrors validate_value in the runner. The two are asserted against the same
 * conformance fixtures, because a lenient simulator would let authors ship
 * scripts that pass simulation and stop in production.
 */
export function validateSimulatedValue(value: unknown, type: string): string | null {
	if (value === null || value === undefined) return `expected ${type}, found no value`;

	switch (type) {
		case "string":
			return typeof value === "string" ? null : `expected string`;
		case "boolean":
			return typeof value === "boolean" ? null : `expected boolean`;
		case "list":
			return Array.isArray(value) ? null : `expected list`;
		case "object":
			return typeof value === "object" && !Array.isArray(value) ? null : `expected object`;
		case "integer":
			return typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_TYPE_INTEGER
				? null
				: `expected integer`;
		case "float":
			return typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value) ? null : `expected float`;
		case "color":
			return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? null : `expected color in #RRGGBB format`;
		case "keyboard_key":
			return typeof value === "string" && !validateWindowsHotkey(value) ? null : `expected keyboard key`;
		case "datetime":
			return isTagged(value, "datetime", ["type", "value"]) ? null : `expected datetime`;
		case "duration":
			return isTagged(value, "duration", ["type", "unit", "value"]) ? null : `expected duration`;
		default:
			return `unknown type ${type}`;
	}
}

function isTagged(value: unknown, tag: string, fields: string[]) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.type === tag && fields.every((field) => field in record);
}

// Mirrors what Rust's f64 parser accepts, so the simulator and the runner
// agree on which strings are numbers.
const decimalNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

type CastOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Converts a value to a target type, mirroring cast_value in the runner.
 *
 * Asserted against the same conformance fixtures, because a lenient simulator
 * would let authors ship scripts that pass simulation and stop in production.
 */
export function castSimulatedValue(value: unknown, target: string): CastOutcome {
	if (value === null || value === undefined) {
		return { ok: false, error: `cannot cast to ${target} because the value is not set` };
	}

	switch (target) {
		case "string":
			return { ok: true, value: typeof value === "string" ? value : JSON.stringify(value) };
		case "integer":
		case "float": {
			// Only a number or a decimal string, matching the runner. Number()
			// also reads hex, binary and octal spellings and turns a one item
			// list into its element, none of which the runner accepts, so
			// using it directly would let the simulator succeed where a real
			// run stops.
			const parsed =
				typeof value === "number"
					? value
					: typeof value === "string" && decimalNumberPattern.test(value.trim())
						? Number(value.trim())
						: Number.NaN;
			if (!Number.isFinite(parsed)) {
				return { ok: false, error: `cannot cast to ${target} because the value is not a finite number` };
			}
			if (target === "float") return { ok: true, value: parsed };
			if (!Number.isInteger(parsed)) {
				return { ok: false, error: "cannot cast to integer because the value is fractional" };
			}
			if (Math.abs(parsed) > MAX_SAFE_TYPE_INTEGER) {
				return { ok: false, error: "cannot cast to integer because the value is outside the safe range" };
			}
			return { ok: true, value: parsed };
		}
		case "boolean": {
			if (typeof value === "boolean") return { ok: true, value };
			const text = String(value).trim().toLowerCase();
			if (text === "true") return { ok: true, value: true };
			if (text === "false") return { ok: true, value: false };
			return { ok: false, error: "cannot cast to boolean because the value is not true or false" };
		}
		case "list":
		case "object": {
			let parsed: unknown = value;
			if (typeof value === "string") {
				try {
					parsed = JSON.parse(value);
				} catch {
					parsed = value;
				}
			}
			const matches =
				target === "list"
					? Array.isArray(parsed)
					: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
			return matches
				? { ok: true, value: parsed }
				: { ok: false, error: `cannot cast to ${target} because the value is not one` };
		}
		case "color":
		case "keyboard_key":
			return validateSimulatedValue(value, target) === null
				? { ok: true, value }
				: { ok: false, error: `cannot cast to ${target}` };
		case "datetime": {
			if (validateSimulatedValue(value, "datetime") === null) return { ok: true, value };
			// typedDatetimeIso is the same RFC 3339-style check the rest of the
			// editor uses to decide whether a datetime string is genuine, so a
			// string such as "not a date" is rejected instead of accepted as-is.
			if (typeof value !== "string" || typedDatetimeIso({ type: "datetime", value }) === null) {
				return { ok: false, error: "cannot cast to datetime because the value is not a date" };
			}
			return { ok: true, value: { type: "datetime", value } };
		}
		case "duration":
			return validateSimulatedValue(value, "duration") === null
				? { ok: true, value }
				: { ok: false, error: "cannot cast to duration because the value has no unit" };
		default:
			return { ok: false, error: `unknown cast target ${target}` };
	}
}
