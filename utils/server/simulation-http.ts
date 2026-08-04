import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import policy from "@/contracts/simulation-http-policy.json";

const FORBIDDEN_REQUEST_HEADERS = new Set([
	"accept-encoding",
	"connection",
	"content-length",
	"host",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export type ResolvedAddress = { address: string; family: 4 | 6 };
export type SimulationDnsLookup = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type SimulationHttpRequestAttempt = {
	body: string;
	deadline: number;
	destination: ResolvedAddress;
	headers: Record<string, string>;
	method: string;
	signal: AbortSignal;
	url: URL;
};

export type SimulationHttpDependencies = {
	request?: (attempt: SimulationHttpRequestAttempt) => Promise<SimulationHttpResponse>;
	resolveDestination?: (url: URL) => Promise<ResolvedAddress>;
};

export type SimulationHttpRequest = {
	authorizedOrigins: string[];
	body: string;
	headers: Record<string, string>;
	method: string;
	timeoutMs: number;
	url: string;
};

export type SimulationHttpResponse = {
	body: string;
	headers: Record<string, string>;
	statusCode: number;
	statusText: string;
};

export class SimulationHttpError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "SimulationHttpError";
	}
}

export function validateSimulationHttpRequest(value: unknown): SimulationHttpRequest {
	if (!isRecord(value)) throw new SimulationHttpError("Request must be a JSON object.", "INVALID_REQUEST");
	const authorizedOrigins = validateAuthorizedOrigins(value.authorizedOrigins);
	const url = requireString(value.url, "url");
	const method = requireString(value.method, "method").toUpperCase();
	if (!/^[A-Z]+$/.test(method)) throw new SimulationHttpError("HTTP method is invalid.", "INVALID_METHOD");
	const body = requireString(value.body, "body");
	if (Buffer.byteLength(body) > policy.max_request_body_bytes) {
		throw new SimulationHttpError(`Request body exceeds ${policy.max_request_body_bytes} bytes.`, "REQUEST_BODY_LIMIT");
	}
	const timeoutMs = value.timeoutMs;
	if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 86_400_000) {
		throw new SimulationHttpError("Timeout must be an integer from 1 to 86400000 milliseconds.", "INVALID_TIMEOUT");
	}
	const headers = validateHeaders(value.headers);

	return { authorizedOrigins, body, headers, method, timeoutMs, url };
}

export async function executeSimulationHttpRequest(
	request: SimulationHttpRequest,
	signal: AbortSignal,
	dependencies: SimulationHttpDependencies = {},
): Promise<SimulationHttpResponse> {
	let currentUrl = parseHttpUrl(request.url);
	const authorizedOrigins = new Set(request.authorizedOrigins);
	if (!authorizedOrigins.has(currentUrl.origin)) {
		throw new SimulationHttpError(
			"Request destination was not authorized for this simulation.",
			"ORIGIN_NOT_AUTHORIZED",
		);
	}

	let method = request.method;
	let body = request.body;
	let headers: Record<string, string> = { ...request.headers, "accept-encoding": "identity" };
	const deadline = Date.now() + request.timeoutMs;
	const visited = new Set<string>();
	const resolveDestination = dependencies.resolveDestination ?? resolvePublicDestination;
	const sendRequest = dependencies.request ?? requestOnce;

	for (let redirectCount = 0; ; redirectCount += 1) {
		if (visited.has(currentUrl.href)) {
			throw new SimulationHttpError("HTTP redirect loop detected.", "REDIRECT_LOOP");
		}
		visited.add(currentUrl.href);
		const destination = await resolveDestination(currentUrl);
		const response = await sendRequest({ body, deadline, destination, headers, method, signal, url: currentUrl });
		const location = response.headers.location;
		if (!REDIRECT_STATUSES.has(response.statusCode) || !location) return response;
		if (redirectCount >= policy.max_redirects) {
			throw new SimulationHttpError(`HTTP request exceeded ${policy.max_redirects} redirects.`, "REDIRECT_LIMIT");
		}

		const nextUrl = parseHttpUrl(new URL(location, currentUrl).href);
		if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
			throw new SimulationHttpError("HTTPS to HTTP redirects are not allowed.", "REDIRECT_DOWNGRADE");
		}
		if (!authorizedOrigins.has(nextUrl.origin)) {
			throw new SimulationHttpError(
				`Redirect destination ${nextUrl.origin} was not authorized for this simulation.`,
				"REDIRECT_ORIGIN_NOT_AUTHORIZED",
			);
		}
		const switchToGet =
			response.statusCode === 303 ||
			((response.statusCode === 301 || response.statusCode === 302) && method === "POST");
		if (nextUrl.origin !== currentUrl.origin) {
			if (!switchToGet && body && method !== "GET" && method !== "HEAD") {
				throw new SimulationHttpError(
					"HTTP request refused to forward a request body across origins during redirect.",
					"CROSS_ORIGIN_BODY_BLOCKED",
				);
			}
			headers = { "accept-encoding": "identity" };
		}
		if (switchToGet) {
			method = "GET";
			body = "";
			delete headers["content-type"];
		}
		currentUrl = nextUrl;
	}
}

