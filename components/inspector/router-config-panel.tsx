import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, Plus, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useRef, useState } from "react";
import { FieldError } from "@/components/common/field-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
	addRouterRoute,
	moveRouterPort,
	moveRouterRoute,
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

/** Geometry of one canvas rendering; the inspector and the expanded dialog use different presets. */
type CanvasMetrics = {
	pillHeight: number;
	rowStride: number;
	padding: number;
	pillWidthRatio: number;
	minPillWidth: number;
	/** Order badges need room between the columns; the compact inspector view leaves order to the toolbar. */
	showOrderBadges: boolean;
};

const COMPACT_METRICS: CanvasMetrics = {
	pillHeight: 32,
	rowStride: 56,
	padding: 12,
	pillWidthRatio: 0.36,
	minPillWidth: 100,
	showOrderBadges: false,
};
const EXPANDED_METRICS: CanvasMetrics = {
	pillHeight: 40,
	rowStride: 72,
	padding: 20,
	pillWidthRatio: 0.3,
	minPillWidth: 200,
	showOrderBadges: true,
};

type PortSide = "inputs" | "outputs";

type Selection = { kind: "port"; side: PortSide; id: string } | { kind: "route"; id: string } | null;

type DragState = {
	inputId: string;
	pointerX: number;
	pointerY: number;
	targetOutputId: string | null;
};

