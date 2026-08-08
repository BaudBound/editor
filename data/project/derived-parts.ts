import type { JsonValue } from "@/lib/types";

/**
 * The `.$` parts a datetime or duration exposes, and how they are computed.
 *
 * One definition, used by the variable picker, its preview values, and the
 * simulator. The runner computes the same set in
 * `crates/baudbound-runtime/src/runtime/variables.rs`; the two are held
 * together by `contracts/datetime-part-conformance.json`.
 */

export type DerivedPartField = {
	name: string;
	type: "integer";
	description: string;
};

/** Singular, because a point in time has one hour. */
export const datetimePartFields: DerivedPartField[] = [
	{ name: "$year", type: "integer", description: "Calendar year." },
	{ name: "$month", type: "integer", description: "Month, 1 through 12." },
	{ name: "$day", type: "integer", description: "Day of the month." },
	{ name: "$hour", type: "integer", description: "Hour, 0 through 23." },
	{ name: "$minute", type: "integer", description: "Minute, 0 through 59." },
	{ name: "$second", type: "integer", description: "Second, 0 through 59." },
	{ name: "$weekday", type: "integer", description: "Day of the week, Monday 1 through Sunday 7." },
];

/** Plural, because a span is some number of them. */
export const durationPartFields: DerivedPartField[] = [
	{ name: "$days", type: "integer", description: "Whole days in the span." },
	{ name: "$hours", type: "integer", description: "Hours left after the days." },
	{ name: "$minutes", type: "integer", description: "Minutes left after the hours." },
	{ name: "$seconds", type: "integer", description: "Seconds left after the minutes." },
	{ name: "$milliseconds", type: "integer", description: "Milliseconds left after the seconds." },
	{ name: "$total_milliseconds", type: "integer", description: "The whole span in milliseconds." },
];

export function derivedPartFieldsForType(type: string): DerivedPartField[] {
	if (type === "datetime") return datetimePartFields;
	if (type === "duration") return durationPartFields;
	return [];
}

const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})/;

const DURATION_UNIT_MS: Record<string, number> = {
	milliseconds: 1,
	seconds: 1_000,
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
};

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parts of a datetime, read in the offset the value carries.
 *
 * The fields are taken straight out of the text rather than through `Date`,
 * which would convert to the machine's own zone and report a different hour
 * than the runner does for the same value.
 */
function datetimeParts(value: JsonValue | undefined): Record<string, number> | undefined {
	if (!isRecord(value) || value.type !== "datetime" || typeof value.value !== "string") return undefined;
	const match = RFC_3339.exec(value.value);
	if (!match) return undefined;

	const [, year, month, day, hour, minute, second] = match.map(Number);
	// getUTCDay on the calendar date alone, so the weekday does not shift with
	// the machine's zone. Sunday is 0 there and 7 in the ISO numbering.
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

	return {
		$year: year,
		$month: month,
		$day: day,
		$hour: hour,
		$minute: minute,
		$second: second,
		$weekday: weekday === 0 ? 7 : weekday,
	};
}

/** The parts of a duration, broken into whole components. */
function durationParts(value: JsonValue | undefined): Record<string, number> | undefined {
	if (!isRecord(value) || value.type !== "duration" || typeof value.value !== "number") return undefined;
	const unitMs = DURATION_UNIT_MS[typeof value.unit === "string" ? value.unit : ""];
	if (unitMs === undefined || !Number.isFinite(value.value) || value.value < 0) return undefined;

	const total = Math.round(value.value * unitMs);
	if (!Number.isSafeInteger(total)) return undefined;

	return {
		$days: Math.trunc(total / 86_400_000),
		$hours: Math.trunc((total % 86_400_000) / 3_600_000),
		$minutes: Math.trunc((total % 3_600_000) / 60_000),
		$seconds: Math.trunc((total % 60_000) / 1_000),
		$milliseconds: total % 1_000,
		$total_milliseconds: total,
	};
}

/** The value of one `.$` part, or undefined when it does not apply. */
export function derivedPartValue(value: JsonValue | undefined, key: string): number | undefined {
	const parts = datetimeParts(value) ?? durationParts(value);
	return parts?.[key];
}
