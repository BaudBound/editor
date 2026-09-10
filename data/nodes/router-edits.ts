import type { JsonValue } from "@/lib/types";
import {
	createRouterPortRow,
	createRouterRouteRow,
	getRouterRoutesForInput,
	type RouterConfig,
	type RouterRouteRow,
} from "./router";

export type RouterPortSide = "inputs" | "outputs";

export function addRouterPort(config: RouterConfig, side: RouterPortSide): RouterConfig {
	const prefix = side === "inputs" ? "Input" : "Output";
	const port = createRouterPortRow(`${prefix} ${config[side].length + 1}`);
	return { ...cloneConfig(config), [side]: [...config[side], port] };
}

export function renameRouterPort(
	config: RouterConfig,
	side: RouterPortSide,
	portId: string,
	label: string,
): RouterConfig {
	return {
		...cloneConfig(config),
		[side]: config[side].map((port) => (port.id === portId ? { ...port, label } : port)),
	};
}

export function moveRouterPort(
	config: RouterConfig,
	side: RouterPortSide,
	portId: string,
	direction: -1 | 1,
): RouterConfig {
	const ports = [...config[side]];
	const index = ports.findIndex((port) => port.id === portId);
	const target = index + direction;
	if (index === -1 || target < 0 || target >= ports.length) return cloneConfig(config);
	[ports[index], ports[target]] = [ports[target], ports[index]];
	return { ...cloneConfig(config), [side]: ports };
}

export function removeRouterPort(config: RouterConfig, side: RouterPortSide, portId: string): RouterConfig {
	const routeKey = side === "inputs" ? "inputId" : "outputId";
	return normalizeRouterRouteOrders({
		...cloneConfig(config),
		[side]: config[side].filter((port) => port.id !== portId),
		routes: config.routes.filter((route) => route[routeKey] !== portId),
	});
}

/** Appends a route as the last one for its input. Already-routed pairs are left alone. */
export function addRouterRoute(config: RouterConfig, inputId: string, outputId: string): RouterConfig {
	if (config.routes.some((route) => route.inputId === inputId && route.outputId === outputId)) {
		return cloneConfig(config);
	}
	const last = getRouterRoutesForInput(config, inputId).at(-1);
	const order = last ? last.order + 1 : 0;
	return normalizeRouterRouteOrders({
		...cloneConfig(config),
		routes: [...config.routes, createRouterRouteRow(inputId, outputId, order)],
	});
}

/** Adds the route when the pair is unrouted, otherwise removes it. */
export function toggleRouterRoute(config: RouterConfig, inputId: string, outputId: string): RouterConfig {
	const existing = config.routes.find((route) => route.inputId === inputId && route.outputId === outputId);
	return existing ? removeRouterRoute(config, existing.id) : addRouterRoute(config, inputId, outputId);
}

export function moveRouterRoute(config: RouterConfig, routeId: string, direction: -1 | 1): RouterConfig {
	const normalized = normalizeRouterRouteOrders(config);
	const route = normalized.routes.find((candidate) => candidate.id === routeId);
	if (!route) return normalized;
	const siblings = getRouterRoutesForInput(normalized, route.inputId);
	const index = siblings.findIndex((candidate) => candidate.id === routeId);
	const target = index + direction;
	if (target < 0 || target >= siblings.length) return normalized;
	const neighbour = siblings[target];
	return {
		...normalized,
		routes: normalized.routes.map((candidate) =>
			candidate.id === route.id
				? { ...candidate, order: neighbour.order }
				: candidate.id === neighbour.id
					? { ...candidate, order: route.order }
					: candidate,
		),
	};
}

export function removeRouterRoute(config: RouterConfig, routeId: string): RouterConfig {
	return normalizeRouterRouteOrders({
		...cloneConfig(config),
		routes: config.routes.filter((route) => route.id !== routeId),
	});
}

export function normalizeRouterRouteOrders(config: RouterConfig): RouterConfig {
	const orders = new Map<string, number>();
	for (const input of config.inputs) {
		getRouterRoutesForInput(config, input.id).forEach((route, index) => {
			orders.set(route.id, index);
		});
	}
	return {
		...cloneConfig(config),
		routes: config.routes.map((route) => ({ ...route, order: orders.get(route.id) ?? route.order })),
	};
}

export function routerConfigToJson(config: RouterConfig): { inputs: JsonValue; outputs: JsonValue; routes: JsonValue } {
	return {
		inputs: config.inputs.map((port) => ({ id: port.id, label: port.label })),
		outputs: config.outputs.map((port) => ({ id: port.id, label: port.label })),
		routes: config.routes.map(
			(route): Record<string, JsonValue> => ({
				id: route.id,
				inputId: route.inputId,
				outputId: route.outputId,
				order: route.order,
			}),
		),
	};
}

function cloneConfig(config: RouterConfig): RouterConfig {
	return {
		inputs: config.inputs.map((port) => ({ ...port })),
		outputs: config.outputs.map((port) => ({ ...port })),
		routes: config.routes.map((route): RouterRouteRow => ({ ...route })),
	};
}
