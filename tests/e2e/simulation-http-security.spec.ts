import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import type { Edge, Node } from "@xyflow/react";
import networkActionConformance from "../../contracts/network-action-conformance.json";
import networkAddressConformance from "../../contracts/network-address-conformance.json";
import simulationHttpPolicy from "../../contracts/simulation-http-policy.json";
import { getNodePorts, getRuntimeDataOutputs } from "../../data/nodes/registry";
import { defaultProjectSettings } from "../../data/projects/defaults";
import type { JsonValue, ScriptNodeData } from "../../lib/types";
import { withEdgeExecutionOrder } from "../../utils/editor-graph";
import { createHttpActionError } from "../../utils/http-action-contract";
import {
	executeSimulationHttpRequest,
	isPublicSimulationAddress,
	resolvePublicDestination,
	SimulationHttpError,
	type SimulationHttpResponse,
	validateSimulationHttpRequest,
} from "../../utils/server/simulation-http";
import { createSimulationRun } from "../../utils/simulation";
import { getLiteralHttpOrigin } from "../../utils/simulation-http-preflight";

test("HTTP result and failure payloads follow the shared action contract", () => {
	const success: Record<string, JsonValue> = {
		body: "ok",
		duration_ms: 3,
		headers: { "content-type": "text/plain" },
		status_code: 200,
		status_text: "OK",
	};
	assertContractFields(success, networkActionConformance.success.required_fields);

	const denied = createHttpActionError("Destination is private.", "PRIVATE_ADDRESS_BLOCKED", {
		destination: "http://127.0.0.1",
		method: "GET",
	});
	assertContractFields(denied, networkActionConformance.error.required_fields);
	expect(denied.type).toBe(networkActionConformance.error.error_type);
	expect(denied.retryable).toBe(false);

	const unknown = createHttpActionError("Unexpected transport failure.", "UNRECOGNIZED_SERVER_CODE", {});
	expect(unknown.code).toBe("HTTP_REQUEST_FAILED");
	expect(unknown.retryable).toBe(true);
});

test("live HTTP preflight requires a literal origin but permits variables after it", () => {
	expect(getLiteralHttpOrigin("https://api.example.com/v1/{{secret}}?q={{query}}")).toEqual({
		origin: "https://api.example.com",
	});
	expect(getLiteralHttpOrigin("https://{{settings.host}}/v1")).toHaveProperty("error");
	expect(getLiteralHttpOrigin("{{settings.url}}")).toHaveProperty("error");
	expect(getLiteralHttpOrigin("https://user:password@example.com/v1")).toHaveProperty("error");
});

test("simulation address policy matches the shared public-address contract", () => {
	expect(networkAddressConformance.version).toBe(1);
	for (const testCase of networkAddressConformance.cases) {
		expect(isPublicSimulationAddress(testCase.address), testCase.address).toBe(testCase.public);
	}
});

test("simulation transport rejects private destinations before opening a socket", async () => {
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["http://127.0.0.1"],
		body: "",
		headers: {},
		method: "GET",
		timeoutMs: 1_000,
		url: "http://127.0.0.1/private",
	});
	await expect(executeSimulationHttpRequest(request, new AbortController().signal)).rejects.toMatchObject({
		code: "PRIVATE_ADDRESS_BLOCKED",
	});
});

test("DNS policy rejects a destination when any resolved address is non-public", async () => {
	await expect(
		resolvePublicDestination(new URL("https://mixed.example/resource"), async () => [
			{ address: "1.1.1.1", family: 4 },
			{ address: "127.0.0.1", family: 4 },
		]),
	).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_BLOCKED" });
});

test("every redirect hop is re-resolved and a DNS change to private is blocked", async () => {
	let lookupCount = 0;
	let requestCount = 0;
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["https://changing.example"],
		body: "",
		headers: {},
		method: "GET",
		timeoutMs: 1_000,
		url: "https://changing.example/first",
	});

	await expect(
		executeSimulationHttpRequest(request, new AbortController().signal, {
			request: async ({ destination }) => {
				requestCount += 1;
				expect(destination.address).toBe("1.1.1.1");
				return {
					body: "",
					headers: { location: "/second" },
					statusCode: 302,
					statusText: "Found",
				};
			},
			resolveDestination: (url) =>
				resolvePublicDestination(url, async () => {
					lookupCount += 1;
					return lookupCount === 1 ? [{ address: "1.1.1.1", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
				}),
		}),
	).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_BLOCKED" });
	expect(lookupCount).toBe(2);
	expect(requestCount).toBe(1);
});

