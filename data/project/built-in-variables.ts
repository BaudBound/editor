import type { ProjectSettings } from "@/lib/types";
import { DEFAULT_MINIMUM_RUNNER_VERSION } from "@/lib/version";
import type { EditorVariable } from "./variables";

/**
 * The values the runner supplies, grouped under the reserved `@` namespaces.
 *
 * `@` is not a legal identifier character, so a script cannot spell one of
 * these names and cannot shadow one. That is what replaced the old blocklist of
 * reserved `system_` and `manifest_` prefixes, and it is why those prefixes and
 * the bare name `settings` are ordinary variable names again.
 *
 * Each entry is one field of one object. The runtime holds `@system` and
 * `@manifest` as objects; the picker lists their fields, because a field is
 * what an author actually references.
 */

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
type BuiltInVariableValue =
	| string
	| number
	| { type: "datetime"; value: string }
	| { type: "duration"; unit: string; value: number };
type BuiltInVariableRuntimeEntry = BuiltInVariable &
	EditorVariable<BuiltInVariableValue | undefined> & {
		scope: BuiltInVariableScope;
		value?: BuiltInVariableValue;
	};

/** The object each group is a field of, spelled once. */
export const MANIFEST_NAMESPACE = "@manifest";
export const SYSTEM_NAMESPACE = "@system";
export const SETTINGS_NAMESPACE = "@settings";

const manifestValueResolvers: Record<string, (settings: ProjectSettings) => BuiltInVariableValue> = {
	id: (settings: ProjectSettings) => settings.name,
	name: (settings: ProjectSettings) => settings.name,
	// The script version the manifest declares. This used to report the
	// manifest format version, which is a different fact and not one an author
	// has any use for.
	version: (settings: ProjectSettings) => settings.version,
	author: (settings: ProjectSettings) => settings.author,
	description: (settings: ProjectSettings) => settings.description,
	website: (settings: ProjectSettings) => settings.website,
	source: (settings: ProjectSettings) => settings.source,
	minimum_runner_version: (settings: ProjectSettings) => settings.minimumRunnerVersion,
};

function manifestField(
	name: string,
	type: BuiltInVariable["type"],
	description: string,
	example: string,
): BuiltInVariable {
	return {
		name: `${MANIFEST_NAMESPACE}.${name}`,
		token: `{{${MANIFEST_NAMESPACE}.${name}}}`,
		type,
		description,
		example,
		runtimeBinding: `manifest.${name}`,
	};
}

function systemField(
	name: string,
	type: BuiltInVariable["type"],
	description: string,
	example: string,
): BuiltInVariable {
	return {
		name: `${SYSTEM_NAMESPACE}.${name}`,
		token: `{{${SYSTEM_NAMESPACE}.${name}}}`,
		type,
		description,
		example,
		runtimeBinding: `runner.system.${name}`,
	};
}

export const builtInVariableGroups: BuiltInVariableGroup[] = [
	{
		id: "manifest",
		label: "Manifest",
		description: "Values from the script manifest and project settings.",
		variables: [
			manifestField("id", "string", "Stable script identifier.", "8bb0c704-e663-491c-b96f-0af25bcea0ae"),
			manifestField("name", "string", "Current script name from project settings.", "server-health-check"),
			manifestField("version", "string", "Script version from project settings.", "1.0.0"),
			manifestField("author", "string", "Author from project settings.", "NATroutter"),
			manifestField(
				"description",
				"string",
				"Description from project settings.",
				"Checks server health and reports status.",
			),
			manifestField("website", "string", "Project website from project settings.", "https://example.com"),
			manifestField("source", "string", "Source URL from project settings.", "https://github.com/example/script"),
			manifestField(
				"minimum_runner_version",
				"string",
				"Minimum runner version required by the package.",
				DEFAULT_MINIMUM_RUNNER_VERSION,
			),
		],
	},
	{
		id: "system",
		label: "System",
		description: "Runner-provided values that are always available at execution time.",
		variables: [
			systemField("os", "string", "Operating system reported by the runner.", "windows"),
			systemField("os_name", "string", "Full operating system name.", "Windows 11 Pro"),
			systemField("os_version", "string", "Operating system or kernel version.", "10.0.26200"),
			systemField("arch", "string", "CPU architecture reported by the runner.", "x86_64"),
			systemField("hostname", "string", "Host name of the machine running the script.", "DESKTOP-01"),
			systemField("user", "string", "Current runner user name when the platform exposes it.", "runner"),
			systemField("locale", "string", "Locale reported by the runner environment.", "en-US"),
			systemField("timezone", "string", "Time zone reported by the runner environment.", "Europe/Helsinki"),
			systemField("cpu_count", "integer", "Number of logical CPUs the machine reports.", "16"),
			systemField("runner_version", "string", "Version of the runner executing the script.", "2.0.0"),
			systemField("run_id", "string", "Unique identifier for this run.", "script-1:n-trigger:1786365550532:110"),
			systemField("trigger_id", "string", "Node id of the trigger that started this run.", "n-trigger"),
			systemField("trigger_type", "string", "Action type of the trigger that started this run.", "trigger.manual"),
			systemField(
				"run_started_at",
				"datetime",
				"The clock when this run began. Unlike the datetime below it does not move, so two references to it always agree.",
				"2026-07-03T14:30:00+03:00",
			),
			systemField(
				"datetime",
				"datetime",
				"Current runner date and time, carrying the runner's local offset. Read once per node execution, so a loop or a delay sees the clock move.",
				"2026-07-03T14:30:00+03:00",
			),
			systemField(
				"uptime",
				"duration",
				"How long the machine has been running. Read once per node execution, like the datetime.",
				"3 days",
			),
		],
	},
];

