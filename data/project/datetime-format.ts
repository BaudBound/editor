import type { JsonValue } from "@/lib/types";

/**
 * Renders a datetime with a pattern such as `yyyy-MM-dd HH:mm`.
 *
 * One definition, used by the simulator and by the editor's authoring-time
 * validation. The runner implements the same language in
 * `crates/baudbound-runtime/src/runtime/datetime_format.rs`; the two are held
 * together by `contracts/datetime-format-conformance.json`.
 *
 * A pattern is read in the offset the value carries, matching the `.$` parts,
 * so an author sees the wall clock the value was written in.
 *
 * Month and weekday names are English. Nothing else in the variable system
 * depends on locale, and making one field of one node depend on it would be a
 * surprising place to introduce it.
 */

export type DatetimeTokenGroup = {
	label: string;
	tokens: { token: string; description: string }[];
};

/** Grouped for the reference panel, in the order an author reads a date. */
export const datetimeFormatTokenGroups: DatetimeTokenGroup[] = [
	{
		label: "Year",
		tokens: [
			{ token: "yyyy", description: "2026" },
			{ token: "yy", description: "26" },
		],
	},
	{
		label: "Month",
		tokens: [
			{ token: "MMMM", description: "July" },
			{ token: "MMM", description: "Jul" },
			{ token: "MM", description: "07" },
			{ token: "M", description: "7" },
		],
	},
	{
		label: "Day",
		tokens: [
			{ token: "dd", description: "03" },
			{ token: "d", description: "3" },
			{ token: "EEEE", description: "Friday" },
			{ token: "EEE", description: "Fri" },
		],
	},
	{
		label: "Hour",
		tokens: [
			{ token: "HH", description: "14, 24-hour" },
			{ token: "H", description: "14, 24-hour" },
			{ token: "hh", description: "02, 12-hour" },
			{ token: "h", description: "2, 12-hour" },
			{ token: "a", description: "PM" },
		],
	},
	{
		label: "Minute and second",
		tokens: [
			{ token: "mm", description: "05" },
			{ token: "m", description: "5" },
			{ token: "ss", description: "09" },
			{ token: "s", description: "9" },
		],
	},
];

/** Longest first, so `yyyy` is never read as two `yy`. */
const TOKENS = datetimeFormatTokenGroups
	.flatMap((group) => group.tokens.map((entry) => entry.token))
	.sort((left, right) => right.length - left.length);

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** Index 1 is Monday, matching the ISO weekday the `.$weekday` part reports. */
const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})/;

type DatetimeFields = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	weekday: number;
};

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the wall clock out of the text, so the machine's zone is irrelevant. */
export function datetimeFields(value: JsonValue | undefined): DatetimeFields | undefined {
	if (!isRecord(value) || value.type !== "datetime" || typeof value.value !== "string") return undefined;
	const match = RFC_3339.exec(value.value);
	if (!match) return undefined;

	const [, year, month, day, hour, minute, second] = match.map(Number);
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	return { year, month, day, hour, minute, second, weekday: weekday === 0 ? 7 : weekday };
}

function pad(value: number, width: number) {
	return String(value).padStart(width, "0");
}

function renderToken(token: string, fields: DatetimeFields): string {
	const hour12 = fields.hour % 12 === 0 ? 12 : fields.hour % 12;
	switch (token) {
		case "yyyy":
			return pad(fields.year, 4);
		case "yy":
			return pad(fields.year % 100, 2);
		case "MMMM":
			return MONTH_NAMES[fields.month - 1] ?? "";
		case "MMM":
			return (MONTH_NAMES[fields.month - 1] ?? "").slice(0, 3);
		case "MM":
			return pad(fields.month, 2);
		case "M":
			return String(fields.month);
		case "dd":
			return pad(fields.day, 2);
		case "d":
			return String(fields.day);
		case "EEEE":
			return WEEKDAY_NAMES[fields.weekday] ?? "";
		case "EEE":
			return (WEEKDAY_NAMES[fields.weekday] ?? "").slice(0, 3);
		case "HH":
			return pad(fields.hour, 2);
		case "H":
			return String(fields.hour);
		case "hh":
			return pad(hour12, 2);
		case "h":
			return String(hour12);
		case "a":
			return fields.hour < 12 ? "AM" : "PM";
		case "mm":
			return pad(fields.minute, 2);
		case "m":
			return String(fields.minute);
		case "ss":
			return pad(fields.second, 2);
		case "s":
			return String(fields.second);
		default:
			return "";
	}
}

/**
 * Reports the first problem with a pattern, or an empty string when it is fine.
 *
 * A run of letters that is not a token is refused rather than emitted as
 * itself, so a mistyped `YYYY` is an error where it is written instead of
 * literal text in the output.
 */
export function validateDatetimePattern(pattern: string): string {
	if (!pattern) return "Enter a format pattern.";

	let index = 0;
	while (index < pattern.length) {
		const character = pattern[index];
		if (character === "'") {
			const end = pattern.indexOf("'", index + 1);
			if (end === -1) return "A quoted section is missing its closing '.";
			index = end + 1;
			continue;
		}
		if (!/[A-Za-z]/.test(character)) {
			index += 1;
			continue;
		}
		const token = TOKENS.find((candidate) => pattern.startsWith(candidate, index));
		if (!token) {
			const run = /^[A-Za-z]+/.exec(pattern.slice(index))?.[0] ?? character;
			return `"${run}" is not a format token. Quote it as '${run}' to use it as text.`;
		}
		index += token.length;
	}

	return "";
}

/** Renders the pattern, or undefined when the value is not a datetime. */
export function formatDatetime(value: JsonValue | undefined, pattern: string): string | undefined {
	const fields = datetimeFields(value);
	if (!fields) return undefined;

	let output = "";
	let index = 0;
	while (index < pattern.length) {
		const character = pattern[index];
		if (character === "'") {
			const end = pattern.indexOf("'", index + 1);
			if (end === -1) {
				output += pattern.slice(index + 1);
				break;
			}
			// Two quotes in a row are a literal quote, the usual escape.
			output += end === index + 1 ? "'" : pattern.slice(index + 1, end);
			index = end + 1;
			continue;
		}
		const token = /[A-Za-z]/.test(character)
			? TOKENS.find((candidate) => pattern.startsWith(candidate, index))
			: undefined;
		if (token) {
			output += renderToken(token, fields);
			index += token.length;
			continue;
		}
		output += character;
		index += 1;
	}

	return output;
}
