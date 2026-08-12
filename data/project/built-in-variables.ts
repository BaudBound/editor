import type { ProjectIdentity } from "@/data/projects/model";
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
	| string[]
	| { type: "datetime"; value: string }
	| { type: "duration"; unit: string; value: number };

/**
 * What a `@manifest` field is resolved from.
 *
 * The id lives on the project identity rather than in the settings, so a
 * resolver given only the settings cannot answer it. `id` used to return
 * `settings.name` for exactly that reason, which meant `{{@manifest.id}}` read
 * the script's name in the editor and its real id in a run.
 */
export type ManifestVariableSource = {
	identity: ProjectIdentity;
	settings: ProjectSettings;
};
type BuiltInVariableRuntimeEntry = BuiltInVariable &
	EditorVariable<BuiltInVariableValue | undefined> & {
		scope: BuiltInVariableScope;
		value?: BuiltInVariableValue;
	};

/** The object each group is a field of, spelled once. */
export const MANIFEST_NAMESPACE = "@manifest";
export const SYSTEM_NAMESPACE = "@system";
export const SETTINGS_NAMESPACE = "@settings";

const manifestValueResolvers: Record<string, (source: ManifestVariableSource) => BuiltInVariableValue> = {
	id: ({ identity }) => identity.id,
	name: ({ settings }) => settings.name,
	// The script version the manifest declares. This used to report the
	// manifest format version, which is a different fact and not one an author
	// has any use for.
	version: ({ settings }) => settings.version,
	author: ({ settings }) => settings.author,
	description: ({ settings }) => settings.description,
	website: ({ settings }) => settings.website,
	source: ({ settings }) => settings.source,
	minimum_runner_version: ({ settings }) => settings.minimumRunnerVersion,
	// The repository a script is published to is deliberately absent. It is
	// distribution plumbing rather than something a script has any business
	// branching on, and `source` already answers where the script came from.
	// `package-contract` holds that decision.
	//
	// A datetime rather than the raw string, matching the runner, so the
	// component paths and the format patterns read it like any other datetime.
	created_at: ({ identity }) => ({ type: "datetime", value: identity.createdAt }),
	tags: ({ settings }) => settings.tags,
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
			manifestField(
				"created_at",
				"datetime",
				"When the script was first created, carrying the offset it was created in.",
				"2026-07-03T14:30:00+03:00",
			),
			manifestField("tags", "list", "Tags the script declares, in the order the author listed them.", "utility"),
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

/**
 * The `@system` fields that are readings rather than facts.
 *
 * Everything else in `@system` is fixed for a run and seeded once. These two
 * move, and a run is not short — `delay`, `repeat`, `while` and `for_each` all
 * exist — so they are rewritten into the object at every node execution. That
 * is the boundary the runner draws in `refresh_live_system_fields`, and writing
 * them into the object rather than answering per reference is what makes
 * `{{@system}}` and `{{@system.$count}}` agree with a direct field reference.
 */
export function liveSystemFieldValues(now = new Date()) {
	// A browser cannot see machine uptime, so this reports how long the editor
	// page has been open rather than inventing a number.
	const elapsed = typeof performance === "undefined" ? 0 : Math.trunc(performance.now());

	return {
		datetime: { type: "datetime", value: toLocalIsoString(now) },
		uptime: { type: "duration", unit: "milliseconds", value: elapsed },
	};
}

export const builtInVariableNames = new Set(
	builtInVariableGroups.flatMap((group) => group.variables.map((variable) => variable.name)),
);

export function createBuiltInVariableRuntimeContext(source: ManifestVariableSource) {
	const variables = getBuiltInVariableRuntimeEntries(source);

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

export function getBuiltInVariableRuntimeEntries(source: ManifestVariableSource): BuiltInVariableRuntimeEntry[] {
	return builtInVariableGroups.flatMap((group) =>
		group.variables.map((variable) => ({
			...variable,
			read_only: true,
			scope: group.id,
			source: "built_in",
			value: resolveBuiltInVariableValue(group.id, variable.name, source),
		})),
	);
}

/**
 * The namespace objects a simulated run starts with.
 *
 * `@system` is a plain object holding every field, the clock and the uptime
 * included, so nothing has to special-case a reference into it. Those two are
 * rewritten at each node execution by the simulator, the same boundary the
 * runner uses, so a delay or a loop sees them move.
 */
export function createSimulationBuiltInVariableValues(source: ManifestVariableSource, now = new Date()) {
	const manifest = Object.fromEntries(
		Object.entries(manifestValueResolvers).map(([name, resolver]) => [name, resolver(source)]),
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
			...liveSystemFieldValues(now),
		},
	};
}

function resolveBuiltInVariableValue(
	scope: BuiltInVariableScope,
	name: string,
	source: ManifestVariableSource,
): BuiltInVariableValue | undefined {
	if (scope === "system") {
		return undefined;
	}

	const field = name.slice(`${MANIFEST_NAMESPACE}.`.length);
	const resolver = manifestValueResolvers[field];
	if (!resolver) {
		throw new Error(`Manifest built-in variable ${name} is missing a value resolver.`);
	}

	return resolver(source);
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
