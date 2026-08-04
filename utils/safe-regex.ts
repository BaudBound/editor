import {
	executeSafeRegex,
	type SafeRegexRequest,
	type SafeRegexResultFor,
	validateSafeRegexPattern,
} from "./safe-regex-engine";

export { validateSafeRegexPattern };

export async function runSafeRegex<TRequest extends SafeRegexRequest>(
	request: TRequest,
	signal?: AbortSignal,
): Promise<SafeRegexResultFor<TRequest>> {
	const validationError = validateSafeRegexPattern(request.pattern);
	if (validationError) throw new Error(validationError);
	if (signal?.aborted) throw createAbortError();

	if (typeof window === "undefined") {
		return executeSafeRegex(request) as SafeRegexResultFor<TRequest>;
	}
	if (typeof Worker === "undefined") {
		throw new Error("This browser cannot run isolated regular expression tasks.");
	}
	const { runSafeRegexInWorker } = await import("./safe-regex-browser");
	return runSafeRegexInWorker(request, signal);
}

function createAbortError() {
	return new DOMException("Regular expression execution was cancelled.", "AbortError");
}