test("cross-origin redirects strip every caller header before the next request", async () => {
	const attempts: Array<{ body: string; headers: Record<string, string>; method: string; url: string }> = [];
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["https://first.example", "https://second.example"],
		body: "",
		headers: {
			authorization: "Bearer secret",
			cookie: "session=secret",
			"x-api-key": "custom-secret",
		},
		method: "GET",
		timeoutMs: 1_000,
		url: "https://first.example/start",
	});
	const response = await executeSimulationHttpRequest(request, new AbortController().signal, {
		request: async (attempt): Promise<SimulationHttpResponse> => {
			attempts.push({
				body: attempt.body,
				headers: { ...attempt.headers },
				method: attempt.method,
				url: attempt.url.href,
			});
			return attempts.length === 1
				? { body: "", headers: { location: "https://second.example/result" }, statusCode: 302, statusText: "Found" }
				: { body: "ok", headers: {}, statusCode: 200, statusText: "OK" };
		},
		resolveDestination: async () => ({ address: "1.1.1.1", family: 4 }),
	});

	expect(response.body).toBe("ok");
	expect(attempts).toHaveLength(2);
	expect(attempts[0]?.headers).toEqual({
		"accept-encoding": "identity",
		authorization: "Bearer secret",
		cookie: "session=secret",
		"x-api-key": "custom-secret",
	});
	expect(attempts[1]?.headers).toEqual({ "accept-encoding": "identity" });
});

test("cross-origin redirects never forward a request body", async () => {
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["https://first.example", "https://second.example"],
		body: "secret body",
		headers: { "content-type": "text/plain" },
		method: "PUT",
		timeoutMs: 1_000,
		url: "https://first.example/start",
	});
	let attempts = 0;
	await expect(
		executeSimulationHttpRequest(request, new AbortController().signal, {
			request: async () => {
				attempts += 1;
				return {
					body: "",
					headers: { location: "https://second.example/result" },
					statusCode: 307,
					statusText: "Temporary Redirect",
				};
			},
			resolveDestination: async () => ({ address: "1.1.1.1", family: 4 }),
		}),
	).rejects.toMatchObject({ code: "CROSS_ORIGIN_BODY_BLOCKED" });
	expect(attempts).toBe(1);
});

test("cross-origin POST redirects switch to GET without forwarding headers or body", async () => {
	const attempts: Array<{ body: string; headers: Record<string, string>; method: string }> = [];
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["https://first.example", "https://second.example"],
		body: "secret body",
		headers: {
			authorization: "Bearer secret",
			"content-type": "text/plain",
		},
		method: "POST",
		timeoutMs: 1_000,
		url: "https://first.example/start",
	});
	await executeSimulationHttpRequest(request, new AbortController().signal, {
		request: async (attempt): Promise<SimulationHttpResponse> => {
			attempts.push({ body: attempt.body, headers: { ...attempt.headers }, method: attempt.method });
			return attempts.length === 1
				? { body: "", headers: { location: "https://second.example/result" }, statusCode: 302, statusText: "Found" }
				: { body: "ok", headers: {}, statusCode: 200, statusText: "OK" };
		},
		resolveDestination: async () => ({ address: "1.1.1.1", family: 4 }),
	});

	expect(attempts).toHaveLength(2);
	expect(attempts[1]).toEqual({
		body: "",
		headers: { "accept-encoding": "identity" },
		method: "GET",
	});
});