export function RouterConfigPanel({ config, onChange }: RouterConfigPanelProps) {
	const router = getRouterConfigFromValue(config);
	const errors = [...new Set(validateRouterConfig(config))];
	const errorId = useId();
	const [selection, setSelection] = useState<Selection>(null);
	const [expanded, setExpanded] = useState(false);
	const commit = (next: RouterConfig) => onChange(routerConfigToJson(next));
	const addInput = () => {
		const next = addRouterPort(router, "inputs");
		commit(next);
		setSelection({ kind: "port", side: "inputs", id: next.inputs[next.inputs.length - 1].id });
	};
	const addOutput = () => {
		const next = addRouterPort(router, "outputs");
		commit(next);
		setSelection({ kind: "port", side: "outputs", id: next.outputs[next.outputs.length - 1].id });
	};

	const selectionIsLive =
		selection?.kind === "port"
			? router[selection.side].some((port) => port.id === selection.id)
			: selection?.kind === "route"
				? router.routes.some((route) => route.id === selection.id)
				: false;
	const liveSelection = selectionIsLive ? selection : null;

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" onClick={addInput}>
					<Plus size={13} />
					Add input
				</Button>
				<Button type="button" size="sm" onClick={addOutput}>
					<Plus size={13} />
					Add output
				</Button>
				<Button
					type="button"
					size="sm"
					variant="subtle"
					className="ml-auto"
					aria-label="Expand router routes"
					title="Open the routes in a larger editor"
					onClick={() => setExpanded(true)}
				>
					<Maximize2 size={13} />
					Expand
				</Button>
			</div>

			<RouterCanvas
				router={router}
				commit={commit}
				selection={liveSelection}
				onSelect={setSelection}
				metrics={COMPACT_METRICS}
			/>

			<SelectionToolbar router={router} selection={liveSelection} commit={commit} onSelect={setSelection} />

			<Dialog open={expanded} onOpenChange={setExpanded}>
				<DialogContent
					className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl"
					showCloseButton={false}
				>
					<DialogHeader className="flex flex-row items-start justify-between gap-4 border-b border-baud-border p-4">
						<div>
							<DialogTitle>Router routes</DialogTitle>
							<DialogDescription>
								Drag from an input's handle to an output to connect them. Click a pill or a line to edit it.
							</DialogDescription>
						</div>
						<Button
							type="button"
							onClick={() => setExpanded(false)}
							aria-label="Close router routes"
							size="icon"
							variant="icon"
						>
							<X size={15} />
						</Button>
					</DialogHeader>
					<div className="min-h-0 overflow-y-auto p-4">
						{expanded && (
							<RouterCanvas
								router={router}
								commit={commit}
								selection={liveSelection}
								onSelect={setSelection}
								metrics={EXPANDED_METRICS}
							/>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2 border-t border-baud-border p-4">
						<Button type="button" size="sm" onClick={addInput}>
							<Plus size={13} />
							Add input
						</Button>
						<Button type="button" size="sm" onClick={addOutput}>
							<Plus size={13} />
							Add output
						</Button>
						<div className="min-w-0 flex-1">
							<SelectionToolbar router={router} selection={liveSelection} commit={commit} onSelect={setSelection} />
						</div>
					</div>
				</DialogContent>
			</Dialog>

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

function RouterCanvas({
	router,
	commit,
	selection,
	onSelect,
	metrics,
}: {
	router: RouterConfig;
	commit: (next: RouterConfig) => void;
	selection: Selection;
	onSelect: (selection: Selection) => void;
	metrics: CanvasMetrics;
}) {
	const { pillHeight, rowStride, padding, pillWidthRatio, minPillWidth, showOrderBadges } = metrics;
	const containerRef = useRef<HTMLElement>(null);
	const [width, setWidth] = useState(0);
	const [drag, setDrag] = useState<DragState | null>(null);
	const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(element);
		setWidth(element.clientWidth);
		return () => observer.disconnect();
	}, []);

	const pillWidth = Math.max(minPillWidth, Math.round(width * pillWidthRatio));
	const outputX = Math.max(pillWidth, width - pillWidth);
	const rows = Math.max(router.inputs.length, router.outputs.length, 1);
	const height = padding * 2 + (rows - 1) * rowStride + pillHeight;
	const centerY = (index: number) => padding + index * rowStride + pillHeight / 2;

	const inputIndex = new Map(router.inputs.map((input, index) => [input.id, index]));
	const outputIndex = new Map(router.outputs.map((output, index) => [output.id, index]));
	const inputLabels = router.inputs.map((input, index) => routerPortLabel(input, index, "input"));
	const outputLabels = router.outputs.map((output, index) => routerPortLabel(output, index, "output"));
	const incoming = new Map(router.outputs.map((output) => [output.id, 0]));
	const routedInputs = new Set<string>();
	for (const route of router.routes) {
		incoming.set(route.outputId, (incoming.get(route.outputId) ?? 0) + 1);
		routedInputs.add(route.inputId);
	}
	const selectedRoute =
		selection?.kind === "route" ? router.routes.find((route) => route.id === selection.id) : undefined;
	const emphasizedRoute = selectedRoute ?? router.routes.find((route) => route.id === hoveredRouteId);

	const toLocal = (clientX: number, clientY: number) => {
		const rect = containerRef.current?.getBoundingClientRect();
		return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
	};

	const outputUnderPointer = (clientX: number, clientY: number) => {
		const element = document.elementFromPoint(clientX, clientY);
		const pill = element?.closest<HTMLElement>("[data-output-id]");
		return pill?.dataset.outputId ?? null;
	};

	const startDrag = (inputId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const point = toLocal(event.clientX, event.clientY);
		onSelect(null);
		setDrag({ inputId, pointerX: point.x, pointerY: point.y, targetOutputId: null });
	};

	const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (!drag) return;
		const point = toLocal(event.clientX, event.clientY);
		setDrag({
			...drag,
			pointerX: point.x,
			pointerY: point.y,
			targetOutputId: outputUnderPointer(event.clientX, event.clientY),
		});
	};

	const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (!drag) return;
		const target = outputUnderPointer(event.clientX, event.clientY);
		if (target) {
			const next = addRouterRoute(router, drag.inputId, target);
			commit(next);
			const created = next.routes.find((route) => route.inputId === drag.inputId && route.outputId === target);
			if (created) onSelect({ kind: "route", id: created.id });
		}
		setDrag(null);
	};

	const routeName = (route: RouterRouteRow) =>
		`${inputLabels[inputIndex.get(route.inputId) ?? 0]} to ${outputLabels[outputIndex.get(route.outputId) ?? 0]}`;

	return (
		<section
			ref={containerRef}
			className="relative select-none rounded border border-baud-border bg-baud-soft/40"
			style={{ height }}
			aria-label="Router routes"
		>
			<svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
				{router.routes.map((route) => {
					const from = inputIndex.get(route.inputId);
					const to = outputIndex.get(route.outputId);
					if (from === undefined || to === undefined) return null;
					const active = route.id === emphasizedRoute?.id;
					return (
						<path
							key={route.id}
							d={linePath(pillWidth, centerY(from), outputX, centerY(to))}
							fill="none"
							stroke={
								active ? "var(--color-baud-amber)" : "color-mix(in oklch, var(--color-baud-amber) 70%, transparent)"
							}
							strokeWidth={active ? 3 : 2}
						/>
					);
				})}
				{drag && inputIndex.has(drag.inputId) && (
					<path
						d={linePath(pillWidth, centerY(inputIndex.get(drag.inputId) ?? 0), drag.pointerX, drag.pointerY)}
						fill="none"
						stroke={drag.targetOutputId ? "var(--color-baud-green)" : "var(--color-baud-muted)"}
						strokeDasharray="6 4"
						strokeWidth={2}
					/>
				)}
			</svg>

			{/* Clickable line targets and order badges sit above the drawn lines. */}
			<svg className="absolute inset-0 h-full w-full" aria-label="Routes">
				<title>Routes</title>
				{router.routes.map((route) => {
					const from = inputIndex.get(route.inputId);
					const to = outputIndex.get(route.outputId);
					if (from === undefined || to === undefined) return null;
					const name = routeName(route);
					const order = route.order + 1;
					const siblings = getRouterRoutesForInput(router, route.inputId).length;
					const badge = pointOnLine(
						pillWidth,
						centerY(from),
						outputX,
						centerY(to),
						Math.min(0.8, 0.35 + route.order * 0.15),
					);
					const selected = selectedRoute?.id === route.id;
					return (
						<g key={route.id}>
							{/* biome-ignore lint/a11y/useSemanticElements: the hit target must follow the drawn curve, which only an SVG path can do; it carries a name, focus, and keyboard activation itself. */}
							<path
								d={linePath(pillWidth, centerY(from), outputX, centerY(to))}
								fill="none"
								stroke="transparent"
								strokeWidth={14}
								className="cursor-pointer"
								role="button"
								tabIndex={0}
								aria-label={`Route ${name}, order ${order}`}
								aria-pressed={selected}
								onClick={() => onSelect(selected ? null : { kind: "route", id: route.id })}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onSelect(selected ? null : { kind: "route", id: route.id });
									}
								}}
								onMouseEnter={() => setHoveredRouteId(route.id)}
								onMouseLeave={() => setHoveredRouteId(null)}
							/>
							{showOrderBadges && siblings > 1 && (
								<g transform={`translate(${badge.x}, ${badge.y})`} pointerEvents="none">
									<circle
										r={8}
										fill="var(--color-baud-panel)"
										stroke="var(--color-baud-amber)"
										strokeWidth={selected ? 2 : 1.5}
									/>
									<text
										textAnchor="middle"
										dominantBaseline="central"
										fontSize={10}
										fontFamily="ui-monospace, monospace"
										fill="var(--color-baud-text)"
									>
										{order}
									</text>
								</g>
							)}
						</g>
					);
				})}
			</svg>

			<ul className="absolute top-0 left-0" style={{ width: pillWidth }} aria-label="Router inputs">
				{router.inputs.map((input, index) => (
					<PortPill
						key={input.id}
						label={inputLabels[index]}
						top={padding + index * rowStride}
						height={pillHeight}
						warning={!routedInputs.has(input.id) ? `${inputLabels[index]} has no routes` : null}
						selected={selection?.kind === "port" && selection.side === "inputs" && selection.id === input.id}
						highlighted={drag?.inputId === input.id || emphasizedRoute?.inputId === input.id}
						onSelect={() =>
							onSelect(
								selection?.kind === "port" && selection.side === "inputs" && selection.id === input.id
									? null
									: { kind: "port", side: "inputs", id: input.id },
							)
						}
						handle={
							<button
								type="button"
								className={`absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-baud-amber bg-baud-panel transition-transform hover:scale-125 ${
									drag?.inputId === input.id ? "scale-125 bg-baud-amber" : ""
								}`}
								aria-label={`Drag from ${inputLabels[index]} to connect`}
								title={`Drag to an output to connect ${inputLabels[index]}`}
								onPointerDown={(event) => startDrag(input.id, event)}
								onPointerMove={moveDrag}
								onPointerUp={endDrag}
								onPointerCancel={() => setDrag(null)}
							/>
						}
					/>
				))}
			</ul>

			<ul className="absolute top-0" style={{ left: outputX, width: pillWidth }} aria-label="Router outputs">
				{router.outputs.map((output, index) => (
					<PortPill
						key={output.id}
						label={outputLabels[index]}
						top={padding + index * rowStride}
						height={pillHeight}
						warning={(incoming.get(output.id) ?? 0) === 0 ? `${outputLabels[index]} is not reached` : null}
						description={`${incoming.get(output.id) ?? 0} incoming route${(incoming.get(output.id) ?? 0) === 1 ? "" : "s"}`}
						dataOutputId={output.id}
						selected={selection?.kind === "port" && selection.side === "outputs" && selection.id === output.id}
						highlighted={drag?.targetOutputId === output.id || emphasizedRoute?.outputId === output.id}
						onSelect={() =>
							onSelect(
								selection?.kind === "port" && selection.side === "outputs" && selection.id === output.id
									? null
									: { kind: "port", side: "outputs", id: output.id },
							)
						}
					/>
				))}
			</ul>
		</section>
	);
}

