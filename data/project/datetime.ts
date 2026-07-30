export const localTimeZoneValue = "__local__";

export const initialTimeZoneOptions = [
	{ label: "Local time", value: localTimeZoneValue },
	{ label: "UTC", value: "UTC" },
];

export function createTimeZoneOptions() {
	const supportedValuesOf = (
		Intl as typeof Intl & {
			supportedValuesOf?: (key: "timeZone") => string[];
		}
	).supportedValuesOf;
	const timeZones = supportedValuesOf ? supportedValuesOf.call(Intl, "timeZone") : [];
	return [
		...initialTimeZoneOptions,
		...timeZones.filter((timeZone) => timeZone !== "UTC").map((timeZone) => ({ label: timeZone, value: timeZone })),
	];
}

export function formatDatetimeForTimeZone(iso: string, timeZone: string) {
	const date = new Date(iso);
	if (timeZone === localTimeZoneValue) {
		const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return localTime.toISOString().slice(0, 19);
	}
	return formatDateParts(date, timeZone);
}

export function datetimeInTimeZoneToIso(value: string, timeZone: string) {
	const parts = parseDatetimeLocalValue(value);
	if (!parts) {
		return null;
	}
	if (timeZone === localTimeZoneValue) {
		const date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
		return datePartsMatch(date, parts, true) ? date.toISOString() : null;
	}

	const requestedUtc = datePartsToUtc(parts);
	let candidate = requestedUtc;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const displayedParts = parseDatetimeLocalValue(formatDateParts(new Date(candidate), timeZone));
		if (!displayedParts) {
			return null;
		}
		const correction = requestedUtc - datePartsToUtc(displayedParts);
		if (correction === 0) {
			return new Date(candidate).toISOString();
		}
		candidate += correction;
	}
	return formatDateParts(new Date(candidate), timeZone) === value ? new Date(candidate).toISOString() : null;
}

type DatetimeParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

function parseDatetimeLocalValue(value: string): DatetimeParts | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		return null;
	}
	const parts: DatetimeParts = {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
		hour: Number(match[4]),
		minute: Number(match[5]),
		second: Number(match[6]),
	};
	const date = new Date(datePartsToUtc(parts));
	return datePartsMatch(date, parts, false) ? parts : null;
}

function datePartsMatch(date: Date, parts: DatetimeParts, local: boolean) {
	if (local) {
		return (
			date.getFullYear() === parts.year &&
			date.getMonth() + 1 === parts.month &&
			date.getDate() === parts.day &&
			date.getHours() === parts.hour &&
			date.getMinutes() === parts.minute &&
			date.getSeconds() === parts.second
		);
	}
	return (
		date.getUTCFullYear() === parts.year &&
		date.getUTCMonth() + 1 === parts.month &&
		date.getUTCDate() === parts.day &&
		date.getUTCHours() === parts.hour &&
		date.getUTCMinutes() === parts.minute &&
		date.getUTCSeconds() === parts.second
	);
}

function datePartsToUtc(parts: DatetimeParts) {
	return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function formatDateParts(date: Date, timeZone: string) {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const parts = Object.fromEntries(
		formatter
			.formatToParts(date)
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
