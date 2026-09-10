import type { JsonValue, NodePort } from "@/lib/types";

export type RouterPortRow = {
	id: string;
	label: string;
};

export type RouterRouteRow = {
	id: string;
	inputId: string;
	outputId: string;
	order: number;
};

export type RouterConfig = {
	inputs: RouterPortRow[];
	outputs: RouterPortRow[];
	routes: RouterRouteRow[];
};

export const ROUTER_INPUT_HANDLE_PREFIX = "in-";
export const ROUTER_OUTPUT_HANDLE_PREFIX = "out-";
export const MAX_ROUTER_PORTS = 64;

export function createRouterPortRow(label: string, id: string = crypto.randomUUID()): RouterPortRow {
	return { id, label };
}

export function createRouterRouteRow(
	inputId: string,
	outputId: string,
	order: number,
	id: string = crypto.randomUUID(),
): RouterRouteRow {
	return { id, inputId, outputId, order };
}

export function isRouterPortRow(value: JsonValue): value is RouterPortRow {
	return isRecord(value) && typeof value.id === "string" && typeof value.label === "string";
}

export function isRouterRouteRow(value: JsonValue): value is RouterRouteRow {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.inputId === "string" &&
		typeof value.outputId === "string" &&
		typeof value.order === "number" &&
		Number.isSafeInteger(value.order) &&
		value.order >= 0
	);
}

/** Lenient read used by ports, the canvas, and the panel. Never throws; drops rows it cannot read. */
export function getRouterConfigFromValue(config: Record<string, JsonValue>): RouterConfig {
	return {
		inputs: Array.isArray(config.inputs) ? config.inputs.filter(isRouterPortRow).map(clonePort) : [],
		outputs: Array.isArray(config.outputs) ? config.outputs.filter(isRouterPortRow).map(clonePort) : [],
		routes: Array.isArray(config.routes) ? config.routes.filter(isRouterRouteRow).map(cloneRoute) : [],
	};
}

export function routerInputHandle(portId: string) {
	return `${ROUTER_INPUT_HANDLE_PREFIX}${portId}`;
}

export function routerOutputHandle(portId: string) {
	return `${ROUTER_OUTPUT_HANDLE_PREFIX}${portId}`;
}

export function routerInputIdFromHandle(handle: string): string | null {
	if (!handle.startsWith(ROUTER_INPUT_HANDLE_PREFIX)) return null;
	const id = handle.slice(ROUTER_INPUT_HANDLE_PREFIX.length);
	return id.length > 0 ? id : null;
}

export function routerPortLabel(port: RouterPortRow, index: number, side: "input" | "output") {
	return port.label.trim() || `${side} ${index + 1}`;
}

export function createRouterPorts(config: RouterConfig): { inputs: NodePort[]; outputs: NodePort[] } {
	return {
		inputs: config.inputs.map((port, index) => ({
			id: routerInputHandle(port.id),
			label: routerPortLabel(port, index, "input"),
		})),
		outputs: config.outputs.map((port, index) => ({
			id: routerOutputHandle(port.id),
			label: routerPortLabel(port, index, "output"),
		})),
	};
}

export function getRouterRoutesForInput(config: RouterConfig, inputId: string) {
	return config.routes.filter((route) => route.inputId === inputId).sort((left, right) => left.order - right.order);
}

