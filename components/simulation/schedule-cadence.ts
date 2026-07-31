export type ScheduleAdvance = {
	missedIntervals: number;
	nextDeadlineMs: number;
};

export function advanceScheduleDeadline(deadlineMs: number, nowMs: number, intervalMs: number): ScheduleAdvance {
	const overdueMs = Math.max(0, nowMs - deadlineMs);
	const missedIntervals = Math.floor(overdueMs / intervalMs);

	return {
		missedIntervals,
		nextDeadlineMs: deadlineMs + (missedIntervals + 1) * intervalMs,
	};
}
