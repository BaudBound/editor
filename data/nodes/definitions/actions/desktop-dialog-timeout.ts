import type { JsonValue } from "@/lib/types";

export function resolveDesktopDialogTimeout(
	value: JsonValue | undefined,
	resolveTemplate: (template: string) => unknown,
): number | string | undefined {
	if (value === undefined || String(value).trim() === "") return undefined;

	const resolved = resolveTemplate(String(value));
	const seconds = typeof resolved === "number" ? resolved : Number(resolved);
	return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400
		? seconds
		: "Timeout must resolve to a number greater than 0 and at most 86400 seconds.";
}

export function preserveDesktopDialogTimeout(
	source: Record<string, JsonValue>,
	target: Record<string, JsonValue>,
): Record<string, JsonValue> {
	if (source.timeoutSeconds !== undefined && String(source.timeoutSeconds).trim()) {
		target.timeoutSeconds = source.timeoutSeconds;
	}
	return target;
}
