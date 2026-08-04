import type { SafeRegexRequest, SafeRegexResult, SafeRegexResultFor } from "./safe-regex-engine";

type SafeRegexWorkerResponse = { ok: true; result: SafeRegexResult } | { message: string; ok: false };

export function runSafeRegexInWorker<TRequest extends SafeRegexRequest>(
	request: TRequest,
	signal?: AbortSignal,
): Promise<SafeRegexResultFor<TRequest>> {
	if (signal?.aborted) return Promise.reject(createAbortError());

	return new Promise<SafeRegexResultFor<TRequest>>((resolve, reject) => {
		const worker = new Worker(new URL("./safe-regex.worker.ts", import.meta.url), { type: "module" });
		let settled = false;
		const finish = (result: { value: SafeRegexResultFor<TRequest> } | { error: unknown }) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", handleAbort);
			worker.terminate();
			"value" in result ? resolve(result.value) : reject(result.error);
		};
		const handleAbort = () => finish({ error: createAbortError() });

		worker.onmessage = (event: MessageEvent<SafeRegexWorkerResponse>) => {
			const response = event.data;
			if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
				finish({ error: new Error("Regular expression worker returned an invalid response.") });
				return;
			}
			if (!response.ok) {
				finish({ error: new Error(response.message) });
				return;
			}
			if (!isExpectedResult(request, response.result)) {
				finish({ error: new Error("Regular expression worker returned an invalid result.") });
				return;
			}
			finish({ value: response.result });
		};
		worker.onerror = (event) => {
			event.preventDefault();
			finish({ error: new Error(event.message || "Regular expression worker failed.") });
		};
		worker.onmessageerror = () =>
			finish({ error: new Error("Regular expression worker response could not be decoded.") });
		signal?.addEventListener("abort", handleAbort, { once: true });
		worker.postMessage(request);
	});
}

function isExpectedResult<TRequest extends SafeRegexRequest>(
	request: TRequest,
	result: SafeRegexResult,
): result is SafeRegexResultFor<TRequest> {
	if (!result || typeof result !== "object") return false;
	return request.operation === "match"
		? "matched" in result && typeof result.matched === "boolean"
		: "value" in result && typeof result.value === "string";
}

function createAbortError() {
	return new DOMException("Regular expression execution was cancelled.", "AbortError");
}