test("same-origin redirects preserve the authorized request method, headers, and body", async () => {
	const attempts: Array<{ body: string; headers: Record<string, string>; method: string; url: string }> = [];
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["https://api.example"],
		body: "request-body",
		headers: { authorization: "Bearer secret", "x-request": "same-origin" },
		method: "POST",
		timeoutMs: 1_000,
		url: "https://api.example/start",
	});
	const response = await executeSimulationHttpRequest(request, new AbortController().signal, {
		request: async (attempt): Promise<SimulationHttpResponse> => {
			attempts.push({
				body: attempt.body,
				headers: { ...attempt.headers },
				method: attempt.method,
				url: attempt.url.href,
			});
			return attempts.length === 1
				? { body: "", headers: { location: "/result" }, statusCode: 307, statusText: "Temporary Redirect" }
				: { body: "ok", headers: {}, statusCode: 200, statusText: "OK" };
		},
		resolveDestination: async () => ({ address: "1.1.1.1", family: 4 }),
	});

	expect(response.body).toBe("ok");
	expect(attempts).toHaveLength(2);
	expect(attempts[1]).toEqual({
		body: "request-body",
		headers: {
			"accept-encoding": "identity",
			authorization: "Bearer secret",
			"x-request": "same-origin",
		},
		method: "POST",
		url: "https://api.example/result",
	});
});

test("redirect loops stop before issuing a repeated request", async () => {
	let attempts = 0;
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["https://api.example"],
		body: "",
		headers: {},
		method: "GET",
		timeoutMs: 1_000,
		url: "https://api.example/loop",
	});
	await expect(
		executeSimulationHttpRequest(request, new AbortController().signal, {
			request: async (): Promise<SimulationHttpResponse> => {
				attempts += 1;
				return {
					body: "",
					headers: { location: "/loop" },
					statusCode: 302,
					statusText: "Found",
				};
			},
			resolveDestination: async () => ({ address: "1.1.1.1", family: 4 }),
		}),
	).rejects.toMatchObject({ code: "REDIRECT_LOOP" });
	expect(attempts).toBe(1);
});

test("concurrent live requests keep authorization and cancellation state isolated", async () => {
	const firstAbort = new AbortController();
	const secondAbort = new AbortController();
	const first = validateSimulationHttpRequest({
		authorizedOrigins: ["https://first.example"],
		body: "",
		headers: { "x-request": "first" },
		method: "GET",
		timeoutMs: 1_000,
		url: "https://first.example/value",
	});
	const second = validateSimulationHttpRequest({
		authorizedOrigins: ["https://second.example"],
		body: "",
		headers: { "x-request": "second" },
		method: "GET",
		timeoutMs: 1_000,
		url: "https://second.example/value",
	});
	const execute = (request: typeof first, signal: AbortSignal) =>
		executeSimulationHttpRequest(request, signal, {
			request: async (attempt): Promise<SimulationHttpResponse> => {
				expect(attempt.signal).toBe(signal);
				if (attempt.url.hostname === "first.example") {
					await new Promise<never>((_resolve, reject) => {
						const cancel = () => reject(new SimulationHttpError("cancelled", "CANCELLED"));
						if (attempt.signal.aborted) cancel();
						else attempt.signal.addEventListener("abort", cancel, { once: true });
					});
				}
				return {
					body: attempt.headers["x-request"],
					headers: {},
					statusCode: 200,
					statusText: "OK",
				};
			},
			resolveDestination: async () => ({ address: "1.1.1.1", family: 4 }),
		});

	const firstResponse = execute(first, firstAbort.signal);
	const secondResponse = execute(second, secondAbort.signal);
	firstAbort.abort();
	await expect(firstResponse).rejects.toMatchObject({ code: "CANCELLED" });
	expect((await secondResponse).body).toBe("second");
});

test("live HTTP transport stops reading at the configured response limit", async () => {
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/plain" });
		response.end(Buffer.alloc(simulationHttpPolicy.max_response_body_bytes + 1, 0x61));
	});
	const port = await listenOnLoopback(server);
	try {
		const request = validateSimulationHttpRequest({
			authorizedOrigins: [`http://public.example:${port}`],
			body: "",
			headers: {},
			method: "GET",
			timeoutMs: 5_000,
			url: `http://public.example:${port}/oversized`,
		});
		await expect(
			executeSimulationHttpRequest(request, new AbortController().signal, {
				resolveDestination: async () => ({ address: "127.0.0.1", family: 4 }),
			}),
		).rejects.toMatchObject({ code: "RESPONSE_BODY_LIMIT" });
	} finally {
		await closeServer(server);
	}
});

