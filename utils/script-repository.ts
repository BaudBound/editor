import type { CapabilitySummary, PermissionSummary, ProjectSettings, RiskLevel, TargetRuntime } from "@/lib/types";

export const SCRIPT_REPOSITORY_FORMAT = "baudbound.repository" as const;
export const SCRIPT_REPOSITORY_FORMAT_VERSION = 1 as const;
export const DEFAULT_SCRIPT_VERSION = "1.0.0";
export const MAX_RELEASE_NOTES_BYTES = 8_000;
export const MAX_REPOSITORY_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_FILENAME_LENGTH = 240;
const windowsReservedFilenamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const allowedTargetRuntimes = new Set<TargetRuntime>([
	"Windows Desktop",
	"Windows Headless",
	"Linux Desktop",
	"Linux Headless",
]);

export type ScriptRepositoryDocument = {
	format: typeof SCRIPT_REPOSITORY_FORMAT;
	format_version: typeof SCRIPT_REPOSITORY_FORMAT_VERSION;
	name: string;
	description?: string;
	homepage?: string;
	scripts: ScriptRepositoryEntry[];
};

export type ScriptRepositoryEntry = {
	script_id: string;
	name: string;
	summary: string;
	description?: string;
	author?: string;
	website?: string;
	source?: string;
	license?: string;
	target_runtimes: TargetRuntime[];
	minimum_runner_version: string;
	risk_level: RiskLevel;
	tags: string[];
	permissions: string[];
	capabilities: string[];
	latest: ScriptRepositoryRelease;
};

export type ScriptRepositoryRelease = {
	version: string;
	package_url: string;
	sha256: string;
	size: number;
	published_at: string;
	release_notes: string;
};

const semanticVersionPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSemanticVersion(value: string) {
	return utf8Length(value) <= 128 && semanticVersionPattern.test(value);
}

export function getScriptVersionError(value: string) {
	if (!value.trim()) return "Script version is required.";
	if (value !== value.trim()) return "Script version cannot start or end with spaces.";
	return isSemanticVersion(value) ? "" : "Use a semantic version such as 1.0.0.";
}

export function getRepositoryUrlError(value: string) {
	if (!value.trim()) return "";
	return validateRemoteUrl(value, "repository.json");
}

export function getDirectPackageUrlError(value: string) {
	if (!value.trim()) return "Package URL is required.";
	return validateRemoteUrl(value, ".bbs");
}

export function createScriptPackageFilename(name: string, version: string) {
	const versionError = getScriptVersionError(version);
	if (versionError) throw new Error(versionError);

	let safeName =
		name
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "untitled-script";
	if (windowsReservedFilenamePattern.test(safeName)) {
		safeName = `script-${safeName}`;
	}

	const suffix = `-${version}.bbs`;
	const maximumNameLength = Math.max(1, MAX_PACKAGE_FILENAME_LENGTH - suffix.length);
	safeName = safeName.slice(0, maximumNameLength).replace(/-+$/g, "") || "script";
	return `${safeName}${suffix}`;
}

