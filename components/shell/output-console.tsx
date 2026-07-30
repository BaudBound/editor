import { ChevronDown, RotateCcw, Search, Trash2 } from "lucide-react";
import type { DependencyList, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CopyTextButton } from "@/components/common/copy-text-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { logLevelClassName } from "@/data/editor/output-console";
import { collapsedPanelSizes } from "@/data/editor/panel-layout";
import type { EditorVariable } from "@/data/project/variables";
import type { LogEntry, SimulationTraceEntry } from "@/lib/types";

type OutputConsoleProps = {
	activeTab: BottomPanelTab;
	follow: BottomPanelFollowState;
	logs: LogEntry[];
	open: boolean;
	systemLogs: LogEntry[];
	simulationLogs: SimulationTraceEntry[];
	variables: EditorVariable[];
	height: number;
	onClearTab: (tab: ClearableBottomPanelTab) => void;
	onFollowChange: (tab: ClearableBottomPanelTab, enabled: boolean) => void;
	onResetStoredValues: () => void;
	onTabChange: (tab: BottomPanelTab) => void;
	onToggle: () => void;
};

export type BottomPanelTab = "system" | "output" | "simulation" | "variables";
export type ClearableBottomPanelTab = Exclude<BottomPanelTab, "variables">;
export type BottomPanelFollowState = Record<ClearableBottomPanelTab, boolean>;

const bottomPanelTabs: Array<{ id: BottomPanelTab; label: string }> = [
	{ id: "system", label: "System" },
	{ id: "output", label: "Output" },
	{ id: "simulation", label: "Simulation" },
	{ id: "variables", label: "Variables" },
];
const MAX_DISPLAY_VALUE_LENGTH = 4000;

export function OutputConsole({
	activeTab,
	follow,
	logs,
	open,
	systemLogs,
	simulationLogs,
	variables,
	height,
	onClearTab,
	onFollowChange,
	onResetStoredValues,
	onTabChange,
	onToggle,
}: OutputConsoleProps) {
	const handleTabClick = (tab: BottomPanelTab) => {
		onTabChange(tab);
		if (!open) {
			onToggle();
		}
	};

	return (
		<section
			className="grid shrink-0 overflow-hidden border-t border-baud-border bg-baud-panel"
			style={{
				height: open ? height : collapsedPanelSizes.bottom,
				gridTemplateRows: `${collapsedPanelSizes.bottom}px minmax(0, 1fr)`,
			}}
		>
			<div className="flex min-h-0 items-center justify-between overflow-hidden border-b border-baud-border">
				<div className="flex h-full min-w-0 overflow-hidden">
					{bottomPanelTabs.map((tab) => (
						<Button
							key={tab.id}
							type="button"
							onClick={() => handleTabClick(tab.id)}
							className={`h-full shrink-0 rounded-none border-b-2 px-4 text-xs font-bold tracking-[0.16em] uppercase ${
								activeTab === tab.id ? "border-baud-red text-baud-text" : "border-transparent text-baud-muted"
							}`}
							size="none"
							variant="tab"
						>
							{tab.label}
						</Button>
					))}
				</div>
				<Button
					type="button"
					onClick={onToggle}
					aria-label={open ? "Collapse bottom panel" : "Expand bottom panel"}
					className="h-full w-10 shrink-0 rounded-none"
					size="none"
					variant="ghost"
				>
					<ChevronDown size={14} className={open ? "" : "-rotate-90"} />
				</Button>
			</div>
			{open && (
				<div className="min-h-0 overflow-hidden">
					{activeTab === "system" && (
						<LogPanel
							empty={systemLogs.length === 0}
							emptyText="System messages will appear here."
							follow={follow.system}
							footerLabel="System log options"
							onClear={() => onClearTab("system")}
							onFollowChange={(enabled) => onFollowChange("system", enabled)}
						>
							<SystemTab logs={systemLogs} />
						</LogPanel>
					)}
					{activeTab === "output" && (
						<LogPanel
							empty={logs.length === 0}
							emptyText="Script output will appear here."
							follow={follow.output}
							footerLabel="Output log options"
							onClear={() => onClearTab("output")}
							onFollowChange={(enabled) => onFollowChange("output", enabled)}
						>
							<OutputTab logs={logs} />
						</LogPanel>
					)}
					{activeTab === "simulation" && (
						<LogPanel
							empty={simulationLogs.length === 0}
							emptyText="Simulation trace output will appear here."
							follow={follow.simulation}
							footerLabel="Simulation log options"
							onClear={() => onClearTab("simulation")}
							onFollowChange={(enabled) => onFollowChange("simulation", enabled)}
						>
							<SimulationTab logs={simulationLogs} />
						</LogPanel>
					)}
					{activeTab === "variables" && (
						<VariablesTab variables={variables} onResetStoredValues={onResetStoredValues} />
					)}
				</div>
			)}
		</section>
	);
}

