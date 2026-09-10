import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { FieldError } from "@/components/common/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionCombobox } from "@/components/ui/option-combobox";
import {
	getRouterConfigFromValue,
	getRouterRoutesForInput,
	type RouterConfig,
	type RouterPortRow,
	type RouterRouteRow,
	routerPortLabel,
	validateRouterConfig,
} from "@/data/nodes/router";
import {
	addRouterPort,
	addRouterRoute,
	moveRouterPort,
	moveRouterRoute,
	type RouterPortSide,
	removeRouterPort,
	removeRouterRoute,
	renameRouterPort,
	routerConfigToJson,
} from "@/data/nodes/router-edits";
import type { JsonValue } from "@/lib/types";

type RouterConfigPanelProps = {
	config: Record<string, JsonValue>;
	onChange: (values: Record<string, JsonValue>) => void;
};

/** Everything a row needs to name its controls and find its neighbours. */
type RouterView = {
	router: RouterConfig;
	outputLabels: Map<string, string>;
	incomingCounts: Map<string, number>;
	highlightedOutputId: string | null;
	onHighlightOutput: (outputId: string | null) => void;
};

export function RouterConfigPanel({ config, onChange }: RouterConfigPanelProps) {
	const router = getRouterConfigFromValue(config);
	const errors = [...new Set(validateRouterConfig(config))];
	const errorId = useId();
	const [highlightedOutputId, setHighlightedOutputId] = useState<string | null>(null);

	const outputLabels = new Map(
		router.outputs.map((output, index) => [output.id, routerPortLabel(output, index, "output")]),
	);
	const incomingCounts = new Map(router.outputs.map((output) => [output.id, 0]));
	for (const route of router.routes) {
		incomingCounts.set(route.outputId, (incomingCounts.get(route.outputId) ?? 0) + 1);
	}
	const view: RouterView = {
		router,
		outputLabels,
		incomingCounts,
		highlightedOutputId,
		onHighlightOutput: setHighlightedOutputId,
	};

	const commit = (next: RouterConfig) => onChange(routerConfigToJson(next));

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" onClick={() => commit(addRouterPort(router, "inputs"))}>
					<Plus size={13} />
					Add input
				</Button>
				<Button type="button" size="sm" onClick={() => commit(addRouterPort(router, "outputs"))}>
					<Plus size={13} />
					Add output
				</Button>
			</div>

			<div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
				<div className="space-y-2">
					<ColumnTitle>Inputs</ColumnTitle>
					<ul className="space-y-2" aria-label="Router inputs">
						{router.inputs.map((input, index) => (
							<InputRow
								key={input.id}
								input={input}
								index={index}
								view={view}
								onRename={(label) => commit(renameRouterPort(router, "inputs", input.id, label))}
								onMove={(direction) => commit(moveRouterPort(router, "inputs", input.id, direction))}
								onRemove={() => commit(removeRouterPort(router, "inputs", input.id))}
								onAddRoute={(outputId) => commit(addRouterRoute(router, input.id, outputId))}
								onMoveRoute={(routeId, direction) => commit(moveRouterRoute(router, routeId, direction))}
								onRemoveRoute={(routeId) => commit(removeRouterRoute(router, routeId))}
							/>
						))}
					</ul>
				</div>
				<div className="space-y-2">
					<ColumnTitle>Outputs</ColumnTitle>
					<ul className="space-y-2" aria-label="Router outputs">
						{router.outputs.map((output, index) => (
							<OutputRow
								key={output.id}
								output={output}
								index={index}
								view={view}
								onRename={(label) => commit(renameRouterPort(router, "outputs", output.id, label))}
								onMove={(direction) => commit(moveRouterPort(router, "outputs", output.id, direction))}
								onRemove={() => commit(removeRouterPort(router, "outputs", output.id))}
							/>
						))}
					</ul>
				</div>
			</div>

			<p className="font-mono text-xs text-baud-muted">
				Each input lists the outputs it continues to, in execution order. Hover an output to see which inputs reach it.
			</p>

			{errors.length > 0 && (
				<ul className="space-y-1" aria-label="Router validation errors">
					{errors.map((error, index) => (
						<li key={error}>
							<FieldError id={`${errorId}-${index}`} message={`Router ${error}`} />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ColumnTitle({ children }: { children: string }) {
	return <div className="font-mono text-xs uppercase tracking-[0.18em] text-baud-muted">{children}</div>;
}

function InputRow({
	input,
	index,
	view,
	onRename,
	onMove,
	onRemove,
	onAddRoute,
	onMoveRoute,
	onRemoveRoute,
}: {
	input: RouterPortRow;
	index: number;
	view: RouterView;
	onRename: (label: string) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
	onAddRoute: (outputId: string) => void;
	onMoveRoute: (routeId: string, direction: -1 | 1) => void;
	onRemoveRoute: (routeId: string) => void;
}) {
	const { router, outputLabels, highlightedOutputId, onHighlightOutput } = view;
	const label = routerPortLabel(input, index, "input");
	const routes = getRouterRoutesForInput(router, input.id);
	const routedOutputIds = new Set(routes.map((route) => route.outputId));
	const unroutedOutputs = router.outputs.filter((output) => !routedOutputIds.has(output.id));
	const reachesHighlighted = highlightedOutputId !== null && routedOutputIds.has(highlightedOutputId);

	return (
		<li
			className={`space-y-2 rounded border p-2 transition-[border-color] ${
				reachesHighlighted ? "border-baud-amber" : "border-baud-border"
			} bg-baud-panel`}
		>
			<PortHeader
				side="inputs"
				port={input}
				index={index}
				total={router.inputs.length}
				onRename={onRename}
				onMove={onMove}
				onRemove={onRemove}
			/>

			{routes.length > 0 ? (
				<ol className="flex flex-wrap items-center gap-1" aria-label={`Routes from ${label}`}>
					{routes.map((route, routeIndex) => (
						<RouteChip
							key={route.id}
							route={route}
							position={routeIndex + 1}
							total={routes.length}
							inputLabel={label}
							outputLabel={outputLabels.get(route.outputId) ?? route.outputId}
							highlighted={route.outputId === highlightedOutputId}
							onHighlight={(active) => onHighlightOutput(active ? route.outputId : null)}
							onMove={(direction) => onMoveRoute(route.id, direction)}
							onRemove={() => onRemoveRoute(route.id)}
						/>
					))}
				</ol>
			) : (
				<div className="flex items-center gap-1.5 font-mono text-xs text-baud-danger">
					<AlertTriangle size={13} />
					No routes yet. Pick an output below.
				</div>
			)}

			<OptionCombobox
				ariaLabel={`Add output for ${label}`}
				className="w-full"
				disabled={unroutedOutputs.length === 0}
				emptyMessage="Every output is already routed from this input."
				options={router.outputs
					.map((output, outputIndex) => ({
						label: routerPortLabel(output, outputIndex, "output"),
						value: output.id,
					}))
					.filter((option) => !routedOutputIds.has(option.value))}
				placeholder={unroutedOutputs.length === 0 ? "All outputs routed" : "Add output…"}
				value=""
				onChange={onAddRoute}
			/>
		</li>
	);
}

function OutputRow({
	output,
	index,
	view,
	onRename,
	onMove,
	onRemove,
}: {
	output: RouterPortRow;
	index: number;
	view: RouterView;
	onRename: (label: string) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
}) {
	const { router, incomingCounts, highlightedOutputId, onHighlightOutput } = view;
	const incoming = incomingCounts.get(output.id) ?? 0;
	const highlighted = output.id === highlightedOutputId;
	const label = routerPortLabel(output, index, "output");

	return (
		<li
			className={`space-y-2 rounded border p-2 transition-[border-color] ${
				highlighted ? "border-baud-amber" : "border-baud-border"
			} bg-baud-panel`}
			onMouseEnter={() => onHighlightOutput(output.id)}
			onMouseLeave={() => onHighlightOutput(null)}
			onFocus={() => onHighlightOutput(output.id)}
			onBlur={() => onHighlightOutput(null)}
		>
			<PortHeader
				side="outputs"
				port={output}
				index={index}
				total={router.outputs.length}
				onRename={onRename}
				onMove={onMove}
				onRemove={onRemove}
			/>
			<output
				className={`flex items-center gap-1.5 font-mono text-xs ${incoming === 0 ? "text-baud-danger" : "text-baud-muted"}`}
				aria-label={`${label} incoming routes`}
			>
				{incoming === 0 && <AlertTriangle size={13} />}
				{incoming} in
			</output>
		</li>
	);
}

function PortHeader({
	side,
	port,
	index,
	total,
	onRename,
	onMove,
	onRemove,
}: {
	side: RouterPortSide;
	port: RouterPortRow;
	index: number;
	total: number;
	onRename: (label: string) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
}) {
	const noun = side === "inputs" ? "input" : "output";
	const position = index + 1;
	const title = side === "inputs" ? "Input" : "Output";

	return (
		<div className="flex items-center gap-1">
			<Input
				aria-label={`${title} ${position} label`}
				aria-invalid={!port.label.trim()}
				value={port.label}
				onChange={(event) => onRename(event.target.value)}
			/>
			<Button
				type="button"
				size="xsIcon"
				variant="ghost"
				aria-label={`Move ${noun} ${position} up`}
				title={`Move ${noun} ${position} up`}
				disabled={index === 0}
				onClick={() => onMove(-1)}
			>
				<ArrowUp size={13} />
			</Button>
			<Button
				type="button"
				size="xsIcon"
				variant="ghost"
				aria-label={`Move ${noun} ${position} down`}
				title={`Move ${noun} ${position} down`}
				disabled={index === total - 1}
				onClick={() => onMove(1)}
			>
				<ArrowDown size={13} />
			</Button>
			<Button
				type="button"
				size="xsIcon"
				variant="destructive"
				aria-label={`Remove ${noun} ${position}`}
				title={`Remove ${noun} ${position}`}
				disabled={total === 1}
				onClick={onRemove}
			>
				<X size={13} />
			</Button>
		</div>
	);
}

function RouteChip({
	route,
	position,
	total,
	inputLabel,
	outputLabel,
	highlighted,
	onHighlight,
	onMove,
	onRemove,
}: {
	route: RouterRouteRow;
	position: number;
	total: number;
	inputLabel: string;
	outputLabel: string;
	highlighted: boolean;
	onHighlight: (active: boolean) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
}) {
	const name = `route ${position} for ${inputLabel}`;

	return (
		<li
			data-route-id={route.id}
			className={`flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-xs transition-[border-color] ${
				highlighted ? "border-baud-amber bg-baud-amber/10" : "border-baud-border bg-baud-soft"
			}`}
			onMouseEnter={() => onHighlight(true)}
			onMouseLeave={() => onHighlight(false)}
			onFocus={() => onHighlight(true)}
			onBlur={() => onHighlight(false)}
		>
			<span className="text-baud-muted">{position}</span>
			<span className="mx-1 max-w-32 truncate text-baud-text" title={outputLabel}>
				{outputLabel}
			</span>
			<Button
				type="button"
				size="icon-xs"
				variant="ghost"
				aria-label={`Move ${name} earlier`}
				title={`Move ${name} earlier`}
				disabled={position === 1}
				onClick={() => onMove(-1)}
			>
				<ArrowLeft size={11} />
			</Button>
			<Button
				type="button"
				size="icon-xs"
				variant="ghost"
				aria-label={`Move ${name} later`}
				title={`Move ${name} later`}
				disabled={position === total}
				onClick={() => onMove(1)}
			>
				<ArrowRight size={11} />
			</Button>
			<Button
				type="button"
				size="icon-xs"
				variant="destructive"
				aria-label={`Remove ${name}`}
				title={`Remove ${name}`}
				onClick={onRemove}
			>
				<X size={11} />
			</Button>
		</li>
	);
}
