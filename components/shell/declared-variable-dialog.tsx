"use client";

import { useId, useMemo } from "react";
import { TypedValueEditor } from "@/components/common/typed-value-editor";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { validateDeclaredVariable } from "@/data/project/declared-variables";
import { createEmptyTypedValue, validateTypedValue } from "@/data/project/typed-values";
import { type ListItemType, type VariableType, variableTypes } from "@/data/project/variables";
import type { DeclaredVariable, SecretDeclaration } from "@/lib/types";

/**
 * The one form that declares a variable.
 *
 * Settings owns the list; a Variable Operation node opens the same form so a
 * variable that does not exist yet does not cost a round trip through
 * Settings. Both routes therefore validate identically, which they would not
 * if the node had its own smaller form.
 */
export function DeclaredVariableDialog({
	draft,
	editingName,
	open,
	secrets,
	variables,
	onCancel,
	onDraftChange,
	onSave,
}: {
	draft: DeclaredVariable;
	editingName: string | null;
	open: boolean;
	secrets: SecretDeclaration[];
	variables: DeclaredVariable[];
	onCancel: () => void;
	onDraftChange: (next: DeclaredVariable) => void;
	onSave: () => void;
}) {
	const nameId = useId();
	const scopeId = useId();
	const typeId = useId();
	const valueId = useId();
	const descriptionId = useId();
	const declarationError = useMemo(
		() => validateDeclaredVariable(draft, variables, secrets, editingName ?? undefined),
		[draft, editingName, secrets, variables],
	);
	const valueError =
		draft.type === "string" && typeof draft.value === "string" && !draft.value.trim()
			? "Default value is required."
			: validateTypedValue(draft.type, draft.value, draft.itemType);
	const setDraft = (update: (current: DeclaredVariable) => DeclaredVariable) => onDraftChange(update(draft));
	const changeType = (type: VariableType) => {
		setDraft((current) => ({
			...current,
			type,
			value: createEmptyTypedValue(type),
			...(type === "list" ? { itemType: "string" as ListItemType } : { itemType: undefined }),
		}));
	};
	const save = () => {
		if (declarationError || valueError) return;
		onSave();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{editingName ? "Edit variable" : "Add variable"}</DialogTitle>
					<DialogDescription>
						The value is saved in the script package and can be changed by Variable Operation nodes.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3 sm:grid-cols-2">
					<label htmlFor={nameId} className="grid gap-1 text-xs text-baud-muted">
						Name
						<Input
							id={nameId}
							value={draft.name}
							onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
						/>
					</label>
					<label htmlFor={scopeId} className="grid gap-1 text-xs text-baud-muted">
						Scope
						<Select
							value={draft.scope}
							onValueChange={(scope) =>
								setDraft((current) => ({ ...current, scope: scope as DeclaredVariable["scope"] }))
							}
						>
							<SelectTrigger id={scopeId} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="runtime">runtime</SelectItem>
								<SelectItem value="persistent">persistent</SelectItem>
								<SelectItem value="global">global</SelectItem>
							</SelectContent>
						</Select>
					</label>
				</div>
				<label htmlFor={typeId} className="grid gap-1 text-xs text-baud-muted">
					Type
					<Select value={draft.type} onValueChange={(type) => changeType(type as VariableType)}>
						<SelectTrigger id={typeId} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{variableTypes.map((type) => (
								<SelectItem key={type} value={type}>
									{type}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</label>
				<div className="grid gap-1 text-xs text-baud-muted">
					Default value
					<TypedValueEditor
						ariaLabel="Default value"
						id={valueId}
						type={draft.type}
						itemType={draft.itemType}
						value={draft.value}
						onChange={(value) => setDraft((current) => ({ ...current, value }))}
						onItemTypeChange={(itemType) => setDraft((current) => ({ ...current, itemType }))}
					/>
				</div>
				<label htmlFor={descriptionId} className="grid gap-1 text-xs text-baud-muted">
					Description
					<Input
						id={descriptionId}
						value={draft.description}
						onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
					/>
				</label>
				{(declarationError || valueError) && (
					<div className="text-xs text-baud-danger">{declarationError || valueError}</div>
				)}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button type="button" variant="primary" disabled={Boolean(declarationError || valueError)} onClick={save}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