export async function createScriptRepositoryDocument(params: {
	bytes: Uint8Array;
	capabilities: CapabilitySummary[];
	packageUrl: string;
	permissions: PermissionSummary[];
	projectSettings: ProjectSettings;
	repositoryDescription: string;
	repositoryHomepage: string;
	repositoryName: string;
	releaseNotes: string;
	riskLevel: RiskLevel;
	scriptId: string;
	publishedAt?: Date;
}): Promise<ScriptRepositoryDocument> {
	const packageUrlError = getDirectPackageUrlError(params.packageUrl);
	if (packageUrlError) throw new Error(packageUrlError);
	const versionError = getScriptVersionError(params.projectSettings.version);
	if (versionError) throw new Error(versionError);
	if (!uuidPattern.test(params.scriptId)) throw new Error("Project ID must be a UUID.");
	if (params.bytes.byteLength === 0) throw new Error("The generated package is empty.");
	validateBoundedText("Repository name", params.repositoryName, 160, false);
	validateBoundedText("Repository description", params.repositoryDescription, 4_000, true);
	validateBoundedText("Release notes", params.releaseNotes, MAX_RELEASE_NOTES_BYTES, true);
	const repositoryHomepage = params.repositoryHomepage.trim();
	if (repositoryHomepage) {
		const homepageErrors: string[] = [];
		validateOptionalUrl(homepageErrors, "Repository homepage", repositoryHomepage);
		if (homepageErrors.length > 0) throw new Error(homepageErrors.join(" "));
	}

	const settings = params.projectSettings;
	const description = settings.description.trim();
	const author = settings.author.trim();
	const website = settings.website.trim();
	const source = settings.source.trim();
	const repository: ScriptRepositoryDocument = {
		format: SCRIPT_REPOSITORY_FORMAT,
		format_version: SCRIPT_REPOSITORY_FORMAT_VERSION,
		name: params.repositoryName.trim(),
		...(params.repositoryDescription.trim() ? { description: params.repositoryDescription.trim() } : {}),
		...(repositoryHomepage ? { homepage: repositoryHomepage } : {}),
		scripts: [
			{
				script_id: params.scriptId,
				name: settings.name.trim(),
				summary: repositorySummary(settings.name, description),
				...(description ? { description } : {}),
				...(author ? { author } : {}),
				...(website ? { website } : {}),
				...(source ? { source } : {}),
				target_runtimes: [...settings.targetRuntimes],
				minimum_runner_version: settings.minimumRunnerVersion,
				risk_level: params.riskLevel,
				tags: [...settings.tags],
				permissions: params.permissions.map((permission) => permission.name),
				capabilities: params.capabilities.map((capability) => capability.name),
				latest: {
					version: settings.version,
					package_url: params.packageUrl.trim(),
					sha256: await sha256Hex(params.bytes),
					size: params.bytes.byteLength,
					published_at: (params.publishedAt ?? new Date()).toISOString(),
					release_notes: params.releaseNotes,
				},
			},
		],
	};

	const errors = validateScriptRepositoryDocument(repository);
	if (errors.length > 0) throw new Error(errors.join(" "));
	const encoded = new TextEncoder().encode(JSON.stringify(repository));
	if (encoded.byteLength > MAX_REPOSITORY_BYTES) {
		throw new Error(`Repository JSON cannot exceed ${MAX_REPOSITORY_BYTES} bytes.`);
	}
	return repository;
}

export function validateScriptRepositoryDocument(value: unknown) {
	const errors: string[] = [];
	if (!isRecord(value)) return ["Repository must be an object."];
	validateKeys(
		value,
		["format", "format_version", "name", "description", "homepage", "scripts"],
		["format", "format_version", "name", "scripts"],
		"Repository",
		errors,
	);
	if (value.format !== SCRIPT_REPOSITORY_FORMAT) errors.push("Repository format is unsupported.");
	if (value.format_version !== SCRIPT_REPOSITORY_FORMAT_VERSION) {
		errors.push("Repository format version is unsupported.");
	}
	validateTextValue(errors, "Repository name", value.name, 160, false);
	validateOptionalTextValue(errors, "Repository description", value.description, 4_000, true);
	validateOptionalUrl(errors, "Repository homepage", value.homepage);
	if (!Array.isArray(value.scripts) || value.scripts.length < 1 || value.scripts.length > 1_000) {
		errors.push("Repository scripts must contain between 1 and 1000 entries.");
		return errors;
	}

	const scriptIds = new Set<string>();
	value.scripts.forEach((script, index) => {
		validateRepositoryScript(script, index, scriptIds, errors);
	});
	return errors;
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
	const blob = new Blob([bytes.slice().buffer], { type });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	try {
		link.href = url;
		link.download = filename;
		link.hidden = true;
		document.body.append(link);
		link.click();
	} finally {
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}
}