function PortPill({
	label,
	top,
	height,
	warning,
	description,
	dataOutputId,
	selected,
	highlighted,
	onSelect,
	handle,
}: {
	label: string;
	top: number;
	height: number;
	warning: string | null;
	description?: string;
	dataOutputId?: string;
	selected: boolean;
	highlighted: boolean;
	onSelect: () => void;
	handle?: React.ReactNode;
}) {
	return (
		<li className="absolute left-0 w-full" style={{ top, height }} data-output-id={dataOutputId}>
			<div
				className={`relative flex h-full items-center rounded border bg-baud-panel transition-[border-color,box-shadow] ${
					selected
						? "border-baud-red shadow-[0_0_0_2px_rgb(230_45_62_/_0.25)]"
						: highlighted
							? "border-baud-amber shadow-[0_0_0_2px_rgb(245_185_66_/_0.25)]"
							: warning
								? "border-baud-danger/70"
								: "border-baud-border"
				}`}
			>
				<button
					type="button"
					className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left font-mono text-sm text-baud-text"
					aria-pressed={selected}
					aria-label={label}
					title={warning ?? (description ? `${label}: ${description}` : label)}
					onClick={onSelect}
				>
					<span className="min-w-0 flex-1 truncate">{label}</span>
					{warning && <AlertTriangle size={12} className="shrink-0 text-baud-danger" aria-label={warning} />}
				</button>
				{handle}
			</div>
		</li>
	);
}

