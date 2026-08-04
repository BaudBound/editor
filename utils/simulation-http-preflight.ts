import type { Edge, Node } from "@xyflow/react";
import type { ScriptNodeData } from "@/lib/types";

export type SimulationHttpPreflight = {
	origins: string[];
	problems: string[];
	requestCount: number;
};

export function getSimulationHttpPreflight(
	nodes: readonly Node<ScriptNodeData>[],
	edges: readonly Edge[],
	triggerNodeId: string,
): SimulationHttpPreflight {
	const reachableNodeIds = collectReachableNodeIds(edges, triggerNodeId);
	const httpNodes = nodes.filter((node) => reachableNodeIds.has(node.id) && node.data.actionType === "action.http");
	const origins = new Set<string>();
	const problems: string[] = [];

	for (const node of httpNodes) {
		const value = typeof node.data.config.url === "string" ? node.data.config.url.trim() : "";
		const result = getLiteralHttpOrigin(value);
		if ("error" in result) {
			problems.push(`HTTP Request ${node.id}: ${result.error}`);
		} else {
			origins.add(result.origin);
		}
	}

	return { origins: [...origins].sort(), problems, requestCount: httpNodes.length };
}

export function getLiteralHttpOrigin(value: string): { origin: string } | { error: string } {
	const schemeSeparator = value.indexOf("://");
	if (schemeSeparator <= 0) {
		return { error: "live simulation requires a literal HTTP or HTTPS scheme and host." };
	}
	const authorityStart = schemeSeparator + 3;
	const authorityEndCandidates = [
		value.indexOf("/", authorityStart),
		value.indexOf("?", authorityStart),
		value.indexOf("#", authorityStart),
	].filter((index) => index >= 0);
	const authorityEnd = authorityEndCandidates.length > 0 ? Math.min(...authorityEndCandidates) : value.length;
	const authority = value.slice(authorityStart, authorityEnd);
	if (!authority || authority.includes("{{") || authority.includes("}}")) {
		return { error: "live simulation requires a literal host; variables may only appear after the host." };
	}

	let originUrl: URL;
	try {
		originUrl = new URL(`${value.slice(0, schemeSeparator)}://${authority}`);
	} catch {
		return { error: "request URL does not contain a valid origin." };
	}
	if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
		return { error: "live simulation supports only HTTP and HTTPS destinations." };
	}
	if (originUrl.username || originUrl.password) {
		return { error: "request URLs containing credentials are not allowed." };
	}
	return { origin: originUrl.origin };
}

function collectReachableNodeIds(edges: readonly Edge[], triggerNodeId: string) {
	const targetsBySource = new Map<string, string[]>();
	for (const edge of edges) {
		const targets = targetsBySource.get(edge.source) ?? [];
		targets.push(edge.target);
		targetsBySource.set(edge.source, targets);
	}

	const reachable = new Set<string>();
	const pending = [triggerNodeId];
	while (pending.length > 0) {
		const nodeId = pending.pop();
		if (!nodeId || reachable.has(nodeId)) continue;
		reachable.add(nodeId);
		for (const target of targetsBySource.get(nodeId) ?? []) pending.push(target);
	}
	return reachable;
}