function validateRepositoryScript(value: unknown, index: number, scriptIds: Set<string>, errors: string[]) {
	const label = `Repository script ${index + 1}`;
	if (!isRecord(value)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	const optionalKeys = ["description", "author", "website", "source", "license"];
	const requiredKeys = [
		"script_id",
		"name",
		"summary",
		"target_runtimes",
		"minimum_runner_version",
		"risk_level",
		"tags",
		"permissions",
		"capabilities",
		"latest",
	];
	validateKeys(value, [...requiredKeys, ...optionalKeys], requiredKeys, label, errors);
	if (typeof value.script_id !== "string" || !uuidPattern.test(value.script_id)) {
		errors.push(`${label} script_id must be a UUID.`);
	} else if (scriptIds.has(value.script_id)) {
		errors.push(`${label} duplicates script_id ${value.script_id}.`);
	} else {
		scriptIds.add(value.script_id);
	}
	validateTextValue(errors, `${label} name`, value.name, 128, false);
	validateTextValue(errors, `${label} summary`, value.summary, 500, false);
	validateOptionalTextValue(errors, `${label} description`, value.description, 4_000, true);
	validateOptionalTextValue(errors, `${label} author`, value.author, 128, false);
	validateOptionalTextValue(errors, `${label} license`, value.license, 128, false);
	validateOptionalUrl(errors, `${label} website`, value.website);
	validateOptionalUrl(errors, `${label} source`, value.source);
	if (!Array.isArray(value.target_runtimes) || value.target_runtimes.length === 0) {
		errors.push(`${label} target_runtimes must contain at least one target runtime.`);
	} else {
		const seenRuntimes = new Set<string>();
		for (const runtime of value.target_runtimes) {
			if (typeof runtime !== "string" || !allowedTargetRuntimes.has(runtime as TargetRuntime)) {
				errors.push(`${label} target_runtimes contains unsupported value ${String(runtime)}.`);
				continue;
			}
			if (seenRuntimes.has(runtime)) {
				errors.push(`${label} target_runtimes contains duplicate value ${runtime}.`);
			}
			seenRuntimes.add(runtime);
		}
	}
	if (typeof value.minimum_runner_version !== "string" || !isSemanticVersion(value.minimum_runner_version)) {
		errors.push(`${label} minimum_runner_version must be a semantic version.`);
	}
	if (!["low", "medium", "high", "dangerous"].includes(String(value.risk_level))) {
		errors.push(`${label} risk_level is unsupported.`);
	}
	validateStringArray(errors, `${label} tags`, value.tags, 20, 64);
	validateStringArray(errors, `${label} permissions`, value.permissions, 64, 128);
	validateStringArray(errors, `${label} capabilities`, value.capabilities, 64, 128);
	validateRepositoryRelease(value.latest, label, errors);
}

function validateRepositoryRelease(value: unknown, scriptLabel: string, errors: string[]) {
	const label = `${scriptLabel} latest release`;
	if (!isRecord(value)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	const keys = ["version", "package_url", "sha256", "size", "published_at", "release_notes"];
	validateKeys(value, keys, keys, label, errors);
	if (typeof value.version !== "string" || !isSemanticVersion(value.version)) {
		errors.push(`${label} version must be a semantic version.`);
	}
	if (typeof value.package_url !== "string") {
		errors.push(`${label} package_url must be a string.`);
	} else {
		const error = getDirectPackageUrlError(value.package_url);
		if (error) errors.push(`${label}: ${error}`);
	}
	if (typeof value.sha256 !== "string" || !sha256Pattern.test(value.sha256)) {
		errors.push(`${label} SHA-256 must contain 64 lowercase hexadecimal characters.`);
	}
	if (!Number.isSafeInteger(value.size) || (value.size as number) < 1) {
		errors.push(`${label} package size must be a positive safe integer.`);
	}
	if (typeof value.published_at !== "string" || !isUtcTimestamp(value.published_at)) {
		errors.push(`${label} published_at must be a UTC timestamp.`);
	}
	validateTextValue(errors, `${label} release notes`, value.release_notes, MAX_RELEASE_NOTES_BYTES, true);
}

function validateRemoteUrl(value: string, requiredFilename: "repository.json" | ".bbs") {
	if (utf8Length(value) > 2048) return "URL cannot exceed 2048 bytes.";
	if (value !== value.trim()) return "URL cannot start or end with spaces.";
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return "Use an HTTPS URL.";
		if (!url.hostname) return "URL must include a host.";
		if (url.username || url.password) return "URL cannot contain a username or password.";
		if (url.hash) return "URL cannot contain a fragment.";
		const lastSegment = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
		if (requiredFilename === "repository.json" && lastSegment !== requiredFilename) {
			return "Repository URL must point to a file named repository.json.";
		}
		if (requiredFilename === ".bbs" && !lastSegment.toLowerCase().endsWith(requiredFilename)) {
			return "Package URL must point to a .bbs file.";
		}
		return "";
	} catch {
		return "Use a valid URL.";
	}
}

function repositorySummary(name: string, description: string) {
	const source =
		description
			.split(/\r?\n\r?\n/, 1)[0]
			?.replace(/\s+/g, " ")
			.trim() || name.trim();
	return truncateUtf8(source, 500);
}

function validateOptionalUrl(errors: string[], label: string, value: unknown) {
	if (value === undefined) return;
	if (typeof value !== "string") {
		errors.push(`${label} must be a string.`);
		return;
	}
	if (utf8Length(value) > 2048) {
		errors.push(`${label} cannot exceed 2048 bytes.`);
		return;
	}
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
			throw new Error("unsafe URL");
		}
	} catch {
		errors.push(`${label} must be a public HTTPS URL without credentials or a fragment.`);
	}
}

