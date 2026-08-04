import type { JsonValue } from "@/lib/types";

export type AuthorizedSimulationHttpRequest = {
	authorizedOrigins: readonly string[];
	body: string;
	headers: Headers;
	method: string;
	timeoutMs: number;
	url: string;
};

export async function sendAuthorizedSimulationHttpRequest(
	request: AuthorizedSimulationHttpRequest,
	signal: AbortSignal,
) {
	const response = await fetch("/api/simulation/http", {
		body: JSON.stringify({
			authorizedOrigins: request.authorizedOrigins,
			body: request.body,
			headers: Object.fromEntries(request.headers.entries()),
			method: request.method,
			timeoutMs: request.timeoutMs,
			url: request.url,
		}),
		credentials: "same-origin",
		headers: { "content-type": "application/json" },
		method: "POST",
		signal,
	});
	const payload = (await response.json()) as unknown;
	if (!response.ok) {
		const details = isRecord(payload) ? payload : {};
		throw new SimulationHttpClientError(
			typeof details.message === "string" ? details.message : "Simulation HTTP request failed.",
			typeof details.code === "string" ? details.code : "HTTP_REQUEST_FAILED",
		);
	}
	if (!isSimulationHttpResponse(payload)) {
		throw new SimulationHttpClientError("Simulation HTTP service returned an invalid response.", "INVALID_RESPONSE");
	}
	return payload;
}

export class SimulationHttpClientError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "SimulationHttpClientError";
	}
}

function isSimulationHttpResponse(
	value: unknown,
): value is { body: string; headers: Record<string, JsonValue>; statusCode: number; statusText: string } {
	return (
		isRecord(value) &&
		typeof value.body === "string" &&
		isStringRecord(value.headers) &&
		typeof value.statusCode === "number" &&
		Number.isSafeInteger(value.statusCode) &&
		typeof value.statusText === "string"
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
