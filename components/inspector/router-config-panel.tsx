import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { FieldError } from "@/components/common/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	getRouterConfigFromValue,
	getRouterRoutesForInput,
	type RouterConfig,
	type RouterPortRow,
	routerPortLabel,
	validateRouterConfig,
} from "@/data/nodes/router";
import {
	addRouterPort,
	moveRouterPort,
	moveRouterRoute,
	type RouterPortSide,
	removeRouterPort,
	removeRouterRoute,
	renameRouterPort,
	routerConfigToJson,
	toggleRouterRoute,
} from "@/data/nodes/router-edits";
import type { JsonValue } from "@/lib/types";

type RouterConfigPanelProps = {
	config: Record<string, JsonValue>;
	onChange: (values: Record<string, JsonValue>) => void;
};

export function RouterConfigPanel({ config, onChange }: RouterConfigPanelProps) {
	const router = getRouterConfigFromValue(config);
	const errors = validateRouterConfig(config);
	const errorId = useId();
	const [selectedInputId, setSelectedInputId] = useState<string | null>(router.inputs[0]?.id ?? null);
	const selectedInput = router.inputs.find((input) => input.id === selectedInputId) ?? router.inputs[0] ?? null;
	const selectedRoutes = selectedInput ? getRouterRoutesForInput(router, selectedInput.id) : [];
	const routedOutputIds = new Set(selectedRoutes.map((route) => route.outputId));

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

			<div className="grid grid-cols-2 gap-3">
				<PortColumn
					side="inputs"
					ports={router.inputs}
					selectedId={selectedInput?.id ?? null}
					routedIds={new Set()}
					onSelect={(portId) => setSelectedInputId(portId)}
					onRename={(portId, label) => commit(renameRouterPort(router, "inputs", portId, label))}
					onMove={(portId, direction) => commit(moveRouterPort(router, "inputs", portId, direction))}
					onRemove={(portId) => {
						commit(removeRouterPort(router, "inputs", portId));
						if (selectedInputId === portId) setSelectedInputId(null);
					}}
				/>
				<PortColumn
					side="outputs"
					ports={router.outputs}
					selectedId={null}
					routedIds={routedOutputIds}
					onSelect={(portId) => {
						if (selectedInput) commit(toggleRouterRoute(router, selectedInput.id, portId));
					}}
					onRename={(portId, label) => commit(renameRouterPort(router, "outputs", portId, label))}
					onMove={(portId, direction) => commit(moveRouterPort(router, "outputs", portId, direction))}
					onRemove={(portId) => commit(removeRouterPort(router, "outputs", portId))}
				/>
			</div>

			<p className="font-mono text-xs text-baud-muted">
				{selectedInput
					? `Selected input: ${routerPortLabel(selectedInput, router.inputs.indexOf(selectedInput), "input")}. Click an output to toggle its route.`
					: "Add an input to start routing."}
			</p>

			<RouteList
				router={router}
				onMove={(routeId, direction) => commit(moveRouterRoute(router, routeId, direction))}
				onRemove={(routeId) => commit(removeRouterRoute(router, routeId))}
			/>

			{errors.length > 0 && (
				<ul className="space-y-1" aria-label="Router validation errors">
					{errors.map((error) => (
						<li key={error}>
							<FieldError id={`${errorId}-${error}`} message={`Router ${error}`} />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function PortColumn({
	side,
	ports,
	selectedId,
	routedIds,
	onSelect,
	onRename,
	onMove,
	onRemove,
}: {
	side: RouterPortSide;
	ports: RouterPortRow[];
	selectedId: string | null;
	routedIds: ReadonlySet<string>;
	onSelect: (portId: string) => void;
	onRename: (portId: string, label: string) => void;
	onMove: (portId: string, direction: -1 | 1) => void;
	onRemove: (portId: string) => void;
}) {
	const noun = side === "inputs" ? "input" : "output";
	const title = side === "inputs" ? "Inputs" : "Outputs";

	return (
		<div className="space-y-2">
			<div className="font-mono text-xs uppercase tracking-[0.18em] text-baud-muted">{title}</div>
			<ul className="space-y-2" aria-label={`Router ${side}`}>
				{ports.map((port, index) => {
					const position = index + 1;
					const active = side === "inputs" ? port.id === selectedId : routedIds.has(port.id);
					const selectLabel = side === "inputs" ? `Select input ${position}` : `Toggle route to output ${position}`;

					return (
						<li
							key={port.id}
							className={`space-y-1 rounded border p-2 transition-[border-color] ${
								active ? "border-baud-amber bg-baud-panel" : "border-baud-border bg-baud-panel"
							}`}
						>
							<div className="flex items-center gap-1">
								<Button
									type="button"
									size="xs"
									variant={active ? "primary" : "subtle"}
									aria-pressed={active}
									aria-label={selectLabel}
									title={selectLabel}
									onClick={() => onSelect(port.id)}
								>
									{position}
								</Button>
								<Input
									aria-label={`${title.slice(0, -1)} ${position} label`}
									aria-invalid={!port.label.trim()}
									value={port.label}
									onChange={(event) => onRename(port.id, event.target.value)}
								/>
							</div>
							<div className="flex justify-end gap-1">
								<Button
									type="button"
									size="xsIcon"
									variant="ghost"
									aria-label={`Move ${noun} ${position} up`}
									title={`Move ${noun} ${position} up`}
									disabled={index === 0}
									onClick={() => onMove(port.id, -1)}
								>
									<ArrowUp size={13} />
								</Button>
								<Button
									type="button"
									size="xsIcon"
									variant="ghost"
									aria-label={`Move ${noun} ${position} down`}
									title={`Move ${noun} ${position} down`}
									disabled={index === ports.length - 1}
									onClick={() => onMove(port.id, 1)}
								>
									<ArrowDown size={13} />
								</Button>
								<Button
									type="button"
									size="xsIcon"
									variant="destructive"
									aria-label={`Remove ${noun} ${position}`}
									title={`Remove ${noun} ${position}`}
									disabled={ports.length === 1}
									onClick={() => onRemove(port.id)}
								>
									<X size={13} />
								</Button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function RouteList({
	router,
	onMove,
	onRemove,
}: {
	router: RouterConfig;
	onMove: (routeId: string, direction: -1 | 1) => void;
	onRemove: (routeId: string) => void;
}) {
	let position = 0;

	return (
		<div className="space-y-2">
			<div className="font-mono text-xs uppercase tracking-[0.18em] text-baud-muted">Routes</div>
			<ul className="space-y-1" aria-label="Router routes">
				{router.inputs.flatMap((input, inputIndex) => {
					const routes = getRouterRoutesForInput(router, input.id);
					const inputLabel = routerPortLabel(input, inputIndex, "input");
					return routes.map((route, routeIndex) => {
						position += 1;
						const current = position;
						const outputIndex = router.outputs.findIndex((output) => output.id === route.outputId);
						const output = router.outputs[outputIndex];
						const outputLabel = output ? routerPortLabel(output, outputIndex, "output") : route.outputId;

						return (
							<li
								key={route.id}
								className="flex items-center gap-2 rounded border border-baud-border bg-baud-panel px-2 py-1 font-mono text-sm"
							>
								<span className="w-6 shrink-0 text-baud-muted">{routeIndex + 1}.</span>
								<span className="min-w-0 flex-1 truncate text-baud-text">
									{inputLabel} to {outputLabel}
								</span>
								<Button
									type="button"
									size="xsIcon"
									variant="ghost"
									aria-label={`Move route ${current} up`}
									title={`Move route ${current} up`}
									disabled={routeIndex === 0}
									onClick={() => onMove(route.id, -1)}
								>
									<ArrowUp size={13} />
								</Button>
								<Button
									type="button"
									size="xsIcon"
									variant="ghost"
									aria-label={`Move route ${current} down`}
									title={`Move route ${current} down`}
									disabled={routeIndex === routes.length - 1}
									onClick={() => onMove(route.id, 1)}
								>
									<ArrowDown size={13} />
								</Button>
								<Button
									type="button"
									size="xsIcon"
									variant="destructive"
									aria-label={`Remove route ${current}`}
									title={`Remove route ${current}`}
									onClick={() => onRemove(route.id)}
								>
									<X size={13} />
								</Button>
							</li>
						);
					});
				})}
			</ul>
			{router.routes.length === 0 && (
				<div className="rounded border border-baud-border bg-baud-soft px-3 py-2 font-mono text-sm text-baud-muted">
					No routes. Select an input and click an output.
				</div>
			)}
		</div>
	);
}