function validateOptionalTextValue(
	errors: string[],
	label: string,
	value: unknown,
	maximumBytes: number,
	allowWhitespace: boolean,
) {
	if (value === undefined) return;
	validateTextValue(errors, label, value, maximumBytes, allowWhitespace);
}

function validateTextValue(
	errors: string[],
	label: string,
	value: unknown,
	maximumBytes: number,
	allowWhitespace: boolean,
) {
	if (typeof value !== "string") {
		errors.push(`${label} must be a string.`);
		return;
	}
	try {
		validateBoundedText(label, value, maximumBytes, allowWhitespace);
	} catch (error) {
		errors.push(error instanceof Error ? error.message : `${label} is invalid.`);
	}
}

function validateBoundedText(label: string, value: string, maximumBytes: number, allowWhitespace: boolean) {
	if (!allowWhitespace && !value.trim()) throw new Error(`${label} is required.`);
	if (utf8Length(value) > maximumBytes) {
		throw new Error(`${label} cannot exceed ${maximumBytes} bytes.`);
	}
	if (containsUnsafeTextCharacters(value)) {
		throw new Error(`${label} contains unsupported control characters.`);
	}
}

function validateStringArray(
	errors: string[],
	label: string,
	value: unknown,
	maximumItems: number,
	maximumItemBytes: number,
) {
	if (!Array.isArray(value) || value.length > maximumItems) {
		errors.push(`${label} must be an array with no more than ${maximumItems} entries.`);
		return;
	}
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string" || !item.trim() || utf8Length(item) > maximumItemBytes) {
			errors.push(`${label} contains an invalid entry.`);
			continue;
		}
		if (seen.has(item)) errors.push(`${label} contains duplicate entry ${item}.`);
		seen.add(item);
	}
}

function validateKeys(
	value: Record<string, unknown>,
	allowedKeys: string[],
	requiredKeys: string[],
	label: string,
	errors: string[],
) {
	const allowed = new Set(allowedKeys);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) errors.push(`${label} contains unknown field ${key}.`);
	}
	for (const key of requiredKeys) {
		if (!(key in value)) errors.push(`${label} is missing ${key}.`);
	}
}

async function sha256Hex(bytes: Uint8Array) {
	const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isUtcTimestamp(value: string) {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function truncateUtf8(value: string, maximumBytes: number) {
	let result = "";
	for (const character of value) {
		if (utf8Length(result + character) > maximumBytes) break;
		result += character;
	}
	return result;
}

function utf8Length(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsUnsafeTextCharacters(value: string) {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		const allowedWhitespace = character === "\n" || character === "\r" || character === "\t";
		const controlCharacter = (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) && !allowedWhitespace;
		const bidiControl =
			codePoint === 0x061c ||
			codePoint === 0x200e ||
			codePoint === 0x200f ||
			(codePoint >= 0x202a && codePoint <= 0x202e) ||
			(codePoint >= 0x2066 && codePoint <= 0x2069);
		if (controlCharacter || bidiControl) return true;
	}
	return false;
}