export function validateRouterConfig(config: Record<string, JsonValue>): string[] {
	const errors: string[] = [];
	const rawInputs = config.inputs;
	const rawOutputs = config.outputs;
	const rawRoutes = config.routes;
	if (!Array.isArray(rawInputs)) errors.push("must define inputs as a list.");
	if (!Array.isArray(rawOutputs)) errors.push("must define outputs as a list.");
	if (!Array.isArray(rawRoutes)) errors.push("must define routes as a list.");
	if (!Array.isArray(rawInputs) || !Array.isArray(rawOutputs) || !Array.isArray(rawRoutes)) return errors;

	if (rawInputs.length === 0) errors.push("must define at least one input.");
	if (rawOutputs.length === 0) errors.push("must define at least one output.");
	if (rawInputs.length > MAX_ROUTER_PORTS) errors.push(`cannot define more than ${MAX_ROUTER_PORTS} inputs.`);
	if (rawOutputs.length > MAX_ROUTER_PORTS) errors.push(`cannot define more than ${MAX_ROUTER_PORTS} outputs.`);

	const inputs = validatePorts(rawInputs, "input", errors);
	const outputs = validatePorts(rawOutputs, "output", errors);

	const routes = rawRoutes.filter(isRouterRouteRow);
	if (routes.length !== rawRoutes.length) errors.push("contains an invalid route.");
	if (routes.some((route) => !route.id.trim())) errors.push("contains an invalid route.");
	if (duplicateValues(routes.map((route) => route.id)).size > 0) {
		errors.push("contains duplicate route identifiers.");
	}

	const inputIds = new Set(inputs.map((port) => port.id));
	const outputIds = new Set(outputs.map((port) => port.id));
	const pairs = new Set<string>();
	let duplicatePair = false;
	for (const [index, route] of routes.entries()) {
		if (!inputIds.has(route.inputId)) errors.push(`route ${index + 1} references a missing input.`);
		if (!outputIds.has(route.outputId)) errors.push(`route ${index + 1} references a missing output.`);
		const pair = `${route.inputId}\u0000${route.outputId}`;
		if (pairs.has(pair)) duplicatePair = true;
		pairs.add(pair);
	}
	if (duplicatePair) errors.push("contains duplicate routes between the same input and output.");

	for (const [index, input] of inputs.entries()) {
		const label = routerPortLabel(input, index, "input");
		const inputRoutes = routes.filter((route) => route.inputId === input.id);
		if (inputRoutes.length === 0) {
			errors.push(`input "${label}" has no routes.`);
			continue;
		}
		const orders = inputRoutes.map((route) => route.order).sort((left, right) => left - right);
		if (orders.some((order, position) => order !== position)) {
			errors.push(`input "${label}" route order must be unique and consecutive starting at 0.`);
		}
	}

	for (const [index, output] of outputs.entries()) {
		if (!routes.some((route) => route.outputId === output.id)) {
			errors.push(`output "${routerPortLabel(output, index, "output")}" has no incoming routes.`);
		}
	}

	return errors;
}

export function summarizeRouterConfig(config: Record<string, JsonValue>) {
	const parsed = getRouterConfigFromValue(config);
	const routeCount = parsed.routes.length;
	return `${parsed.inputs.length} in - ${parsed.outputs.length} out - ${routeCount} route${routeCount === 1 ? "" : "s"}`;
}

function validatePorts(rawPorts: JsonValue[], side: "input" | "output", errors: string[]) {
	const ports = rawPorts.filter(isRouterPortRow);
	if (ports.length !== rawPorts.length) errors.push(`contains an invalid ${side} row.`);
	const invalidIds = ports.some((port) => !port.id.trim());
	if (invalidIds) errors.push(`contains an invalid ${side} row.`);
	for (const [index, port] of ports.entries()) {
		if (!port.label.trim()) errors.push(`${side} ${index + 1}: label is required.`);
	}
	if (duplicateValues(ports.map((port) => port.id)).size > 0) {
		errors.push(`contains duplicate ${side} identifiers.`);
	}
	return ports;
}

function clonePort(port: RouterPortRow): RouterPortRow {
	return { id: port.id, label: port.label };
}

function cloneRoute(route: RouterRouteRow): RouterRouteRow {
	return { id: route.id, inputId: route.inputId, outputId: route.outputId, order: route.order };
}

function duplicateValues(values: string[]) {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) duplicates.add(value);
		seen.add(value);
	}
	return duplicates;
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
