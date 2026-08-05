"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function useSimulationDialogTimeout(
	timeoutSeconds: number | undefined,
	requestId: string | null,
	onTimeout: () => void,
) {
	const callbackRef = useRef(onTimeout);
	const [deadline, setDeadline] = useState<number | null>(null);

	useEffect(() => {
		callbackRef.current = onTimeout;
	}, [onTimeout]);

	useEffect(() => {
		if (!requestId || !timeoutSeconds) {
			setDeadline(null);
			return;
		}

		const nextDeadline = Date.now() + timeoutSeconds * 1_000;
		setDeadline(nextDeadline);
		const timeoutId = window.setTimeout(() => callbackRef.current(), Math.max(0, nextDeadline - Date.now()));
		return () => window.clearTimeout(timeoutId);
	}, [requestId, timeoutSeconds]);

	return deadline;
}

export function SimulationDialogTimeoutCountdown({ deadline }: { deadline: number | null }) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (deadline === null) return;
		setNow(Date.now());
		const intervalId = window.setInterval(() => setNow(Date.now()), 250);
		return () => window.clearInterval(intervalId);
	}, [deadline]);

	if (deadline === null) return <span />;

	const remainingSeconds = Math.max(0, Math.ceil((deadline - now) / 1_000));
	return (
		<span className="flex min-w-0 items-center gap-1.5 text-xs text-baud-muted" role="timer">
			<Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
			<span>{remainingSeconds > 0 ? `Times out in ${formatDuration(remainingSeconds)}` : "Timing out..."}</span>
		</span>
	);
}

export function formatDuration(totalSeconds: number) {
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
	const hours = Math.floor(totalMinutes / 60);
	return `${hours}:${String(totalMinutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