export async function readBoundedJsonRequest(request: Request) {
	const declaredLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > policy.max_api_request_bytes) {
		throw new SimulationHttpError("Simulation request is too large.", "API_REQUEST_LIMIT");
	}
	if (!request.body) throw new SimulationHttpError("Simulation request body is required.", "INVALID_REQUEST");

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (!Number.isSafeInteger(size) || size > policy.max_api_request_bytes) {
				throw new SimulationHttpError("Simulation request is too large.", "API_REQUEST_LIMIT");
			}
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw new SimulationHttpError("Simulation request must contain valid UTF-8 JSON.", "INVALID_REQUEST");
	}
}

export async function resolvePublicDestination(
	url: URL,
	dnsLookup: SimulationDnsLookup = lookupAllAddresses,
): Promise<ResolvedAddress> {
	let addresses: ResolvedAddress[];
	const lookupHostname =
		url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
	try {
		addresses = [...(await dnsLookup(lookupHostname))];
	} catch {
		throw new SimulationHttpError(`Could not resolve ${url.hostname}.`, "DNS_FAILED");
	}
	if (addresses.length === 0) throw new SimulationHttpError(`Could not resolve ${url.hostname}.`, "DNS_FAILED");

	for (const address of addresses) {
		if (!isPublicSimulationAddress(address.address)) {
			throw new SimulationHttpError(
				`Destination ${url.hostname} resolves to a non-public address.`,
				"PRIVATE_ADDRESS_BLOCKED",
			);
		}
	}

	return addresses[0];
}

async function lookupAllAddresses(hostname: string): Promise<ResolvedAddress[]> {
	const resolved = await lookup(hostname, { all: true, verbatim: true });
	return resolved.map((address) => {
		if (address.family !== 4 && address.family !== 6) {
			throw new SimulationHttpError("DNS returned an unsupported address family.", "DNS_FAILED");
		}
		return { address: address.address, family: address.family };
	});
}

export function isPublicSimulationAddress(address: string) {
	try {
		return ipaddr.process(address).range() === "unicast";
	} catch {
		return false;
	}
}

function requestOnce(params: SimulationHttpRequestAttempt): Promise<SimulationHttpResponse> {
	return new Promise((resolve, reject) => {
		const remainingMs = params.deadline - Date.now();
		if (remainingMs <= 0) {
			reject(new SimulationHttpError("HTTP request timed out.", "HTTP_TIMEOUT"));
			return;
		}

		let settled = false;
		const transport = params.url.protocol === "https:" ? https : http;
		const headers = { ...params.headers };
		if (params.body && params.method !== "GET" && params.method !== "HEAD") {
			headers["content-length"] = String(Buffer.byteLength(params.body));
		}
		const request = transport.request(params.url, {
			headers,
			method: params.method,
			lookup: pinnedLookup(params.destination),
		});
		const finish = (result: { response: SimulationHttpResponse } | { error: unknown }) => {
			if (settled) return;
			settled = true;
			params.signal.removeEventListener("abort", handleAbort);
			"response" in result ? resolve(result.response) : reject(result.error);
		};
		const handleAbort = () => request.destroy(new SimulationHttpError("HTTP request was cancelled.", "CANCELLED"));

		request.once("response", (response) => {
			const statusCode = response.statusCode ?? 0;
			const responseHeaders = normalizeResponseHeaders(response.headers);
			if (REDIRECT_STATUSES.has(statusCode) && responseHeaders.location) {
				response.destroy();
				finish({
					response: { body: "", headers: responseHeaders, statusCode, statusText: response.statusMessage ?? "" },
				});
				return;
			}
			const contentEncoding = responseHeaders["content-encoding"]?.trim().toLowerCase();
			if (contentEncoding && contentEncoding !== "identity") {
				response.destroy();
				finish({
					error: new SimulationHttpError(
						`HTTP server returned unsupported ${contentEncoding} content encoding after identity was requested.`,
						"UNSUPPORTED_CONTENT_ENCODING",
					),
				});
				return;
			}

			const chunks: Buffer[] = [];
			let size = 0;
			response.on("data", (chunk: Buffer) => {
				size += chunk.byteLength;
				if (!Number.isSafeInteger(size) || size > policy.max_response_body_bytes) {
					response.destroy(
						new SimulationHttpError(
							`HTTP response exceeds ${policy.max_response_body_bytes} bytes.`,
							"RESPONSE_BODY_LIMIT",
						),
					);
					return;
				}
				chunks.push(chunk);
			});
			response.once("end", () =>
				finish({
					response: {
						body: Buffer.concat(chunks, size).toString("utf8"),
						headers: responseHeaders,
						statusCode,
						statusText: response.statusMessage ?? "",
					},
				}),
			);
			response.once("error", (error) => finish({ error }));
		});
		request.once("error", (error) => finish({ error }));
		request.setTimeout(remainingMs, () =>
			request.destroy(new SimulationHttpError("HTTP request timed out.", "HTTP_TIMEOUT")),
		);
		params.signal.addEventListener("abort", handleAbort, { once: true });
		if (params.signal.aborted) {
			handleAbort();
			return;
		}
		if (params.body && params.method !== "GET" && params.method !== "HEAD") request.write(params.body);
		request.end();
	});
}

