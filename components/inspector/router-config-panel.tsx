import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { FieldError } from "@/components/common/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
	moveRouterPort,
	moveRouterRoute,
	removeRouterPort,
	renameRouterPort,
	routerConfigToJson,
	toggleRouterRoute,
} from "@/data/nodes/router-edits";
import type { JsonValue } from "@/lib/types";

type RouterConfigPanelProps = {
	config: Record<string, JsonValue>;
	onChange: (values: Record<string, JsonValue>) => void;
};

/** The cell the pointer is over, so its row and column headers can light up. */
type HoveredCell = { inputId: string; outputId: string } | null;

type PortActions = {
	onRename: (label: string) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
};

export function RouterConfigPanel({ config, onChange }: RouterConfigPanelProps) {
	const router = getRouterConfigFromValue(config);
	const errors = [...new Set(validateRouterConfig(config))];
	const errorId = useId();
	const [hovered, setHovered] = useState<HoveredCell>(null);

	const commit = (next: RouterConfig) => onChange(routerConfigToJson(next));
	const portActions = (side: "inputs" | "outputs", portId: string): PortActions => ({
		onRename: (label) => commit(renameRouterPort(router, side, portId, label)),
		onMove: (direction) => commit(moveRouterPort(router, side, portId, direction)),
		onRemove: () => commit(removeRouterPort(router, side, portId)),
	});

	const incomingCounts = new Map(router.outputs.map((output) => [output.id, 0]));
	for (const route of router.routes) {
		incomingCounts.set(route.outputId, (incomingCounts.get(route.outputId) ?? 0) + 1);
	}
	const inputLabels = router.inputs.map((input, index) => routerPortLabel(input, index, "input"));
	const outputLabels = router.outputs.map((output, index) => routerPortLabel(output, index, "output"));

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

			<div className="overflow-x-auto rounded border border-baud-border bg-baud-panel">
				<table className="w-full border-separate border-spacing-0" aria-label="Router routes">
					<thead>
						<tr>
							<th
								scope="col"
								className="sticky left-0 z-10 border-r border-b border-baud-border bg-baud-panel px-2 py-1.5 text-left font-mono text-xs font-normal uppercase tracking-[0.18em] text-baud-muted"
							>
								Inputs \ Outputs
							</th>
							{router.outputs.map((output, index) => (
								<OutputHeader
									key={output.id}
									output={output}
									index={index}
									total={router.outputs.length}
									incoming={incomingCounts.get(output.id) ?? 0}
									highlighted={hovered?.outputId === output.id}
									actions={portActions("outputs", output.id)}
								/>
							))}
						</tr>
					</thead>
					<tbody>
						{router.inputs.map((input, inputIndex) => {
							const routes = getRouterRoutesForInput(router, input.id);
							const routeByOutput = new Map(routes.map((route) => [route.outputId, route]));
							const inputLabel = inputLabels[inputIndex];

							return (
								<tr key={input.id}>
									<InputHeader
										input={input}
										index={inputIndex}
										total={router.inputs.length}
										unrouted={routes.length === 0}
										highlighted={hovered?.inputId === input.id}
										actions={portActions("inputs", input.id)}
									/>
									{router.outputs.map((output, outputIndex) => (
										<RouteCell
											key={output.id}
											route={routeByOutput.get(output.id)}
											routeCount={routes.length}
											inputLabel={inputLabel}
											outputLabel={outputLabels[outputIndex]}
											highlighted={hovered?.inputId === input.id || hovered?.outputId === output.id}
											onHover={(active) => setHovered(active ? { inputId: input.id, outputId: output.id } : null)}
											onToggle={() => commit(toggleRouterRoute(router, input.id, output.id))}
											onMove={(routeId, direction) => commit(moveRouterRoute(router, routeId, direction))}
										/>
									))}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			<p className="font-mono text-xs text-baud-muted">
				Click a cell to connect an input to an output. The number is the execution order within that row.
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

function OutputHeader({
	output,
	index,
	total,
	incoming,
	highlighted,
	actions,
}: {
	output: RouterPortRow;
	index: number;
	total: number;
	incoming: number;
	highlighted: boolean;
	actions: PortActions;
}) {
	const position = index + 1;
	const label = routerPortLabel(output, index, "output");

	return (
		<th
			scope="col"
			className={`min-w-36 border-b border-baud-border px-2 py-1.5 text-left align-top font-normal transition-[background-color] ${
				highlighted ? "bg-baud-amber/10" : ""
			}`}
		>
			<div className="space-y-1">
				<Input
					aria-label={`Output ${position} label`}
					aria-invalid={!output.label.trim()}
					value={output.label}
					onChange={(event) => actions.onRename(event.target.value)}
				/>
				<div className="flex items-center gap-0.5">
					<IconButton label={`Move output ${position} left`} disabled={index === 0} onClick={() => actions.onMove(-1)}>
						<ArrowLeft size={13} />
					</IconButton>
					<IconButton
						label={`Move output ${position} right`}
						disabled={index === total - 1}
						onClick={() => actions.onMove(1)}
					>
						<ArrowRight size={13} />
					</IconButton>
					<IconButton label={`Remove output ${position}`} destructive disabled={total === 1} onClick={actions.onRemove}>
						<X size={13} />
					</IconButton>
					<output
						className={`ml-auto flex items-center gap-1 font-mono text-xs ${incoming === 0 ? "text-baud-danger" : "text-baud-muted"}`}
						aria-label={`${label} incoming routes`}
					>
						{incoming === 0 && <AlertTriangle size={12} />}
						{incoming} in
					</output>
				</div>
			</div>
		</th>
	);
}

function InputHeader({
	input,
	index,
	total,
	unrouted,
	highlighted,
	actions,
}: {
	input: RouterPortRow;
	index: number;
	total: number;
	unrouted: boolean;
	highlighted: boolean;
	actions: PortActions;
}) {
	const position = index + 1;
	const label = routerPortLabel(input, index, "input");

	return (
		<th
			scope="row"
			className={`sticky left-0 z-10 min-w-40 border-r border-b border-baud-border px-2 py-1.5 text-left align-top font-normal transition-[background-color] ${
				highlighted ? "bg-baud-amber/10" : "bg-baud-panel"
			}`}
		>
			<div className="space-y-1">
				<Input
					aria-label={`Input ${position} label`}
					aria-invalid={!input.label.trim()}
					value={input.label}
					onChange={(event) => actions.onRename(event.target.value)}
				/>
				<div className="flex items-center gap-0.5">
					<IconButton label={`Move input ${position} up`} disabled={index === 0} onClick={() => actions.onMove(-1)}>
						<ArrowUp size={13} />
					</IconButton>
					<IconButton
						label={`Move input ${position} down`}
						disabled={index === total - 1}
						onClick={() => actions.onMove(1)}
					>
						<ArrowDown size={13} />
					</IconButton>
					<IconButton label={`Remove input ${position}`} destructive disabled={total === 1} onClick={actions.onRemove}>
						<X size={13} />
					</IconButton>
					{unrouted && (
						<output
							className="ml-auto flex items-center gap-1 font-mono text-xs text-baud-danger"
							aria-label={`${label} has no routes`}
						>
							<AlertTriangle size={12} />
							no routes
						</output>
					)}
				</div>
			</div>
		</th>
	);
}

function RouteCell({
	route,
	routeCount,
	inputLabel,
	outputLabel,
	highlighted,
	onHover,
	onToggle,
	onMove,
}: {
	route: RouterRouteRow | undefined;
	routeCount: number;
	inputLabel: string;
	outputLabel: string;
	highlighted: boolean;
	onHover: (active: boolean) => void;
	onToggle: () => void;
	onMove: (routeId: string, direction: -1 | 1) => void;
}) {
	const name = `${inputLabel} to ${outputLabel}`;
	const connected = route !== undefined;
	const position = route ? route.order + 1 : 0;

	return (
		<td
			className={`group border-b border-baud-border p-1 text-center align-middle transition-[background-color] ${
				highlighted ? "bg-baud-amber/10" : ""
			}`}
			onMouseEnter={() => onHover(true)}
			onMouseLeave={() => onHover(false)}
		>
			<div className="flex items-center justify-center gap-0.5">
				{connected && (
					<IconButton
						label={`Move route ${name} earlier`}
						className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
						disabled={position === 1}
						onClick={() => onMove(route.id, -1)}
					>
						<ArrowLeft size={11} />
					</IconButton>
				)}
				<button
					type="button"
					aria-pressed={connected}
					aria-label={`Route ${name}`}
					title={connected ? `Route ${name}, executes ${position} of ${routeCount}` : `Route ${name}`}
					className={`flex size-8 items-center justify-center rounded border font-mono text-sm transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-baud-amber/60 ${
						connected
							? "border-baud-amber bg-baud-amber/20 text-white"
							: "border-baud-border bg-baud-soft text-transparent hover:border-baud-line hover:text-baud-muted"
					}`}
					onClick={onToggle}
				>
					{connected ? position : "+"}
				</button>
				{connected && (
					<IconButton
						label={`Move route ${name} later`}
						className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
						disabled={position === routeCount}
						onClick={() => onMove(route.id, 1)}
					>
						<ArrowRight size={11} />
					</IconButton>
				)}
			</div>
		</td>
	);
}

function IconButton({
	label,
	destructive = false,
	disabled = false,
	className,
	onClick,
	children,
}: {
	label: string;
	destructive?: boolean;
	disabled?: boolean;
	className?: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Button
			type="button"
			size="icon-xs"
			variant={destructive ? "destructive" : "ghost"}
			aria-label={label}
			title={label}
			disabled={disabled}
			className={className}
			onClick={onClick}
		>
			{children}
		</Button>
	);
}