test("live HTTP transport cancellation closes an in-flight response", async () => {
	let notifyRequestStarted: (() => void) | undefined;
	const requestStarted = new Promise<void>((resolve) => {
		notifyRequestStarted = resolve;
	});
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/plain" });
		response.write("partial");
		notifyRequestStarted?.();
	});
	const port = await listenOnLoopback(server);
	const controller = new AbortController();
	try {
		const request = validateSimulationHttpRequest({
			authorizedOrigins: [`http://public.example:${port}`],
			body: "",
			headers: {},
			method: "GET",
			timeoutMs: 5_000,
			url: `http://public.example:${port}/cancel`,
		});
		const pending = executeSimulationHttpRequest(request, controller.signal, {
			resolveDestination: async () => ({ address: "127.0.0.1", family: 4 }),
		});
		await requestStarted;
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
	} finally {
		controller.abort();
		await closeServer(server);
	}
});

test("HTTPS redirects cannot downgrade to HTTP", async () => {
	const request = validateSimulationHttpRequest({
		authorizedOrigins: ["https://secure.example", "http://secure.example"],
		body: "",
		headers: {},
		method: "GET",
		timeoutMs: 1_000,
		url: "https://secure.example/start",
	});
	await expect(
		executeSimulationHttpRequest(request, new AbortController().signal, {
			request: async () => ({
				body: "",
				headers: { location: "http://secure.example/result" },
				statusCode: 302,
				statusText: "Found",
			}),
			resolveDestination: async () => ({ address: "1.1.1.1", family: 4 }),
		}),
	).rejects.toMatchObject({ code: "REDIRECT_DOWNGRADE" });
});

test("simulation clients cannot override transport content encoding", () => {
	expect(() =>
		validateSimulationHttpRequest({
			authorizedOrigins: ["https://example.com"],
			body: "",
			headers: { "accept-encoding": "gzip" },
			method: "GET",
			timeoutMs: 1_000,
			url: "https://example.com",
		}),
	).toThrow(/accept-encoding is not allowed/i);
});

test("mock HTTP simulation never resolves secret-bearing request fields", async () => {
	const trigger = createNode("trigger", "trigger.manual", {});
	const request = createNode("request", "action.http", {
		body: "{{apiSecret}}",
		bodyFormat: "json",
		headers: [{ id: "authorization", name: "authorization", value: "{{apiSecret}}" }],
		method: "POST",
		timeoutSeconds: "30",
		url: "https://example.com/{{apiSecret}}",
		userAgent: "{{apiSecret}}",
	});
	const edge: Edge = withEdgeExecutionOrder(
		{
			id: "trigger-request",
			source: trigger.id,
			sourceHandle: "out",
			target: request.id,
			targetHandle: "input",
		},
		0,
	);
	const result = await createSimulationRun({
		assets: [],
		edges: [edge],
		httpSimulation: { authorizedOrigins: [], mode: "mock" },
		nodes: [trigger, request],
		overrides: [],
		projectSettings: defaultProjectSettings,
		secretValues: { apiSecret: "\r\ninvalid-if-resolved" },
		triggerNodeId: trigger.id,
	});

	expect(result.status).toBe("completed");
});

function createNode(id: string, actionType: ScriptNodeData["actionType"], config: Record<string, JsonValue>) {
	const ports = getNodePorts(actionType, config);
	return {
		data: {
			actionType,
			config,
			inputs: ports.inputs,
			kind: actionType.startsWith("trigger.") ? "trigger" : "action",
			label: id,
			outputs: ports.outputs,
			risk: "medium",
			runtimeOutputs: getRuntimeDataOutputs(actionType, config),
		},
		id,
		position: { x: 0, y: 0 },
		type: "scriptNode",
	} satisfies Node<ScriptNodeData>;
}

function listenOnLoopback(server: Server) {
	return new Promise<number>((resolve, reject) => {
		const handleError = (error: Error) => reject(error);
		server.once("error", handleError);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", handleError);
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Loopback test server did not expose a TCP port."));
				return;
			}
			resolve(address.port);
		});
	});
}

function closeServer(server: Server) {
	server.closeAllConnections();
	return new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

function assertContractFields(value: Record<string, JsonValue>, fields: Record<string, string>) {
	for (const [name, expectedType] of Object.entries(fields)) {
		expect(value).toHaveProperty(name);
		if (expectedType === "json") continue;
		const actual = value[name];
		const actualType = actual !== null && !Array.isArray(actual) ? typeof actual : "non-object";
		expect(actualType, `${name} should be ${expectedType}`).toBe(expectedType);
	}
}
