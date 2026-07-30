import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { secretSimulationValueError, validateSecretDeclaration } from "@/data/project/secrets";
import type { SecretDeclaration } from "@/lib/types";
import type { VariableRename } from "@/utils/variable-reference-renaming";

type SecretReferenceManagerProps = {
	declarations: SecretDeclaration[];
	reservedVariableNames?: ReadonlySet<string>;
	simulationValues: Record<string, string>;
	onDeclarationsChange: (declarations: SecretDeclaration[], rename?: VariableRename) => void;
	onSimulationValueChange: (name: string, value: string) => void;
};

const emptyDeclaration: SecretDeclaration = {
	description: "",
	name: "",
	required: true,
	type: "string",
};

export function SecretReferenceManager({
	declarations,
	reservedVariableNames = new Set(),
	simulationValues,
	onDeclarationsChange,
	onSimulationValueChange,
}: SecretReferenceManagerProps) {
	const [editingName, setEditingName] = useState<string | null>(null);
	const [draft, setDraft] = useState<SecretDeclaration>(emptyDeclaration);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [hasSimulationValue, setHasSimulationValue] = useState(false);
	const [rawSimulationValue, setRawSimulationValue] = useState("");
	const [simulationValueVisible, setSimulationValueVisible] = useState(false);
	const nameInputId = useId();
	const descriptionInputId = useId();
	const simulationInputId = useId();
	const declarationError = useMemo(
		() => validateSecretDeclaration(draft, declarations, editingName ?? undefined, reservedVariableNames),
		[draft, declarations, editingName, reservedVariableNames],
	);
	const simulationValueError =
		hasSimulationValue && rawSimulationValue === ""
			? "Enter a simulation override."
			: secretSimulationValueError(draft.type, rawSimulationValue);

	const openCreate = () => {
		setEditingName(null);
		setDraft(emptyDeclaration);
		setHasSimulationValue(false);
		setRawSimulationValue("");
		setSimulationValueVisible(false);
		setDialogOpen(true);
	};
	const openEdit = (declaration: SecretDeclaration) => {
		setEditingName(declaration.name);
		setDraft(declaration);
		setHasSimulationValue(simulationValues[declaration.name] !== undefined);
		setRawSimulationValue(simulationValues[declaration.name] ?? "");
		setSimulationValueVisible(false);
		setDialogOpen(true);
	};
	const save = () => {
		if (declarationError || simulationValueError) return;
		const normalized = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
		if (editingName) {
			onDeclarationsChange(
				declarations.map((secret) => (secret.name === editingName ? normalized : secret)),
				editingName !== normalized.name ? { from: editingName, to: normalized.name } : undefined,
			);
			if (editingName !== normalized.name) {
				onSimulationValueChange(editingName, "");
			}
		} else {
			onDeclarationsChange([...declarations, normalized].sort((a, b) => a.name.localeCompare(b.name)));
		}
		onSimulationValueChange(normalized.name, hasSimulationValue ? rawSimulationValue : "");
		setDialogOpen(false);
	};
	const remove = (name: string) => {
		onDeclarationsChange(declarations.filter((secret) => secret.name !== name));
		onSimulationValueChange(name, "");
	};

	return (
		<section className="min-w-0 bg-baud-panel px-4 py-3">
			<div className="min-w-0">
				<div className="flex items-center gap-2 text-sm font-semibold text-baud-text">
					<KeyRound size={14} className="text-baud-amber" />
					Secret references
				</div>
				<p className="mt-0.5 text-xs text-baud-muted">
					Simulation values stay in this browser session and are never exported.
				</p>
				<Button
					type="button"
					size="xs"
					variant="toolbar"
					className="mt-2 hover:border-baud-amber/40 hover:bg-baud-amber/10 hover:text-baud-amber [&_svg]:transition-transform hover:[&_svg]:scale-110"
					onClick={openCreate}
				>
					<Plus size={12} /> Add secret
				</Button>
			</div>

			{declarations.length > 0 && (
				<div className="mt-2.5 grid gap-1.5">
					{declarations.map((declaration) => {
						const hasOverride = simulationValues[declaration.name] !== undefined;
						return (
							<article
								key={declaration.name}
								className="flex flex-col rounded border border-baud-border bg-baud-soft p-2"
							>
								<div className="flex min-w-0 items-start gap-2">
									<div className="min-w-0 flex-1">
										<div className="flex min-w-0 flex-wrap items-center gap-1">
											<div className="min-w-0 break-all font-mono text-sm font-semibold text-baud-text">
												{declaration.name}
											</div>
											<Badge variant={declaration.required ? "medium" : "outline"}>
												{declaration.required ? "Required" : "Optional"}
											</Badge>
										</div>
										{declaration.description && (
											<p className="mt-0.5 text-xs leading-4 text-baud-muted">{declaration.description}</p>
										)}
									</div>
									<div className="flex shrink-0 justify-end gap-1">
										<Button
											type="button"
											aria-label={`Edit ${declaration.name}`}
											size="icon-xs"
											variant="ghost"
											className="text-baud-muted hover:bg-baud-blue/15 hover:text-baud-blue [&_svg]:transition-transform hover:[&_svg]:scale-110"
											onClick={() => openEdit(declaration)}
										>
											<Pencil />
										</Button>
										<Button
											type="button"
											aria-label={`Delete ${declaration.name}`}
											size="icon-xs"
											variant="ghost"
											className="text-baud-muted hover:bg-baud-danger/15 hover:text-baud-danger [&_svg]:transition-transform hover:[&_svg]:scale-110"
											onClick={() => remove(declaration.name)}
										>
											<Trash2 />
										</Button>
									</div>
								</div>
								<div className="mt-2 flex items-center justify-between gap-2 border-t border-baud-border/80 pt-1.5">
									<span className="text-[10px] font-semibold tracking-[0.08em] text-baud-muted uppercase">
										Simulation override
									</span>
									<Badge variant={hasOverride ? "low" : "outline"}>
										{hasOverride ? "Override configured" : "Not set"}
									</Badge>
								</div>
							</article>
						);
					})}
				</div>
			)}

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editingName ? "Edit secret reference" : "Add secret reference"}</DialogTitle>
						<DialogDescription>
							Only the declaration is saved in the package. Values are configured in the runner.
						</DialogDescription>
					</DialogHeader>
					<label htmlFor={nameInputId} className="grid gap-1 text-xs text-baud-muted">
						Name
						<Input
							id={nameInputId}
							value={draft.name}
							onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
						/>
					</label>
					<label htmlFor={descriptionInputId} className="grid gap-1 text-xs text-baud-muted">
						Description
						<Input
							id={descriptionInputId}
							value={draft.description}
							onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
						/>
					</label>
					<div className="flex items-center justify-between gap-3 rounded border border-baud-border p-2 text-baud-text">
						<div className="grid gap-0.5">
							<span className="text-sm">Required for execution</span>
							<span className="text-xs leading-4 text-baud-muted">
								The script cannot run until this secret has a value and secret storage is unlocked. An enabled script
								with a required secret also blocks the background service from starting.
							</span>
						</div>
						<Switch
							aria-label="Required for execution"
							checked={draft.required}
							onCheckedChange={(required) => setDraft((current) => ({ ...current, required }))}
						/>
					</div>
					<div className="grid gap-2 rounded border border-baud-border p-2">
						<div className="flex items-center justify-between gap-3">
							<div>
								<label htmlFor={`${simulationInputId}-enabled`} className="text-sm text-baud-text">
									Simulation override
								</label>
								<p className="text-xs leading-4 text-baud-muted">
									Use a browser session only value while testing. It is never saved or exported.
								</p>
							</div>
							<Switch
								id={`${simulationInputId}-enabled`}
								aria-label="Use Simulation override"
								checked={hasSimulationValue}
								onCheckedChange={setHasSimulationValue}
							/>
						</div>
						{hasSimulationValue && (
							<div className="grid gap-1">
								<label htmlFor={simulationInputId} className="text-xs text-baud-muted">
									Simulation override
								</label>
								<div className="flex min-w-0 gap-1">
									<Input
										id={simulationInputId}
										className="min-w-0 flex-1"
										type={simulationValueVisible ? "text" : "password"}
										autoComplete="new-password"
										value={rawSimulationValue}
										aria-invalid={Boolean(simulationValueError)}
										onChange={(event) => setRawSimulationValue(event.target.value)}
									/>
									<Button
										type="button"
										aria-label={simulationValueVisible ? "Hide simulation secret" : "Show simulation secret"}
										size="icon-sm"
										variant="ghost"
										className="shrink-0 text-baud-muted hover:bg-baud-blue/15 hover:text-baud-blue"
										onClick={() => setSimulationValueVisible((visible) => !visible)}
									>
										{simulationValueVisible ? <EyeOff size={14} /> : <Eye size={14} />}
									</Button>
								</div>
							</div>
						)}
						{simulationValueError && <div className="text-xs text-baud-danger">{simulationValueError}</div>}
					</div>
					{declarationError && <div className="text-xs text-baud-danger">{declarationError}</div>}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							variant="primary"
							disabled={Boolean(declarationError || simulationValueError)}
							onClick={save}
						>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
