import type { Node } from "@xyflow/react";
import { Clock, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { EditorVariable } from "@/data/project/variables";
import type { ScriptNodeData, SimulationRunStatus, SimulationTriggerPayload } from "@/lib/types";
import { advanceScheduleDeadline } from "./schedule-cadence";

type ScheduleTriggerStatusProps = {
	active: boolean;
	startDisabled: boolean;
	status: SimulationRunStatus;
	triggerNode: Node<ScriptNodeData>;
	variables: EditorVariable[];
	onStart: () => void;
	onStop: () => void;
	onTrigger: (triggerNodeId: string, payload: SimulationTriggerPayload) => void;
};

const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

export function ScheduleTriggerStatus({
	active,
	startDisabled,
	status,
	triggerNode,
	variables,
	onStart,
	onStop,
	onTrigger,
}: ScheduleTriggerStatusProps) {
	const intervalMs = getScheduleIntervalMs(triggerNode, variables);
	const statusRef = useRef(status);
	const triggerRef = useRef(onTrigger);
	const [lastRunAt, setLastRunAt] = useState<number | null>(null);
	const [nextRunAt, setNextRunAt] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());

	statusRef.current = status;
	triggerRef.current = onTrigger;

	useEffect(() => {
		if (!active) {
			setNextRunAt(null);
			return;
		}

		setNow(Date.now());
		const tickId = window.setInterval(() => setNow(Date.now()), 500);
		return () => window.clearInterval(tickId);
	}, [active]);

	useEffect(() => {
		if (!active || intervalMs === null) {
			setNextRunAt(null);
			return;
		}

		let timeoutId: number | null = null;
		let cancelled = false;
		const wallClockOffsetMs = Date.now() - performance.now();
		let nextDeadlineMs = performance.now() + intervalMs;

		const scheduleNext = () => {
			if (cancelled) {
				return;
			}

			setNextRunAt(wallClockOffsetMs + nextDeadlineMs);
			const remainingMs = nextDeadlineMs - performance.now();
			timeoutId = window.setTimeout(
				() => {
					if (cancelled) {
						return;
					}

					const firedAtMonotonic = performance.now();
					if (firedAtMonotonic < nextDeadlineMs) {
						scheduleNext();
						return;
					}

					if (statusRef.current === "waiting") {
						const firedAt = Date.now();
						setLastRunAt(firedAt);
						triggerRef.current(triggerNode.id, {});
					}

					nextDeadlineMs = advanceScheduleDeadline(nextDeadlineMs, firedAtMonotonic, intervalMs).nextDeadlineMs;
					scheduleNext();
				},
				Math.min(Math.max(1, remainingMs), MAX_BROWSER_TIMEOUT_MS),
			);
		};

		scheduleNext();

		return () => {
			cancelled = true;
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [active, intervalMs, triggerNode.id]);

	return (
		<div
			className="space-y-2 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs text-baud-muted"
			data-schedule-last-run-at={lastRunAt ?? undefined}
			data-schedule-next-run-at={nextRunAt ?? undefined}
			data-schedule-status={triggerNode.id}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-baud-text">
					<Clock size={13} />
					<span className="font-semibold">Schedule simulation</span>
				</div>
				<Button
					type="button"
					aria-label={active ? "Stop Schedule" : "Start Schedule"}
					disabled={!active && (startDisabled || intervalMs === null)}
					size="sm"
					title={
						intervalMs === null
							? "Enter a valid schedule interval before starting."
							: startDisabled
								? "Stop the active simulation before starting this schedule."
								: undefined
					}
					variant={active ? "destructive" : "toolbarActive"}
					onClick={active ? onStop : onStart}
				>
					{active ? <Square size={13} /> : <Play size={13} />}
					{active ? "Stop Schedule" : "Start Schedule"}
				</Button>
			</div>
			{intervalMs === null && <div className="text-baud-danger">The configured interval cannot be simulated.</div>}
			<div className="grid gap-2 font-mono sm:grid-cols-3">
				<ScheduleTime label="Last" value={lastRunAt ? formatTime(lastRunAt) : "not yet"} />
				<ScheduleTime label="Next" value={nextRunAt ? formatTime(nextRunAt) : active ? "scheduling" : "inactive"} />
				<ScheduleTime
					label="In"
					value={nextRunAt && active ? formatDuration(Math.max(0, nextRunAt - now)) : "inactive"}
				/>
			</div>
		</div>
	);
}

function ScheduleTime({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded border border-baud-border bg-baud-panel px-2 py-1.5">
			<div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-baud-muted">{label}</div>
			<div className="text-baud-text">{value}</div>
		</div>
	);
}

function getScheduleIntervalMs(triggerNode: Node<ScriptNodeData>, variables: EditorVariable[]) {
	const every = resolveScheduleValue(triggerNode.data.config.every, variables);
	const unit = String(triggerNode.data.config.unit ?? "seconds");
	const unitMultiplier = getScheduleUnitMultiplier(unit);
	const intervalMs = every * unitMultiplier;

	if (!Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > Number.MAX_SAFE_INTEGER) {
		return null;
	}

	return Math.max(1, Math.round(intervalMs));
}

function resolveScheduleValue(value: unknown, variables: EditorVariable[]) {
	if (typeof value === "number") {
		return value;
	}
	if (typeof value !== "string") {
		return Number.NaN;
	}

	const trimmed = value.trim();
	const variable = variables.find((candidate) => candidate.preTrigger && candidate.token === trimmed);
	return Number(variable ? variable.value : trimmed);
}

function getScheduleUnitMultiplier(unit: string) {
	if (unit === "milliseconds") {
		return 1;
	}

	if (unit === "days") {
		return 24 * 60 * 60 * 1000;
	}

	if (unit === "hours") {
		return 60 * 60 * 1000;
	}

	if (unit === "minutes") {
		return 60 * 1000;
	}

	return 1000;
}

function formatTime(value: number) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "far future";
	}

	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).format(date);
}

function formatDuration(milliseconds: number) {
	if (milliseconds < 1000) {
		return `${Math.max(1, Math.ceil(milliseconds))}ms`;
	}

	const totalSeconds = Math.ceil(milliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}

	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}

	return `${seconds}s`;
}
