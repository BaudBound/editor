import type { JsonValue } from "@/lib/types";

/**
 * Renders a non-negative elapsed duration with a pattern such as `HH:mm:ss`.
 *
 * The runner implements the same language in
 * `crates/baudbound-runtime/src/runtime/duration_format.rs`; shared fixtures
 * keep the editor simulator and runner aligned.
 */

export type DurationTokenGroup = {
	label: string;
	tokens: { token: string; description: string }[];
};

export const durationUnits = ["milliseconds", "seconds", "minutes", "hours", "days"] as const;
export type DurationUnit = (typeof durationUnits)[number];

export const durationFormatTokenGroups: DurationTokenGroup[] = [
	{
		label: "Day",
		tokens: [
			{ token: "DD", description: "01, whole days" },
			{ token: "D", description: "1, whole days" },
		],
	},
	{
		label: "Time",
		tokens: [
			{ token: "HH", description: "01 hours" },
			{ token: "H", description: "1 hour" },
			{ token: "mm", description: "05 minutes" },
			{ token: "m", description: "5 minutes" },
			{ token: "ss", description: "09 seconds" },
			{ token: "s", description: "9 seconds" },
		],
	},
	{
		label: "Milliseconds",
		tokens: [
			{ token: "SSS", description: "234 milliseconds" },
			{ token: "SS", description: "23 hundredths" },
			{ token: "S", description: "2 tenths" },
		],
	},
];

const TOKENS = durationFormatTokenGroups
	.flatMap((group) => group.tokens.map((entry) => entry.token))
	.sort((left, right) => right.length - left.length);

const millisecondsPerUnit: Record<DurationUnit, number> = {
	milliseconds: 1,
	seconds: 1_000,
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
};

type DurationFields = {
	days: number;
	hours: number;
	milliseconds: number;
	minutes: number;
	seconds: number;
};

export function isDurationUnit(value: string): value is DurationUnit {
	return durationUnits.includes(value as DurationUnit);
}

export function validateDurationPattern(pattern: string): string {
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
			return `"${run}" is not a duration format token. Quote it as '${run}' to use it as text.`;
		}
		index += token.length;
	}

	return "";
}

/** Returns undefined when the input is not a finite non-negative duration. */
export function formatDuration(value: JsonValue | undefined, unit: string, pattern: string): string | undefined {
	if (!isDurationUnit(unit)) return undefined;
	const amount = durationAmount(value);
	if (amount === undefined) return undefined;
	const totalMilliseconds = Math.round(amount * millisecondsPerUnit[unit]);
	if (!Number.isSafeInteger(totalMilliseconds) || totalMilliseconds < 0) return undefined;

	const fields = durationFields(totalMilliseconds);
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

function durationAmount(value: JsonValue | undefined) {
	const candidate =
		typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim()) : Number.NaN;
	return Number.isFinite(candidate) && candidate >= 0 ? candidate : undefined;
}

function durationFields(totalMilliseconds: number): DurationFields {
	const days = Math.floor(totalMilliseconds / 86_400_000);
	const afterDays = totalMilliseconds % 86_400_000;
	return {
		days,
		hours: Math.floor(afterDays / 3_600_000),
		minutes: Math.floor((afterDays % 3_600_000) / 60_000),
		seconds: Math.floor((afterDays % 60_000) / 1_000),
		milliseconds: afterDays % 1_000,
	};
}

function renderToken(token: string, fields: DurationFields) {
	switch (token) {
		case "DD":
			return String(fields.days).padStart(2, "0");
		case "D":
			return String(fields.days);
		case "HH":
			return String(fields.hours).padStart(2, "0");
		case "H":
			return String(fields.hours);
		case "mm":
			return String(fields.minutes).padStart(2, "0");
		case "m":
			return String(fields.minutes);
		case "ss":
			return String(fields.seconds).padStart(2, "0");
		case "s":
			return String(fields.seconds);
		case "SSS":
			return String(fields.milliseconds).padStart(3, "0");
		case "SS":
			return String(Math.floor(fields.milliseconds / 10)).padStart(2, "0");
		case "S":
			return String(Math.floor(fields.milliseconds / 100));
		default:
			return "";
	}
}