function LogPanel({
	children,
	empty,
	emptyText,
	follow,
	footerLabel,
	onClear,
	onFollowChange,
}: {
	children: ReactNode;
	empty: boolean;
	emptyText: string;
	follow: boolean;
	footerLabel: string;
	onClear: () => void;
	onFollowChange: (enabled: boolean) => void;
}) {
	const scrollRef = useAutoFollow(follow, [children]);

	return (
		<div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_32px] overflow-hidden">
			<div ref={scrollRef} className="overflow-y-auto px-4 py-3" data-selectable-text="true">
				{empty ? (
					<div className="rounded border border-baud-border bg-baud-soft p-3 text-sm leading-5 text-baud-muted">
						{emptyText}
					</div>
				) : (
					children
				)}
			</div>
			<LogFooter label={footerLabel} follow={follow} onClear={onClear} onFollowChange={onFollowChange} />
		</div>
	);
}

function SystemTab({ logs }: { logs: LogEntry[] }) {
	if (logs.length === 0) {
		return null;
	}

	return (
		<div className="font-mono text-sm leading-6">
			{logs.map((log, index) => (
				<LogLine key={`${log.level}-${log.message}-${index}`} log={log} />
			))}
		</div>
	);
}

function SimulationTab({ logs }: { logs: SimulationTraceEntry[] }) {
	if (logs.length === 0) {
		return null;
	}

	return (
		<div className="font-mono text-sm leading-6">
			{logs.map((log, index) => (
				<div key={`${log.level}-${log.message}-${index}`} className={getSimulationMessageClassName(log.level)}>
					<span className="text-baud-green">[Simulation]</span> {stripSimulationPrefix(log.message)}
				</div>
			))}
		</div>
	);
}

function stripSimulationPrefix(message: string) {
	return message.replace(/^\[Simulation\]\s*/, "");
}

function getSimulationMessageClassName(level: SimulationTraceEntry["level"]) {
	if (level === "error") {
		return "whitespace-pre-wrap text-baud-danger";
	}

	if (level === "warn") {
		return "whitespace-pre-wrap text-baud-amber";
	}

	return "whitespace-pre-wrap text-baud-muted";
}

function OutputTab({ logs }: { logs: LogEntry[] }) {
	if (logs.length === 0) {
		return null;
	}

	return (
		<div className="font-mono text-sm leading-6">
			{logs.map((log, index) => (
				<LogLine key={`${log.level}-${log.message}-${index}`} log={log} />
			))}
		</div>
	);
}

function LogLine({ log }: { log: LogEntry }) {
	return (
		<div className={`whitespace-pre-wrap ${log.level === "error" ? "text-baud-danger" : "text-baud-muted"}`}>
			<span className={logLevelClassName[log.level]}>[{log.level}]</span> {log.message}
		</div>
	);
}