/** The fields read afresh for each node execution rather than once per run. */
export const liveSystemFields = new Set(["datetime", "uptime"]);

export const builtInVariableNames = new Set(
	builtInVariableGroups.flatMap((group) => group.variables.map((variable) => variable.name)),
);

export function createBuiltInVariableRuntimeContext(projectSettings: ProjectSettings) {
	const variables = getBuiltInVariableRuntimeEntries(projectSettings);

	return {
		syntax: "{{@namespace.field}}",
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

/**
 * The namespace objects a simulated run starts with.
 *
 * Only the fields that cannot change during a run are seeded here. The clock
 * and the uptime are resolved per node execution by the simulator, the same
 * boundary the runner uses, so a delay or a loop sees them move.
 */
export function createSimulationBuiltInVariableValues(projectSettings: ProjectSettings, now = new Date()) {
	const manifest = Object.fromEntries(
		Object.entries(manifestValueResolvers).map(([name, resolver]) => [name, resolver(projectSettings)]),
	);

	return {
		[MANIFEST_NAMESPACE]: manifest,
		[SYSTEM_NAMESPACE]: {
			os: getSimulationOperatingSystem(),
			os_name: getSimulationOperatingSystem(),
			os_version: "simulated",
			arch: "simulated",
			hostname: "simulator",
			user: "simulator",
			locale: getSimulationLocale(),
			timezone: getSimulationTimeZone(),
			cpu_count: getSimulationCpuCount(),
			runner_version: DEFAULT_MINIMUM_RUNNER_VERSION,
			run_id: `simulation:${now.getTime()}`,
			trigger_id: "",
			trigger_type: "",
			run_started_at: { type: "datetime", value: toLocalIsoString(now) },
		},
	};
}

/** One live `@system` field, read at the moment a node execution asks for it. */
export function readLiveSystemField(field: string, now = new Date()) {
	if (field === "datetime") {
		return { type: "datetime", value: toLocalIsoString(now) };
	}

	if (field === "uptime") {
		// A browser cannot see machine uptime, so this reports how long the
		// editor page has been open rather than inventing a number.
		const elapsed = typeof performance === "undefined" ? 0 : Math.trunc(performance.now());
		return { type: "duration", unit: "milliseconds", value: elapsed };
	}

	return undefined;
}

function resolveBuiltInVariableValue(
	scope: BuiltInVariableScope,
	name: string,
	projectSettings: ProjectSettings,
): BuiltInVariableValue | undefined {
	if (scope === "system") {
		return undefined;
	}

	const field = name.slice(`${MANIFEST_NAMESPACE}.`.length);
	const resolver = manifestValueResolvers[field];
	if (!resolver) {
		throw new Error(`Manifest built-in variable ${name} is missing a value resolver.`);
	}

	return resolver(projectSettings);
}

function getSimulationCpuCount() {
	return typeof navigator === "undefined" ? 1 : (navigator.hardwareConcurrency ?? 1);
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
