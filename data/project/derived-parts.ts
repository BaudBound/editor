import type { JsonValue } from "@/lib/types";

/**
 * The fields a datetime or duration exposes by path.
 *
 * These used to be `.$` suffixes alongside `$length` and `$type`, which put two
 * different things through one door: `$` describes a value, while a component
 * is part of the value and belongs on the path. So `{{when.hour}}` rather than
 * `{{when.$hour}}`, and `$` means metadata and nothing else.
 *
 * One definition, used by the variable picker, its preview values, and the
 * simulator. The runner computes the same set in
 * `crates/baudbound-runtime/src/runtime/variables.rs`; the two are held
 * together by `contracts/datetime-part-conformance.json`.
 */

export type ComponentField = {
	name: string;
	type: "integer" | "string";
	description: string;
};

/** Singular, because a point in time has one hour. */
export const datetimeComponentFields: ComponentField[] = [
	{ name: "full", type: "string", description: "The whole moment as RFC 3339 text, offset included." },
	{ name: "utc", type: "string", description: "The same moment as RFC 3339 text in UTC." },
	{ name: "unix", type: "integer", description: "Seconds since the epoch." },
	{ name: "offset_minutes", type: "integer", description: "Minutes the offset is ahead of UTC." },
	{ name: "year", type: "integer", description: "Calendar year." },
	{ name: "month", type: "integer", description: "Month, 1 through 12." },
	{ name: "day", type: "integer", description: "Day of the month." },
	{ name: "hour", type: "integer", description: "Hour, 0 through 23." },
	{ name: "minute", type: "integer", description: "Minute, 0 through 59." },
	{ name: "second", type: "integer", description: "Second, 0 through 59." },
	{ name: "weekday", type: "integer", description: "Day of the week, Monday 1 through Sunday 7." },
];

/** Plural, because a span is some number of them. */
export const durationComponentFields: ComponentField[] = [
	{ name: "days", type: "integer", description: "Whole days in the span." },
	{ name: "hours", type: "integer", description: "Hours left after the days." },
	{ name: "minutes", type: "integer", description: "Minutes left after the hours." },
	{ name: "seconds", type: "integer", description: "Seconds left after the minutes." },
	{ name: "milliseconds", type: "integer", description: "Milliseconds left after the seconds." },
	{ name: "total_milliseconds", type: "integer", description: "The whole span in milliseconds." },
];

export function componentFieldsForType(type: string): ComponentField[] {
	if (type === "datetime") return datetimeComponentFields;
	if (type === "duration") return durationComponentFields;
	return [];
}

const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

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
 * One field of a datetime, read in the offset the value carries.
 *
 * The fields are taken out of the text rather than through `Date`, which would
 * convert to the machine's own zone and report a different hour than the runner
 * does for the same value.
 */
function datetimeComponent(value: JsonValue | undefined, field: string): JsonValue | undefined {
	if (!isRecord(value) || value.type !== "datetime" || typeof value.value !== "string") return undefined;
	const match = RFC_3339.exec(value.value);
	if (!match) return undefined;

	const [, year, month, day, hour, minute, second] = match.map(Number);
	const offsetMinutes = match[7] ? 0 : (match[8] === "-" ? -1 : 1) * (Number(match[9]) * 60 + Number(match[10]));
	// getUTCDay on the calendar date alone, so the weekday does not shift with
	// the machine's zone. Sunday is 0 there and 7 in the ISO numbering.
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;

	switch (field) {
		case "full":
			return value.value;
		case "utc":
			return `${new Date(utcMillis).toISOString().slice(0, 19)}Z`;
		case "unix":
			return Math.floor(utcMillis / 1000);
		case "offset_minutes":
			return offsetMinutes;
		case "year":
			return year;
		case "month":
			return month;
		case "day":
			return day;
		case "hour":
			return hour;
		case "minute":
			return minute;
		case "second":
			return second;
		case "weekday":
			return weekday === 0 ? 7 : weekday;
		default:
			return undefined;
	}
}

/** One field of a duration, broken into whole components. */
function durationComponent(value: JsonValue | undefined, field: string): JsonValue | undefined {
	if (!isRecord(value) || value.type !== "duration" || typeof value.value !== "number") return undefined;
	const unitMs = DURATION_UNIT_MS[typeof value.unit === "string" ? value.unit : ""];
	if (unitMs === undefined || !Number.isFinite(value.value) || value.value < 0) return undefined;

	const total = Math.round(value.value * unitMs);
	if (!Number.isSafeInteger(total)) return undefined;

	switch (field) {
		case "days":
			return Math.trunc(total / 86_400_000);
		case "hours":
			return Math.trunc((total % 86_400_000) / 3_600_000);
		case "minutes":
			return Math.trunc((total % 3_600_000) / 60_000);
		case "seconds":
			return Math.trunc((total % 60_000) / 1_000);
		case "milliseconds":
			return total % 1_000;
		case "total_milliseconds":
			return total;
		default:
			return undefined;
	}
}

/** One computed field of a datetime or duration, or undefined for anything else. */
export function componentFieldValue(value: JsonValue | undefined, field: string): JsonValue | undefined {
	return datetimeComponent(value, field) ?? durationComponent(value, field);
}
