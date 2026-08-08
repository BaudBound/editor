import type { ProjectSettings } from "@/lib/types";
import { DEFAULT_MINIMUM_RUNNER_VERSION } from "@/lib/version";
import type { EditorVariable } from "./variables";

export type BuiltInVariable = Omit<
	EditorVariable<BuiltInVariableValue | undefined>,
	"read_only" | "scope" | "source" | "value"
> & {
	description: string;
	example: string;
	runtimeBinding: string;
};

export type BuiltInVariableGroup = {
	id: BuiltInVariableScope;
	label: string;
	description: string;
	variables: BuiltInVariable[];
};

type BuiltInVariableScope = "manifest" | "system";
type BuiltInVariableValue = string | number | { type: "datetime"; value: string };
type BuiltInVariableRuntimeEntry = BuiltInVariable &
	EditorVariable<BuiltInVariableValue | undefined> & {
		scope: BuiltInVariableScope;
		value?: BuiltInVariableValue;
	};

const MANIFEST_FORMAT_VERSION = 1;

const manifestValueResolvers: Record<string, (settings: ProjectSettings) => BuiltInVariableValue> = {
	manifest_name: (settings: ProjectSettings) => settings.name,
	manifest_version: () => MANIFEST_FORMAT_VERSION,
	manifest_author: (settings: ProjectSettings) => settings.author,
	manifest_description: (settings: ProjectSettings) => settings.description,
	manifest_website: (settings: ProjectSettings) => settings.website,
	manifest_source: (settings: ProjectSettings) => settings.source,
	manifest_minimum_runner_version: (settings: ProjectSettings) => settings.minimumRunnerVersion,
};

const systemRuntimeBindings = {
	system_os: "runner.system.os",
	system_arch: "runner.system.arch",
	system_hostname: "runner.system.hostname",
	system_user: "runner.system.user",
	system_locale: "runner.system.locale",
	system_timezone: "runner.system.timezone",
	system_datetime: "runner.system.datetime",
} satisfies Record<string, string>;

export const builtInVariableGroups: BuiltInVariableGroup[] = [
	{
		id: "manifest",
		label: "Manifest",
		description: "Values from the script manifest and project settings.",
		variables: [
			{
				name: "manifest_name",
				token: "{{manifest_name}}",
				type: "string",
				description: "Current script name from project settings.",
				example: "server-health-check",
				runtimeBinding: "manifest.name",
			},
			{
				name: "manifest_version",
				token: "{{manifest_version}}",
				type: "integer",
				description: "Package version written to exported scripts.",
				example: "1",
				runtimeBinding: "manifest.format_version",
			},
			{
				name: "manifest_author",
				token: "{{manifest_author}}",
				type: "string",
				description: "Author from project settings.",
				example: "NATroutter",
				runtimeBinding: "manifest.author",
			},
			{
				name: "manifest_description",
				token: "{{manifest_description}}",
				type: "string",
				description: "Description from project settings.",
				example: "Checks server health and reports status.",
				runtimeBinding: "manifest.description",
			},
			{
				name: "manifest_website",
				token: "{{manifest_website}}",
				type: "string",
				description: "Project website from project settings.",
				example: "https://example.com",
				runtimeBinding: "manifest.website",
			},
			{
				name: "manifest_source",
				token: "{{manifest_source}}",
				type: "string",
				description: "Source URL from project settings.",
				example: "https://github.com/example/script",
				runtimeBinding: "manifest.source",
			},
			{
				name: "manifest_minimum_runner_version",
				token: "{{manifest_minimum_runner_version}}",
				type: "string",
				description: "Minimum runner version required by the package.",
				example: DEFAULT_MINIMUM_RUNNER_VERSION,
				runtimeBinding: "manifest.minimum_runner_version",
			},
		],
	},
	{
		id: "system",
		label: "System",
		description: "Runner-provided values that are always available at execution time.",
		variables: [
			{
				name: "system_os",
				token: "{{system_os}}",
				type: "string",
				description: "Operating system reported by the runner.",
				example: "windows",
				runtimeBinding: systemRuntimeBindings.system_os,
			},
			{
				name: "system_arch",
				token: "{{system_arch}}",
				type: "string",
				description: "CPU architecture reported by the runner.",
				example: "x64",
				runtimeBinding: systemRuntimeBindings.system_arch,
			},
			{
				name: "system_hostname",
				token: "{{system_hostname}}",
				type: "string",
				description: "Host name of the machine running the script.",
				example: "DESKTOP-01",
				runtimeBinding: systemRuntimeBindings.system_hostname,
			},
			{
				name: "system_user",
				token: "{{system_user}}",
				type: "string",
				description: "Current runner user name when the platform exposes it.",
				example: "runner",
				runtimeBinding: systemRuntimeBindings.system_user,
			},
			{
				name: "system_locale",
				token: "{{system_locale}}",
				type: "string",
				description: "Locale reported by the runner environment.",
				example: "en-US",
				runtimeBinding: systemRuntimeBindings.system_locale,
			},
			{
				name: "system_timezone",
				token: "{{system_timezone}}",
				type: "string",
				description: "Time zone reported by the runner environment.",
				example: "Europe/Helsinki",
				runtimeBinding: systemRuntimeBindings.system_timezone,
			},
			{
				name: "system_datetime",
				token: "{{system_datetime}}",
				type: "datetime",
				description:
					"Current runner date and time, carrying the runner's local offset. Read a part of it with a suffix such as .$hour, or render it with Format Text.",
				example: "2026-07-03T14:30:00+03:00",
				runtimeBinding: systemRuntimeBindings.system_datetime,
			},
		],
	},
];

