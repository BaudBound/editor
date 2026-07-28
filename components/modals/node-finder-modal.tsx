"use client";

import type { Node } from "@xyflow/react";
import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { RiskBadge } from "@/components/shell/risk-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getNodeDefinition } from "@/data/nodes/registry";
import type { JsonValue, ScriptNodeData } from "@/lib/types";
import { cn } from "@/lib/utils";

type NodeFinderModalProps = {
	nodes: Node<ScriptNodeData>[];
	onClose: () => void;
	onSelectNode: (nodeId: string) => void;
	open: boolean;
};

type NodeFinderResult = {
	configPreview: string | null;
	displayName: string;
	node: Node<ScriptNodeData>;
	score: number;
};

export function NodeFinderModal({ nodes, onClose, onSelectNode, open }: NodeFinderModalProps) {
	const resultsId = useId();
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const results = useMemo(() => findNodes(nodes, query), [nodes, query]);

	useEffect(() => {
		if (!open) {
			return;
		}

		setQuery("");
		setActiveIndex(0);
	}, [open]);

	useEffect(() => {
		setActiveIndex((currentIndex) => Math.min(currentIndex, Math.max(0, results.length - 1)));
	}, [results.length]);

	useEffect(() => {
		const activeResult = results[activeIndex];
		if (!open || !activeResult) {
			return;
		}

		document.getElementById(`${resultsId}-${activeResult.node.id}`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open, results, resultsId]);

	const selectResult = (result: NodeFinderResult | undefined) => {
		if (!result) {
			return;
		}

		onSelectNode(result.node.id);
	};

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
			<DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] min-h-0 flex-col gap-3 sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Find a node</DialogTitle>
					<DialogDescription>
						Search by custom name, node type, ID, configuration value, or variable reference.
					</DialogDescription>
				</DialogHeader>

				<div className="relative">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-baud-muted"
					/>
					<Input
						aria-activedescendant={results[activeIndex] ? `${resultsId}-${results[activeIndex].node.id}` : undefined}
						aria-autocomplete="list"
						aria-controls={resultsId}
						aria-expanded={open}
						aria-label="Search project nodes"
						autoComplete="off"
						autoFocus
						className="h-9 pl-8"
						placeholder="Search project nodes..."
						role="combobox"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActiveIndex((currentIndex) => Math.min(currentIndex + 1, results.length - 1));
								return;
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setActiveIndex((currentIndex) => Math.max(currentIndex - 1, 0));
								return;
							}
							if (event.key === "Enter") {
								event.preventDefault();
								selectResult(results[activeIndex]);
							}
						}}
					/>
				</div>

				<div className="flex items-center justify-between gap-3 text-xs text-baud-muted">
					<span>
						{results.length} {results.length === 1 ? "node" : "nodes"}
					</span>
					<span>Use the arrow keys and Enter to select</span>
				</div>

				<div id={resultsId} className="min-h-0 flex-1 overflow-y-auto rounded border border-baud-border" role="listbox">
					{results.length === 0 ? (
						<div className="px-4 py-8 text-center text-sm text-baud-muted">
							{query.trim() ? `No nodes match "${query.trim()}".` : "This project does not contain any nodes yet."}
						</div>
					) : (
						<div className="divide-y divide-baud-border">
							{results.map((result, index) => {
								const definition = getNodeDefinition(result.node.data.actionType);
								const Icon = definition?.icon;
								const customName = getCustomName(result.node);

								return (
									<button
										key={result.node.id}
										id={`${resultsId}-${result.node.id}`}
										type="button"
										aria-selected={index === activeIndex}
										role="option"
										className={cn(
											"flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
											index === activeIndex ? "bg-baud-soft" : "bg-baud-panel hover:bg-baud-soft/65",
										)}
										onClick={() => selectResult(result)}
										onMouseMove={() => setActiveIndex(index)}
									>
										<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded border border-baud-border bg-baud-bg text-baud-muted">
											{Icon ? <Icon size={16} /> : <Search size={16} />}
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex min-w-0 items-center gap-2">
												<span className="truncate font-semibold text-white">{result.displayName}</span>
												{customName && (
													<span className="shrink-0 text-xs text-baud-muted">{result.node.data.label}</span>
												)}
											</div>
											<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-baud-muted">
												<span>{result.node.data.actionType}</span>
												<span>{result.node.id}</span>
											</div>
											{result.configPreview && (
												<p className="mt-1 truncate font-mono text-xs text-baud-text">{result.configPreview}</p>
											)}
										</div>
										<RiskBadge risk={result.node.data.risk} />
									</button>
								);
							})}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function findNodes(nodes: Node<ScriptNodeData>[], rawQuery: string): NodeFinderResult[] {
	const query = rawQuery.trim().toLocaleLowerCase();
	const results = nodes.flatMap((node) => {
		const displayName = getCustomName(node) || node.data.label;
		const configEntries = getSearchableConfigEntries(node);
		const configPreview = getConfigPreview(configEntries, query);
		const score = getMatchScore(node, displayName, configEntries, query);

		return score === null ? [] : [{ configPreview, displayName, node, score }];
	});

	return results.sort((left, right) => {
		if (query) {
			const scoreDifference = left.score - right.score;
			if (scoreDifference !== 0) {
				return scoreDifference;
			}
			return left.displayName.localeCompare(right.displayName);
		}

		const rowDifference = left.node.position.y - right.node.position.y;
		return rowDifference !== 0 ? rowDifference : left.node.position.x - right.node.position.x;
	});
}

function getMatchScore(
	node: Node<ScriptNodeData>,
	displayName: string,
	configEntries: Array<[string, JsonValue]>,
	query: string,
) {
	if (!query) {
		return 0;
	}

	const customName = getCustomName(node).toLocaleLowerCase();
	const label = node.data.label.toLocaleLowerCase();
	const actionType = node.data.actionType.toLocaleLowerCase();
	const nodeId = node.id.toLocaleLowerCase();
	const configText = configEntries.map(([key, value]) => `${key} ${stringifySearchValue(value)}`).join(" ");
	const normalizedDisplayName = displayName.toLocaleLowerCase();

	if (customName === query || nodeId === query) return 0;
	if (normalizedDisplayName.startsWith(query)) return 1;
	if (normalizedDisplayName.includes(query) || label.includes(query)) return 2;
	if (actionType.includes(query)) return 3;
	if (nodeId.includes(query)) return 4;
	if (configText.toLocaleLowerCase().includes(query)) return 5;
	return null;
}

function getCustomName(node: Node<ScriptNodeData>) {
	return typeof node.data.config.customName === "string" ? node.data.config.customName.trim() : "";
}

function getSearchableConfigEntries(node: Node<ScriptNodeData>): Array<[string, JsonValue]> {
	return Object.entries(node.data.config).filter(
		([key, value]) => key !== "customName" && !(typeof value === "string" && value.trim() === ""),
	);
}

function getConfigPreview(entries: Array<[string, JsonValue]>, query: string) {
	if (entries.length === 0) {
		return null;
	}

	const matchingEntry = query
		? entries.find(([key, value]) => `${key} ${stringifySearchValue(value)}`.toLocaleLowerCase().includes(query))
		: undefined;
	const [key, value] = matchingEntry ?? entries[0];
	return `${key}: ${truncatePreview(stringifyDisplayValue(value), 96)}`;
}

function stringifySearchValue(value: JsonValue) {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function stringifyDisplayValue(value: JsonValue) {
	if (typeof value === "string") {
		return value.replaceAll(/\s+/g, " ").trim();
	}
	return JSON.stringify(value);
}

function truncatePreview(value: string, maximumLength: number) {
	return value.length <= maximumLength ? value : `${value.slice(0, maximumLength - 3)}...`;
}
