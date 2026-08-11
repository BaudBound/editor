import { Database, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { DeclaredVariableDialog } from "@/components/shell/declared-variable-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { validateDeclaredVariable } from "@/data/project/declared-variables";
import { formatTypedValueForDisplay, validateTypedValue } from "@/data/project/typed-values";

import type { DeclaredVariable, SecretDeclaration } from "@/lib/types";
import type { VariableRename } from "@/utils/variable-reference-renaming";

type DeclaredVariableManagerProps = {
	secrets: SecretDeclaration[];
	variables: DeclaredVariable[];
	onChange: (variables: DeclaredVariable[], rename?: VariableRename) => void;
};

function emptyVariable(): DeclaredVariable {
	return {
		description: "",
		name: "",
		scope: "runtime",
		type: "string",
		value: "",
	};
}

export function DeclaredVariableManager({ secrets, variables, onChange }: DeclaredVariableManagerProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingName, setEditingName] = useState<string | null>(null);
	const [draft, setDraft] = useState<DeclaredVariable>(emptyVariable);
	// The dialog owns the form and its validation. This keeps only what saving
	// needs, so the two cannot drift into validating differently.
	const declarationError = useMemo(
		() => validateDeclaredVariable(draft, variables, secrets, editingName ?? undefined),
		[draft, editingName, secrets, variables],
	);
	const valueError = validateTypedValue(draft.type, draft.value, draft.itemType);

	const openCreate = () => {
		const variable = emptyVariable();
		setEditingName(null);
		setDraft(variable);
		setDialogOpen(true);
	};
	const openEdit = (variable: DeclaredVariable) => {
		setEditingName(variable.name);
		setDraft(structuredClone(variable));
		setDialogOpen(true);
	};
	const save = () => {
		if (declarationError || valueError) return;
		const normalized: DeclaredVariable = {
			...draft,
			description: draft.description.trim(),
			name: draft.name.trim(),
		};
		const next = editingName
			? variables.map((variable) => (variable.name === editingName ? normalized : variable))
			: [...variables, normalized];
		onChange(
			next.sort((left, right) => left.name.localeCompare(right.name)),
			editingName && editingName !== normalized.name ? { from: editingName, to: normalized.name } : undefined,
		);
		setDialogOpen(false);
	};

	return (
		<section className="min-w-0 bg-baud-panel px-4 py-3">
			<div className="min-w-0">
				<div className="flex items-center gap-2 text-sm font-semibold text-baud-text">
					<Database size={14} className="text-baud-green" />
					Declared variables
				</div>
				<p className="mt-0.5 text-xs text-baud-muted">
					Runtime values reset for every run. Persistent values are used only until the runner stores a value.
				</p>
				<Button
					type="button"
					size="xs"
					variant="toolbar"
					className="mt-2 hover:border-baud-green/40 hover:bg-baud-green/10 hover:text-baud-green [&_svg]:transition-transform hover:[&_svg]:scale-110"
					onClick={openCreate}
				>
					<Plus size={12} /> Add variable
				</Button>
			</div>

			{variables.length > 0 && (
				<div className="mt-2.5 grid gap-1.5">
					{variables.map((variable) => (
						<article key={variable.name} className="flex flex-col rounded border border-baud-border bg-baud-soft p-2">
							<div className="flex min-w-0 items-start gap-2">
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 flex-wrap items-center gap-1">
										<div className="min-w-0 break-all font-mono text-sm font-semibold text-baud-text">
											{variable.name}
										</div>
										<Badge variant="outline" className="font-mono text-baud-muted">
											Type: {variable.type}
										</Badge>
										{/* Matched to the permission each scope's write asks for, so a
										    global does not read as harmless next to a runtime one. */}
										<Badge
											variant={
												variable.scope === "global" ? "high" : variable.scope === "persistent" ? "medium" : "low"
											}
										>
											Scope: {variable.scope}
										</Badge>
									</div>
									{variable.description && (
										<p className="mt-0.5 text-xs leading-4 text-baud-muted">{variable.description}</p>
									)}
								</div>
								<div className="flex shrink-0 justify-end gap-1">
									<Button
										type="button"
										aria-label={`Edit ${variable.name}`}
										size="icon-xs"
										variant="ghost"
										className="text-baud-muted hover:bg-baud-blue/15 hover:text-baud-blue [&_svg]:transition-transform hover:[&_svg]:scale-110"
										onClick={() => openEdit(variable)}
									>
										<Pencil />
									</Button>
									<Button
										type="button"
										aria-label={`Delete ${variable.name}`}
										size="icon-xs"
										variant="ghost"
										className="text-baud-muted hover:bg-baud-danger/15 hover:text-baud-danger [&_svg]:transition-transform hover:[&_svg]:scale-110"
										onClick={() => onChange(variables.filter((entry) => entry.name !== variable.name))}
									>
										<Trash2 />
									</Button>
								</div>
							</div>
							<div className="mt-2 border-t border-baud-border/80 pt-1.5">
								<div className="text-[10px] font-semibold tracking-[0.08em] text-baud-muted uppercase">
									Default value
								</div>
								<pre
									className="mt-0.5 min-h-7 min-w-0 whitespace-pre-wrap break-all rounded border border-baud-border bg-baud-panel/60 px-2 py-1.5 font-mono text-xs leading-4 text-baud-text"
									data-selectable-text="true"
								>
									{formatTypedValueForDisplay(variable.type, variable.value, variable.itemType)}
								</pre>
							</div>
						</article>
					))}
				</div>
			)}

			<DeclaredVariableDialog
				draft={draft}
				editingName={editingName}
				open={dialogOpen}
				secrets={secrets}
				variables={variables}
				onCancel={() => setDialogOpen(false)}
				onDraftChange={setDraft}
				onSave={save}
			/>
		</section>
	);
}