export const builtInVariableNames = new Set(
	builtInVariableGroups.flatMap((group) => group.variables.map((variable) => variable.name)),
);

export function createBuiltInVariableRuntimeContext(projectSettings: ProjectSettings) {
	const variables = getBuiltInVariableRuntimeEntries(projectSettings);

	return {
		syntax: "{{variable_name}}",
		variables: variables.map((variable) => ({
			name: variable.name,
			token: variable.token,
			type: variable.type,
			scope: variable.scope,
			source: variable.source,
			read_only: variable.read_only,
			binding: variable.runtimeBinding,
			value: variable.value,
		})),
	};
}

export function getBuiltInVariableRuntimeEntries(projectSettings: ProjectSettings): BuiltInVariableRuntimeEntry[] {
	return builtInVariableGroups.flatMap((group) =>
		group.variables.map((variable) => ({
			...variable,
			read_only: true,
			scope: group.id,
			source: "built_in",
			value: resolveBuiltInVariableValue(group.id, variable.name, projectSettings),
		})),
	);
}

export function createSimulationBuiltInVariableValues(projectSettings: ProjectSettings, now = new Date()) {
	const manifestValues = Object.fromEntries(
		Object.entries(manifestValueResolvers).map(([name, resolver]) => [name, resolver(projectSettings)]),
	);
	const locale = getSimulationLocale();
	const timezone = getSimulationTimeZone();

	return {
		...manifestValues,
		system_os: getSimulationOperatingSystem(),
		system_arch: "simulated",
		system_hostname: "simulator",
		system_user: "simulator",
		system_locale: locale,
		system_timezone: timezone,
		system_datetime: { type: "datetime", value: toLocalIsoString(now) },
	} satisfies Record<string, BuiltInVariableValue>;
}

function resolveBuiltInVariableValue(
	scope: BuiltInVariableScope,
	name: string,
	projectSettings: ProjectSettings,
): BuiltInVariableValue | undefined {
	if (scope === "system") {
		return undefined;
	}

	const resolver = manifestValueResolvers[name];
	if (!resolver) {
		throw new Error(`Manifest built-in variable ${name} is missing a value resolver.`);
	}

	return resolver(projectSettings);
}

function getSimulationOperatingSystem() {
	const platform =
		typeof navigator === "undefined"
			? ""
			: String(
					(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
						navigator.platform,
				);
	const normalizedPlatform = platform.toLowerCase();

	if (normalizedPlatform.includes("win")) {
		return "windows";
	}

	if (normalizedPlatform.includes("mac")) {
		return "unsupported";
	}

	if (normalizedPlatform.includes("linux")) {
		return "linux";
	}

	return "simulated";
}

function getSimulationLocale() {
	if (typeof navigator !== "undefined" && navigator.language) {
		return navigator.language;
	}

	return "en-US";
}

function getSimulationTimeZone() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * RFC 3339 carrying the local offset, matching what the runner produces.
 *
 * toISOString would report UTC, so an author simulating at 14:30 local time
 * would see a different hour than a real run gives them.
 */
function toLocalIsoString(date: Date) {
	const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, "0");
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes < 0 ? "-" : "+";
	const offset = `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
	);
}
