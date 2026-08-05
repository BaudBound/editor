import type { JsonValue, PermissionSummary } from "@/lib/types";

const sensitivePathMarkers = [
	"/.aws/",
	"/.azure/",
	"/.config/",
	"/.docker/",
	"/.gnupg/",
	"/.kube/",
	"/.ssh/",
	"/etc/",
	"/root/",
	"/var/lib/",
	"/windows/system32/",
	"/windows/syswow64/",
	"/programdata/",
	"/appdata/local/",
	"/appdata/roaming/",
];

export const fileReadPermission: PermissionSummary = { name: "file.read", risk: "medium" };
export const readSensitiveFilePermission: PermissionSummary = { name: "file.read.any", risk: "dangerous" };
export const fileWatchLimitedPermission: PermissionSummary = { name: "file.watch.limited", risk: "medium" };
export const watchAnyFilePermission: PermissionSummary = { name: "file.watch.any", risk: "dangerous" };
export const fileWriteLimitedPermission: PermissionSummary = { name: "file.write.limited", risk: "high" };
export const writeAnyFilePermission: PermissionSummary = { name: "file.write.any", risk: "dangerous" };
export const fileDeleteLimitedPermission: PermissionSummary = { name: "file.delete.limited", risk: "high" };
export const deleteAnyFilePermission: PermissionSummary = { name: "file.delete.any", risk: "dangerous" };

export function createReadFilePermission(path: JsonValue | undefined): PermissionSummary {
	return isSensitiveOrUnboundedPath(configString(path)) ? readSensitiveFilePermission : fileReadPermission;
}

export function createWatchFilePermission(path: JsonValue | undefined): PermissionSummary {
	return isSensitiveOrUnboundedPath(configString(path)) ? watchAnyFilePermission : fileWatchLimitedPermission;
}

export function createWriteFilePermission(path: JsonValue | undefined): PermissionSummary {
	return isUnboundedWritePath(configString(path)) ? writeAnyFilePermission : fileWriteLimitedPermission;
}

export function createDeleteFilePermission(path: JsonValue | undefined): PermissionSummary {
	return isUnboundedWritePath(configString(path)) ? deleteAnyFilePermission : fileDeleteLimitedPermission;
}

export function isSensitiveOrUnboundedPath(path: string) {
	const normalized = normalizePathForPolicy(path);
	if (!normalized) {
		return false;
	}

	return (
		pathUsesRuntimeData(path) ||
		isAbsolutePath(normalized) ||
		containsParentTraversal(normalized) ||
		containsWindowsEscapeSegment(normalized) ||
		isSensitivePath(normalized)
	);
}

export function isUnboundedWritePath(path: string) {
	const normalized = normalizePathForPolicy(path);
	if (!normalized) {
		return false;
	}

	return (
		pathUsesRuntimeData(path) ||
		isAbsolutePath(normalized) ||
		containsParentTraversal(normalized) ||
		containsWindowsEscapeSegment(normalized) ||
		isSensitivePath(normalized)
	);
}

function isSensitivePath(normalizedPath: string) {
	return sensitivePathMarkers.some((marker) => normalizedPath.includes(marker));
}

function isAbsolutePath(normalizedPath: string) {
	return normalizedPath.startsWith("/") || normalizedPath === "~" || normalizedPath.startsWith("~/");
}

function containsParentTraversal(normalizedPath: string) {
	return normalizedPath.split("/").some((component) => component === "..");
}

/**
 * Reports whether any segment escapes the workspace on Windows.
 *
 * A colon is either a drive prefix such as `C:report.txt`, which resolves
 * against that drive's current directory, or an alternate data stream such as
 * `notes.txt:hidden`, which writes to a hidden stream of another file. A
 * reserved device name resolves to a device wherever it appears.
 *
 * These are checked on every platform because a package authored on Linux can
 * be installed on Windows. Classifying them differently would make the risk
 * depend on the machine that built the package.
 */
function containsWindowsEscapeSegment(normalizedPath: string) {
	return normalizedPath
		.split("/")
		.filter((segment) => segment.length > 0)
		.some((segment) => segment.includes(":") || isReservedDeviceName(segment));
}

function isReservedDeviceName(segment: string) {
	const stem = segment.split(".")[0]?.replace(/[ .]+$/, "") ?? "";
	if (["con", "prn", "aux", "nul"].includes(stem)) {
		return true;
	}

	return stem.length === 4 && (stem.startsWith("com") || stem.startsWith("lpt")) && /^[0-9]$/.test(stem[3] ?? "");
}

function pathUsesRuntimeData(path: string) {
	return path.includes("{{") && path.includes("}}");
}

function normalizePathForPolicy(path: string) {
	return path.trim().replaceAll("\\", "/").replaceAll(/\/+/g, "/").toLowerCase();
}

function configString(value: JsonValue | undefined) {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}