function VariablesTab({
	variables,
	onResetStoredValues,
}: {
	variables: EditorVariable[];
	onResetStoredValues: () => void;
}) {
	const [resetDialogOpen, setResetDialogOpen] = useState(false);
	const [sortUpdatedFirst, setSortUpdatedFirst] = useState(true);
	const [showDerivedMetadata, setShowDerivedMetadata] = useState(false);
	const [showBuiltInVariables, setShowBuiltInVariables] = useState(false);
	const [showErrorVariables, setShowErrorVariables] = useState(false);
	const [showOutputVariables, setShowOutputVariables] = useState(true);
	const [showSystemVariables, setShowSystemVariables] = useState(false);
	const [variableSearch, setVariableSearch] = useState("");
	const previousSignaturesRef = useRef<Map<string, string>>(new Map());
	const updatedOrderRef = useRef<Map<string, number>>(new Map());
	const updateSequenceRef = useRef(0);
	useEffect(() => {
		const nextSignatures = new Map<string, string>();
		const currentNames = new Set<string>();

		for (const variable of variables) {
			const key = getVariableKey(variable);
			const signature = createVariableSignature(variable);
			currentNames.add(key);
			nextSignatures.set(key, signature);

			const previousSignature = previousSignaturesRef.current.get(key);
			if (previousSignature !== undefined && previousSignature !== signature) {
				updateSequenceRef.current += 1;
				updatedOrderRef.current.set(key, updateSequenceRef.current);
			}
		}

		for (const key of updatedOrderRef.current.keys()) {
			if (!currentNames.has(key)) {
				updatedOrderRef.current.delete(key);
			}
		}

		previousSignaturesRef.current = nextSignatures;
	}, [variables]);

	const displayedVariables = useMemo(() => {
		const normalizedSearch = variableSearch.trim().toLowerCase();
		const filteredVariables = variables.filter((variable) => {
			if (!showDerivedMetadata && isDerivedMetadataVariable(variable)) {
				return false;
			}

			if (!showErrorVariables && isErrorOutputVariable(variable)) {
				return false;
			}

			if (!showOutputVariables && variable.source === "node_output") {
				return false;
			}

			if (!showSystemVariables && isSystemVariable(variable)) {
				return false;
			}

			if (!showBuiltInVariables && isBuiltInVariable(variable)) {
				return false;
			}

			return !normalizedSearch || createVariableSearchText(variable).includes(normalizedSearch);
		});

		if (!sortUpdatedFirst) {
			return filteredVariables;
		}

		return [...filteredVariables].sort((a, b) => {
			const aOrder = updatedOrderRef.current.get(getVariableKey(a)) ?? 0;
			const bOrder = updatedOrderRef.current.get(getVariableKey(b)) ?? 0;

			return bOrder - aOrder;
		});
	}, [
		showBuiltInVariables,
		showDerivedMetadata,
		showErrorVariables,
		showOutputVariables,
		showSystemVariables,
		sortUpdatedFirst,
		variableSearch,
		variables,
	]);

	return (
		<div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_32px] overflow-hidden">
			<div className="overflow-y-auto">
				<div className="px-4 py-3">
					<div className="mb-3 flex items-center gap-2">
						<div className="relative min-w-0 flex-1">
							<Search
								className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-baud-muted"
								size={14}
							/>
							<Input
								aria-label="Search variables"
								className="pl-8 pr-3 font-sans"
								placeholder="Search variables..."
								value={variableSearch}
								onChange={(event) => setVariableSearch(event.target.value)}
							/>
						</div>
						<Button type="button" onClick={() => setResetDialogOpen(true)} size="sm" variant="outline">
							<RotateCcw />
							Reset stored values
						</Button>
					</div>
					{displayedVariables.length === 0 ? (
						<div className="rounded border border-baud-border bg-baud-soft p-3 text-sm leading-5 text-baud-muted">
							{variables.length === 0
								? "Variables will appear here when the script defines them."
								: variableSearch.trim()
									? "No variables match your search and display options."
									: "All variables are currently hidden by display options."}
						</div>
					) : (
						<div className="overflow-x-auto rounded border border-baud-border bg-baud-soft">
							<div className="min-w-[720px]">
								<div className="grid grid-cols-[minmax(180px,0.8fr)_96px_104px_88px_minmax(220px,1fr)] gap-3 border-b border-baud-border px-3 py-2 text-xs font-bold tracking-[0.12em] text-baud-muted uppercase">
									<div>Name</div>
									<div>Type</div>
									<div>Scope</div>
									<div>Source</div>
									<div>Value</div>
								</div>
								<div className="divide-y divide-baud-border/80">
									{displayedVariables.map((variable) => (
										<div
											key={getVariableKey(variable)}
											data-variable-name={variable.name}
											className="grid grid-cols-[minmax(180px,0.8fr)_96px_104px_88px_minmax(220px,1fr)] gap-3 px-3 py-2 font-mono text-sm"
										>
											<div className="min-w-0">
												<div className="flex min-w-0 items-start gap-1">
													<span className="min-w-0 break-all text-baud-text" data-selectable-text="true">
														{variable.name}
													</span>
													<CopyTextButton text={variable.name} label={`Copy ${variable.name} name`} />
												</div>
												<div className="mt-1 flex min-w-0 items-start gap-1">
													<span className="min-w-0 break-all text-xs text-baud-muted" data-selectable-text="true">
														{variable.token}
													</span>
													<CopyTextButton text={variable.token} label={`Copy ${variable.name} reference`} />
												</div>
											</div>
											<div className="min-w-0 break-all text-baud-muted">{variable.type}</div>
											<div className="min-w-0 break-all text-baud-muted">{variable.scope}</div>
											<div className="text-baud-muted">{variable.source}</div>
											<pre
												className="min-h-7 min-w-0 whitespace-pre-wrap break-all rounded border border-baud-border bg-baud-panel/60 px-2 py-1.5 font-mono text-xs leading-4 text-baud-text"
												data-selectable-text="true"
											>
												{formatVariableValue(variable.value)}
											</pre>
										</div>
									))}
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
			<VariablesFooter
				showBuiltInVariables={showBuiltInVariables}
				showDerivedMetadata={showDerivedMetadata}
				showErrorVariables={showErrorVariables}
				showOutputVariables={showOutputVariables}
				showSystemVariables={showSystemVariables}
				sortUpdatedFirst={sortUpdatedFirst}
				onShowBuiltInVariablesChange={setShowBuiltInVariables}
				onShowDerivedMetadataChange={setShowDerivedMetadata}
				onShowErrorVariablesChange={setShowErrorVariables}
				onShowOutputVariablesChange={setShowOutputVariables}
				onShowSystemVariablesChange={setShowSystemVariables}
				onSortUpdatedFirstChange={setSortUpdatedFirst}
			/>
			<Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reset stored values?</DialogTitle>
						<DialogDescription>
							Persistent simulation values will return to their declared defaults. Global simulation values will be
							cleared.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setResetDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => {
								onResetStoredValues();
								setResetDialogOpen(false);
							}}
						>
							<RotateCcw />
							Reset stored values
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function VariablesFooter({
	showBuiltInVariables,
	showDerivedMetadata,
	showErrorVariables,
	showOutputVariables,
	showSystemVariables,
	sortUpdatedFirst,
	onShowBuiltInVariablesChange,
	onShowDerivedMetadataChange,
	onShowErrorVariablesChange,
	onShowOutputVariablesChange,
	onShowSystemVariablesChange,
	onSortUpdatedFirstChange,
}: {
	showBuiltInVariables: boolean;
	showDerivedMetadata: boolean;
	showErrorVariables: boolean;
	showOutputVariables: boolean;
	showSystemVariables: boolean;
	sortUpdatedFirst: boolean;
	onShowBuiltInVariablesChange: (enabled: boolean) => void;
	onShowDerivedMetadataChange: (enabled: boolean) => void;
	onShowErrorVariablesChange: (enabled: boolean) => void;
	onShowOutputVariablesChange: (enabled: boolean) => void;
	onShowSystemVariablesChange: (enabled: boolean) => void;
	onSortUpdatedFirstChange: (enabled: boolean) => void;
}) {
	return (
		<fieldset className="flex h-8 min-h-0 items-center justify-between gap-3 overflow-hidden border-t border-baud-border px-3">
			<legend className="sr-only">Variable display options</legend>
			<div className="flex min-w-0 items-center gap-4 overflow-hidden">
				<FooterCheckbox checked={sortUpdatedFirst} label="Updated first" onCheckedChange={onSortUpdatedFirstChange} />
				<FooterCheckbox
					checked={showDerivedMetadata}
					label="Show metadata"
					onCheckedChange={onShowDerivedMetadataChange}
				/>
				<FooterCheckbox
					checked={showBuiltInVariables}
					label="Show built-ins"
					onCheckedChange={onShowBuiltInVariablesChange}
				/>
				<FooterCheckbox checked={showErrorVariables} label="Show errors" onCheckedChange={onShowErrorVariablesChange} />
				<FooterCheckbox
					checked={showOutputVariables}
					label="Show outputs"
					onCheckedChange={onShowOutputVariablesChange}
				/>
				<FooterCheckbox
					checked={showSystemVariables}
					label="Show system"
					onCheckedChange={onShowSystemVariablesChange}
				/>
			</div>
		</fieldset>
	);
}

function getVariableKey(variable: EditorVariable) {
	return `${variable.source}-${variable.name}`;
}

function createVariableSignature(variable: EditorVariable) {
	return JSON.stringify([variable.value, variable.type, variable.scope, variable.source]);
}

function isDerivedMetadataVariable(variable: EditorVariable) {
	return /\.\$(?:length|count|type|is_empty)$/.test(variable.name);
}

function isErrorOutputVariable(variable: EditorVariable) {
	return variable.source === "node_output" && /\.error(?:\.|$)/.test(variable.name);
}

function isSystemVariable(variable: EditorVariable) {
	return variable.source === "built_in" && variable.name.startsWith("system_");
}

function isBuiltInVariable(variable: EditorVariable) {
	return variable.source === "built_in" && !isSystemVariable(variable);
}

function createVariableSearchText(variable: EditorVariable) {
	return [
		variable.name,
		variable.token,
		variable.type,
		variable.scope,
		variable.source,
		variable.description ?? "",
		formatVariableValue(variable.value),
	]
		.join("\n")
		.toLowerCase();
}

function formatVariableValue(value: EditorVariable["value"]) {
	if (value === undefined) {
		return "available at runtime";
	}

	const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2);

	if (!formatted) {
		return "";
	}

	return formatted.length > MAX_DISPLAY_VALUE_LENGTH
		? `${formatted.slice(0, MAX_DISPLAY_VALUE_LENGTH)}... [truncated]`
		: formatted;
}

function LogFooter({
	follow,
	label,
	onClear,
	onFollowChange,
}: {
	follow: boolean;
	label: string;
	onClear: () => void;
	onFollowChange: (enabled: boolean) => void;
}) {
	return (
		<fieldset className="flex h-8 min-h-0 items-center justify-between overflow-hidden border-t border-baud-border px-3">
			<legend className="sr-only">{label}</legend>
			<FooterCheckbox checked={follow} label="Follow" onCheckedChange={onFollowChange} />
			<Button type="button" onClick={onClear} size="xs" variant="ghost">
				<Trash2 size={12} />
				Clear
			</Button>
		</fieldset>
	);
}

function FooterCheckbox({
	checked,
	label,
	onCheckedChange,
}: {
	checked: boolean;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	const checkboxId = useId();

	return (
		<div className="flex shrink-0 items-center gap-2 text-xs text-baud-muted">
			<Checkbox
				id={checkboxId}
				checked={checked}
				onCheckedChange={(value) => onCheckedChange(value === true)}
				className="size-3 border-baud-border bg-baud-panel data-checked:border-baud-red data-checked:bg-baud-red data-checked:text-white"
			/>
			<label htmlFor={checkboxId} className="cursor-pointer select-none">
				{label}
			</label>
		</div>
	);
}

function useAutoFollow(enabled: boolean, deps: DependencyList) {
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!enabled || !scrollRef.current) {
			return;
		}

		scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
	}, [enabled, ...deps]);

	return scrollRef;
}
