import type { TargetRuntime } from "@/lib/types";

export const targetRuntimes: TargetRuntime[] = [
	"Linux Headless",
	"Windows Headless",
	"Windows Desktop",
	"Linux Desktop",
];

export function isDesktopTargetRuntime(targetRuntime: TargetRuntime) {
	return targetRuntime.endsWith("Desktop");
}