function pinnedLookup(destination: ResolvedAddress): LookupFunction {
	return (_hostname, options, callback) => {
		if (options.all) {
			callback(null, [destination]);
			return;
		}
		callback(null, destination.address, destination.family);
	};
}

function parseHttpUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new SimulationHttpError("Request URL is invalid.", "INVALID_URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new SimulationHttpError("Request URL must use HTTP or HTTPS.", "INVALID_SCHEME");
	}
	if (url.username || url.password) {
		throw new SimulationHttpError("Request URL must not contain credentials.", "URL_CREDENTIALS_BLOCKED");
	}
	url.hash = "";
	return url;
}

function validateAuthorizedOrigins(value: unknown) {
	if (!Array.isArray(value) || value.length === 0 || value.length > policy.max_authorized_origins) {
		throw new SimulationHttpError("Authorized origins list is invalid.", "INVALID_AUTHORIZATION");
	}
	const origins = value.map((origin) => parseHttpUrl(requireString(origin, "authorized origin")).origin);
	if (new Set(origins).size !== origins.length || origins.some((origin, index) => origin !== value[index])) {
		throw new SimulationHttpError("Authorized origins must be unique normalized origins.", "INVALID_AUTHORIZATION");
	}
	return origins;
}

function validateHeaders(value: unknown) {
	if (!isRecord(value)) throw new SimulationHttpError("HTTP headers must be an object.", "INVALID_HEADERS");
	const entries = Object.entries(value);
	if (entries.length > policy.max_header_count) {
		throw new SimulationHttpError(`HTTP request exceeds ${policy.max_header_count} headers.`, "HEADER_LIMIT");
	}
	let totalBytes = 0;
	const headers: Record<string, string> = {};
	for (const [rawName, rawValue] of entries) {
		if (typeof rawValue !== "string")
			throw new SimulationHttpError("HTTP header values must be text.", "INVALID_HEADERS");
		const name = rawName.toLowerCase();
		if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || FORBIDDEN_REQUEST_HEADERS.has(name)) {
			throw new SimulationHttpError(`HTTP header ${rawName} is not allowed.`, "INVALID_HEADERS");
		}
		if (/[\0\r\n]/.test(rawValue))
			throw new SimulationHttpError(`HTTP header ${rawName} is invalid.`, "INVALID_HEADERS");
		totalBytes += Buffer.byteLength(name) + Buffer.byteLength(rawValue);
		if (!Number.isSafeInteger(totalBytes) || totalBytes > policy.max_header_bytes) {
			throw new SimulationHttpError(`HTTP headers exceed ${policy.max_header_bytes} bytes.`, "HEADER_LIMIT");
		}
		headers[name] = rawValue;
	}
	return headers;
}

function normalizeResponseHeaders(headers: http.IncomingHttpHeaders) {
	return Object.fromEntries(
		Object.entries(headers).flatMap(([name, value]) => {
			if (value === undefined) return [];
			return [[name.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]];
		}),
	);
}

function requireString(value: unknown, name: string) {
	if (typeof value !== "string") throw new SimulationHttpError(`${name} must be text.`, "INVALID_REQUEST");
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