function SelectionToolbar({
	router,
	selection,
	commit,
	onSelect,
}: {
	router: RouterConfig;
	selection: Selection;
	commit: (next: RouterConfig) => void;
	onSelect: (selection: Selection) => void;
}) {
	if (!selection) {
		return (
			<p className="font-mono text-xs text-baud-muted">
				Drag from an input's handle to an output to connect them. Click a pill or a line to edit it.
			</p>
		);
	}

	if (selection.kind === "route") {
		const route = router.routes.find((candidate) => candidate.id === selection.id);
		if (!route) return null;
		const inputIndex = router.inputs.findIndex((input) => input.id === route.inputId);
		const outputIndex = router.outputs.findIndex((output) => output.id === route.outputId);
		const name = `${routerPortLabel(router.inputs[inputIndex], inputIndex, "input")} to ${routerPortLabel(router.outputs[outputIndex], outputIndex, "output")}`;
		const count = getRouterRoutesForInput(router, route.inputId).length;
		const order = route.order + 1;

		return (
			<div
				className="flex items-center gap-1 rounded border border-baud-border bg-baud-panel px-2 py-1"
				role="toolbar"
				aria-label={`Route ${name}`}
			>
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-baud-text" title={name}>
					Order {order} of {count}
				</span>
				<IconButton
					label={`Move route ${name} earlier`}
					disabled={order === 1}
					onClick={() => commit(moveRouterRoute(router, route.id, -1))}
				>
					<ArrowLeft size={12} />
				</IconButton>
				<IconButton
					label={`Move route ${name} later`}
					disabled={order === count}
					onClick={() => commit(moveRouterRoute(router, route.id, 1))}
				>
					<ArrowRight size={12} />
				</IconButton>
				<IconButton
					label={`Remove route ${name}`}
					destructive
					onClick={() => {
						commit(removeRouterRoute(router, route.id));
						onSelect(null);
					}}
				>
					<X size={12} />
				</IconButton>
			</div>
		);
	}

	const ports = router[selection.side];
	const index = ports.findIndex((port) => port.id === selection.id);
	const port: RouterPortRow | undefined = ports[index];
	if (!port) return null;
	const noun = selection.side === "inputs" ? "input" : "output";
	const title = selection.side === "inputs" ? "Input" : "Output";
	const position = index + 1;

	return (
		<div
			className="flex items-center gap-1 rounded border border-baud-border bg-baud-panel px-2 py-1"
			role="toolbar"
			aria-label={`${title} ${position}`}
		>
			<Input
				aria-label={`${title} ${position} label`}
				aria-invalid={!port.label.trim()}
				className="h-7 min-w-0 flex-1 text-sm"
				placeholder={`${title} ${position}`}
				value={port.label}
				onChange={(event) => commit(renameRouterPort(router, selection.side, port.id, event.target.value))}
			/>
			<IconButton
				label={`Move ${noun} ${position} up`}
				disabled={index === 0}
				onClick={() => commit(moveRouterPort(router, selection.side, port.id, -1))}
			>
				<ArrowUp size={12} />
			</IconButton>
			<IconButton
				label={`Move ${noun} ${position} down`}
				disabled={index === ports.length - 1}
				onClick={() => commit(moveRouterPort(router, selection.side, port.id, 1))}
			>
				<ArrowDown size={12} />
			</IconButton>
			<IconButton
				label={`Remove ${noun} ${position}`}
				destructive
				disabled={ports.length === 1}
				onClick={() => {
					commit(removeRouterPort(router, selection.side, port.id));
					onSelect(null);
				}}
			>
				<X size={12} />
			</IconButton>
		</div>
	);
}

function lineBend(x1: number, x2: number) {
	return Math.max(24, Math.abs(x2 - x1) * 0.4);
}

function linePath(x1: number, y1: number, x2: number, y2: number) {
	const bend = lineBend(x1, x2);
	return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

/** A point along the same cubic curve linePath draws, so badges sit on their own line. */
function pointOnLine(x1: number, y1: number, x2: number, y2: number, t: number) {
	const bend = lineBend(x1, x2);
	const [c1x, c1y, c2x, c2y] = [x1 + bend, y1, x2 - bend, y2];
	const u = 1 - t;
	return {
		x: u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2,
		y: u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2,
	};
}

function IconButton({
	label,
	destructive = false,
	disabled = false,
	onClick,
	children,
}: {
	label: string;
	destructive?: boolean;
	disabled?: boolean;
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
			onClick={onClick}
		>
			{children}
		</Button>
	);
}
