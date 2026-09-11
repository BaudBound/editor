import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, Plus, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { FieldError } from "@/components/common/field-error";
import { Button } from "@/components/ui/button";
import { ColorPicker, ColorPickerHue, ColorPickerSelection } from "@/components/ui/color-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	getRouterConfigFromValue,
	getRouterRoutesForInput,
	type RouterConfig,
	type RouterPortRow,
	type RouterRouteRow,
	routerPortColor,
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
	setRouterPortColor,
} from "@/data/nodes/router-edits";
import type { JsonValue } from "@/lib/types";
import { dynamicColorBackground, rgbArrayToHex } from "./color-config-input";

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
	/** Horizontal space between the frame and the pills. */
	inset: number;
	/** Order badges need room between the columns; the compact inspector view leaves order to the toolbar. */
	showOrderBadges: boolean;
	/** The inspector shows a read-only preview; editing happens in the expanded dialog. */
	interactive: boolean;
};

const COMPACT_METRICS: CanvasMetrics = {
	pillHeight: 32,
	rowStride: 56,
	padding: 12,
	pillWidthRatio: 0.32,
	minPillWidth: 88,
	inset: 12,
	showOrderBadges: false,
	interactive: false,
};
const EXPANDED_METRICS: CanvasMetrics = {
	pillHeight: 40,
	rowStride: 72,
	padding: 20,
	pillWidthRatio: 0.24,
	minPillWidth: 160,
	inset: 24,
	showOrderBadges: true,
	interactive: true,
};

/** Lines and handles without a chosen color keep the editor's amber. */
const DEFAULT_LINE_COLOR = "var(--color-baud-amber)";
/** Quick picks in the color popover; the picker below them covers everything else. */
const PORT_COLOR_PRESETS = [
	{ name: "Red", hex: "#E62D3E" },
	{ name: "Orange", hex: "#FB923C" },
	{ name: "Amber", hex: "#F5A623" },
	{ name: "Green", hex: "#3ECF8E" },
	{ name: "Cyan", hex: "#22D3EE" },
	{ name: "Blue", hex: "#5B8AF5" },
	{ name: "Violet", hex: "#A78BFA" },
	{ name: "Pink", hex: "#F472B6" },
];

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
	const closeDialog = () => {
		setExpanded(false);
		setSelection(null);
	};
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
			{/* The preview never reflects the dialog's selection; it only mirrors the routing itself. */}
			<RouterCanvas router={router} commit={commit} selection={null} onSelect={() => {}} metrics={COMPACT_METRICS} />

			<Button
				type="button"
				variant="primary"
				className="w-full"
				aria-label="Edit router routes"
				title="Open the routes editor"
				onClick={() => setExpanded(true)}
			>
				<Maximize2 size={14} />
				Edit routes
			</Button>

			<Dialog open={expanded} onOpenChange={(open) => (open ? setExpanded(true) : closeDialog())}>
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
						<Button type="button" onClick={closeDialog} aria-label="Close router routes" size="icon" variant="icon">
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
						{errors.length > 0 && (
							<ul className="w-full space-y-1" aria-label="Router validation errors">
								{errors.map((error, index) => (
									<li key={error}>
										<FieldError id={`${errorId}-dialog-${index}`} message={`Router ${error}`} />
									</li>
								))}
							</ul>
						)}
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
	const { pillHeight, rowStride, padding, pillWidthRatio, minPillWidth, inset, showOrderBadges, interactive } = metrics;
	const containerRef = useRef<HTMLElement>(null);
	const [width, setWidth] = useState(0);
	const [drag, setDrag] = useState<DragState | null>(null);
	const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
	// Each canvas instance (preview and dialog) needs its own gradient ids; useId may contain colons that break url().
	const gradientId = useId().replace(/[^a-zA-Z0-9]/g, "");

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
	const inputRight = inset + pillWidth;
	const outputX = Math.max(inputRight + 32, width - inset - pillWidth);
	const rows = Math.max(router.inputs.length, router.outputs.length, 1);
	const height = padding * 2 + (rows - 1) * rowStride + pillHeight;
	const centerY = (index: number) => padding + index * rowStride + pillHeight / 2;

	const inputIndex = new Map(router.inputs.map((input, index) => [input.id, index]));
	const outputIndex = new Map(router.outputs.map((output, index) => [output.id, index]));
	const inputLabels = router.inputs.map((input, index) => routerPortLabel(input, index, "input"));
	const outputLabels = router.outputs.map((output, index) => routerPortLabel(output, index, "output"));
	const inputColors = router.inputs.map((input) => routerPortColor(input));
	const outputColors = router.outputs.map((output) => routerPortColor(output));
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
			aria-label={interactive ? "Router routes" : "Router routes preview"}
		>
			<svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
				<defs>
					{/* Each line fades from its input's color to its output's color so it can be followed across crossings. */}
					{router.routes.map((route) => {
						const from = inputIndex.get(route.inputId);
						const to = outputIndex.get(route.outputId);
						if (from === undefined || to === undefined) return null;
						return (
							<linearGradient
								key={route.id}
								id={`${gradientId}-${route.id}`}
								gradientUnits="userSpaceOnUse"
								x1={inputRight}
								y1={0}
								x2={outputX}
								y2={0}
							>
								<stop offset="0%" style={{ stopColor: inputColors[from] ?? DEFAULT_LINE_COLOR }} />
								<stop offset="100%" style={{ stopColor: outputColors[to] ?? DEFAULT_LINE_COLOR }} />
							</linearGradient>
						);
					})}
				</defs>
				{router.routes.map((route) => {
					const from = inputIndex.get(route.inputId);
					const to = outputIndex.get(route.outputId);
					if (from === undefined || to === undefined) return null;
					const active = route.id === emphasizedRoute?.id;
					return (
						<path
							key={route.id}
							d={linePath(inputRight, centerY(from), outputX, centerY(to))}
							fill="none"
							stroke={`url(#${gradientId}-${route.id})`}
							strokeOpacity={active ? 1 : 0.7}
							strokeWidth={active ? 3 : 2}
						/>
					);
				})}
				{drag && inputIndex.has(drag.inputId) && (
					<path
						d={linePath(inputRight, centerY(inputIndex.get(drag.inputId) ?? 0), drag.pointerX, drag.pointerY)}
						fill="none"
						stroke={drag.targetOutputId ? "var(--color-baud-green)" : "var(--color-baud-muted)"}
						strokeDasharray="6 4"
						strokeWidth={2}
					/>
				)}
			</svg>

			{/* Clickable line targets and order badges sit above the drawn lines. */}
			{interactive && (
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
							inputRight,
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
									d={linePath(inputRight, centerY(from), outputX, centerY(to))}
									fill="none"
									stroke="transparent"
									strokeWidth={14}
									className="cursor-pointer"
									style={{ outline: "none" }}
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
									onFocus={() => setHoveredRouteId(route.id)}
									onBlur={() => setHoveredRouteId(null)}
								/>
								{showOrderBadges && siblings > 1 && (
									<g transform={`translate(${badge.x}, ${badge.y})`} pointerEvents="none">
										<circle
											r={8}
											fill="var(--color-baud-panel)"
											stroke={inputColors[from] ?? DEFAULT_LINE_COLOR}
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
			)}

			<ul className="absolute top-0" style={{ left: inset, width: pillWidth }} aria-label="Router inputs">
				{router.inputs.map((input, index) => (
					<PortPill
						key={input.id}
						label={inputLabels[index]}
						top={padding + index * rowStride}
						height={pillHeight}
						warning={!routedInputs.has(input.id) ? `${inputLabels[index]} has no routes` : null}
						color={inputColors[index]}
						interactive={interactive}
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
							interactive && (
								<button
									type="button"
									className={`absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-baud-amber bg-baud-panel transition-transform hover:scale-125 ${
										drag?.inputId === input.id ? "scale-125 bg-baud-amber" : ""
									}`}
									style={inputColors[index] ? { borderColor: inputColors[index] } : undefined}
									aria-label={`Drag from ${inputLabels[index]} to connect`}
									title={`Drag to an output to connect ${inputLabels[index]}`}
									onPointerDown={(event) => startDrag(input.id, event)}
									onPointerMove={moveDrag}
									onPointerUp={endDrag}
									onPointerCancel={() => setDrag(null)}
								/>
							)
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
						color={outputColors[index]}
						interactive={interactive}
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
	color,
	interactive,
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
	color: string | null;
	interactive: boolean;
	selected: boolean;
	highlighted: boolean;
	onSelect: () => void;
	handle?: React.ReactNode;
}) {
	return (
		<li
			className="absolute left-0 w-full"
			style={{ top, height }}
			data-output-id={dataOutputId}
			data-port-color={color ?? undefined}
		>
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
				{interactive ? (
					<button
						type="button"
						className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left font-mono text-sm text-baud-text"
						aria-pressed={selected}
						aria-label={label}
						title={warning ?? (description ? `${label}: ${description}` : label)}
						onClick={onSelect}
					>
						{color && (
							<span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
						)}
						<span className="min-w-0 flex-1 truncate">{label}</span>
						{warning && <AlertTriangle size={12} className="shrink-0 text-baud-danger" aria-label={warning} />}
					</button>
				) : (
					<div
						className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left font-mono text-sm text-baud-text"
						title={warning ?? (description ? `${label}: ${description}` : label)}
					>
						{color && (
							<span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
						)}
						<span className="min-w-0 flex-1 truncate">{label}</span>
						{warning && <AlertTriangle size={12} className="shrink-0 text-baud-danger" aria-label={warning} />}
					</div>
				)}
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
			<PortColorControl
				label={`${title} ${position}`}
				color={routerPortColor(port)}
				onChange={(color) => commit(setRouterPortColor(router, selection.side, port.id, color))}
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

/** Swatch button opening presets plus the full picker; null clears back to the default styling. */
function PortColorControl({
	label,
	color,
	onChange,
}: {
	label: string;
	color: string | null;
	onChange: (color: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const [pickerStart, setPickerStart] = useState(color ?? PORT_COLOR_PRESETS[5].hex);
	// The picker reports its initial value on mount; only user interaction may commit.
	const hasInteracted = useRef(false);
	const onChangeRef = useRef(onChange);
	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);
	const handlePickerChange = useCallback((rgba: [number, number, number, number]) => {
		if (!hasInteracted.current) return;
		onChangeRef.current(rgbArrayToHex(rgba));
	}, []);
	const choose = (next: string | null) => {
		hasInteracted.current = false;
		setPickerStart(next ?? PORT_COLOR_PRESETS[5].hex);
		onChange(next);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (next) {
					hasInteracted.current = false;
					setPickerStart(color ?? PORT_COLOR_PRESETS[5].hex);
				}
				setOpen(next);
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${label} color`}
					aria-expanded={open}
					title={color ? `Color ${color}` : "Default color"}
					className="size-7 shrink-0 rounded border border-baud-border transition-[filter] hover:brightness-110"
					style={{ background: color ?? dynamicColorBackground }}
				/>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 gap-3 p-3" side="top" sideOffset={8}>
				<PopoverHeader>
					<PopoverTitle>{label} color</PopoverTitle>
					<PopoverDescription>Shown on the node handle and on every line touching this port.</PopoverDescription>
				</PopoverHeader>
				<fieldset className="flex flex-wrap items-center gap-1.5 border-0 p-0" aria-label={`${label} color presets`}>
					{PORT_COLOR_PRESETS.map((preset) => (
						<button
							key={preset.hex}
							type="button"
							aria-label={`Use ${preset.name}`}
							aria-pressed={color === preset.hex}
							title={preset.name}
							className={`size-6 rounded-full border-2 transition-transform hover:scale-110 ${
								color === preset.hex ? "border-white" : "border-transparent"
							}`}
							style={{ background: preset.hex }}
							onClick={() => choose(preset.hex)}
						/>
					))}
					<button
						type="button"
						aria-label="Use default color"
						aria-pressed={color === null}
						title="Default"
						className={`size-6 rounded-full border-2 transition-transform hover:scale-110 ${
							color === null ? "border-white" : "border-baud-border"
						}`}
						style={{ background: dynamicColorBackground }}
						onClick={() => choose(null)}
					/>
				</fieldset>
				<div
					onPointerDownCapture={() => {
						hasInteracted.current = true;
					}}
					onKeyDownCapture={() => {
						hasInteracted.current = true;
					}}
				>
					<ColorPicker
						key={pickerStart}
						className="h-auto w-full gap-3"
						defaultValue={pickerStart}
						onChange={handlePickerChange}
					>
						<ColorPickerSelection aria-label={`${label} saturation and lightness`} className="h-28" />
						<ColorPickerHue aria-label={`${label} hue`} />
					</ColorPicker>
				</div>
			</PopoverContent>
		</Popover>
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
