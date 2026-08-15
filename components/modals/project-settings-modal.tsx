"use client";

import { X } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useEffect, useId, useState } from "react";
import { DeclaredVariableManager } from "@/components/shell/declared-variable-manager";
import { ScriptSettingManager } from "@/components/shell/script-setting-manager";
import { SecretReferenceManager } from "@/components/shell/secret-reference-manager";
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
import { MultiOptionCombobox } from "@/components/ui/multi-option-combobox";
import { Textarea } from "@/components/ui/textarea";
import { targetRuntimes } from "@/data/project/runtimes";
import type { DeclaredVariable, ProjectSettings, ScriptSetting, SecretDeclaration, TargetRuntime } from "@/lib/types";
import { DEFAULT_MINIMUM_RUNNER_VERSION } from "@/lib/version";
import { getRepositoryUrlError, getScriptVersionError } from "@/utils/script-repository";
import type { VariableRename } from "@/utils/variable-reference-renaming";

export type ProjectSettingsTab = "general" | "runtime" | "declaredVariables" | "secrets" | "scriptSettings";

type ProjectSettingsModalProps = {
	description?: string;
	open: boolean;
	projectId?: string;
	saveLabel?: string;
	settings: ProjectSettings;
	declaredVariables?: DeclaredVariable[];
	secretDeclarations?: SecretDeclaration[];
	scriptSettings?: ScriptSetting[];
	simulationSecretValues?: Record<string, string>;
	title?: string;
	/** Tab to open on. Lets a caller send the user straight to Variables. */
	initialTab?: ProjectSettingsTab;
	onClose: () => void;
	onDeclaredVariablesChange?: (variables: DeclaredVariable[], renames?: VariableRename[]) => void;
	onSave: (settings: ProjectSettings) => void;
	onScriptSettingsChange?: (settings: ScriptSetting[], renames?: VariableRename[]) => void;
	onSecretDeclarationsChange?: (declarations: SecretDeclaration[], renames?: VariableRename[]) => void;
	onSimulationSecretValuesChange?: (values: Record<string, string>) => void;
};

export function ProjectSettingsModal({
	description = "Configure package metadata and runtime settings used during export.",
	initialTab = "general",
	open,
	projectId,
	saveLabel = "Save Settings",
	settings,
	declaredVariables,
	secretDeclarations,
	scriptSettings,
	simulationSecretValues,
	title = "Project Settings",
	onClose,
	onDeclaredVariablesChange,
	onSave,
	onScriptSettingsChange,
	onSecretDeclarationsChange,
	onSimulationSecretValuesChange,
}: ProjectSettingsModalProps) {
	const titleId = useId();
	const descriptionId = useId();
	const [draft, setDraft] = useState(settings);
	const [tagsDraft, setTagsDraft] = useState<string[]>(settings.tags);
	const [tagInput, setTagInput] = useState("");
	const [activeTab, setActiveTab] = useState<ProjectSettingsTab>("general");
	const [declaredVariablesDraft, setDeclaredVariablesDraft] = useState(declaredVariables ?? []);
	const [secretDeclarationsDraft, setSecretDeclarationsDraft] = useState(secretDeclarations ?? []);
	const [scriptSettingsDraft, setScriptSettingsDraft] = useState(scriptSettings ?? []);
	const [simulationSecretValuesDraft, setSimulationSecretValuesDraft] = useState(simulationSecretValues ?? {});
	const [declaredVariableRenames, setDeclaredVariableRenames] = useState<VariableRename[]>([]);
	const [secretRenames, setSecretRenames] = useState<VariableRename[]>([]);
	const [scriptSettingRenames, setScriptSettingRenames] = useState<VariableRename[]>([]);
	const hasDefinitionTabs =
		declaredVariables !== undefined &&
		secretDeclarations !== undefined &&
		scriptSettings !== undefined &&
		simulationSecretValues !== undefined;

	useEffect(() => {
		if (!open) {
			return;
		}

		setDraft(settings);
		setTagsDraft(settings.tags);
		setTagInput("");
		setActiveTab(initialTab);
		setDeclaredVariablesDraft(declaredVariables ?? []);
		setSecretDeclarationsDraft(secretDeclarations ?? []);
		setScriptSettingsDraft(scriptSettings ?? []);
		setSimulationSecretValuesDraft(simulationSecretValues ?? {});
		setDeclaredVariableRenames([]);
		setSecretRenames([]);
		setScriptSettingRenames([]);
	}, [declaredVariables, initialTab, open, scriptSettings, secretDeclarations, settings, simulationSecretValues]);

	const nameError = draft.name.trim().length === 0 ? "Project name is required." : "";
	const nameLengthError = draft.name.length > 128 ? "Project name cannot exceed 128 characters." : "";
	const descriptionError = draft.description.length > 4096 ? "Description cannot exceed 4096 characters." : "";
	const authorError = draft.author.length > 128 ? "Author cannot exceed 128 characters." : "";
	const minimumRunnerError =
		draft.minimumRunnerVersion.length > 64 ? "Minimum runner cannot exceed 64 characters." : "";
	const versionError = getScriptVersionError(draft.version);
	const repositoryUrlError = getRepositoryUrlError(draft.repositoryUrl);
	const websiteError = getOptionalUrlError(draft.website);
	const sourceError = getOptionalUrlError(draft.source);
	const tagsError = getTagsError(appendTags(tagsDraft, tagInput));
	const targetRuntimesError = draft.targetRuntimes.length === 0 ? "Select at least one target runtime." : "";
	const hasErrors = Boolean(
		nameError ||
			nameLengthError ||
			descriptionError ||
			authorError ||
			versionError ||
			repositoryUrlError ||
			minimumRunnerError ||
			websiteError ||
			sourceError ||
			tagsError ||
			targetRuntimesError,
	);

	const handleSave = () => {
		if (hasErrors) {
			return;
		}

		const nextTags = appendTags(tagsDraft, tagInput);

		onSave({
			...draft,
			name: draft.name.trim(),
			description: draft.description.trim(),
			author: draft.author.trim(),
			version: draft.version.trim(),
			repositoryUrl: draft.repositoryUrl.trim(),
			website: draft.website.trim(),
			source: draft.source.trim(),
			minimumRunnerVersion: draft.minimumRunnerVersion.trim() || DEFAULT_MINIMUM_RUNNER_VERSION,
			tags: nextTags,
		});
		onDeclaredVariablesChange?.(declaredVariablesDraft, declaredVariableRenames);
		onSecretDeclarationsChange?.(secretDeclarationsDraft, secretRenames);
		onScriptSettingsChange?.(scriptSettingsDraft, scriptSettingRenames);
		onSimulationSecretValuesChange?.(simulationSecretValuesDraft);
		onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
			<DialogContent
				aria-labelledby={titleId}
				className="sm:max-w-4xl"
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle id={titleId}>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<div
					role="tablist"
					aria-label="Project Settings sections"
					className="flex min-w-0 overflow-x-auto border-b border-baud-border"
				>
					{getProjectSettingsTabs(hasDefinitionTabs).map((tab) => (
						<Button
							key={tab.id}
							type="button"
							role="tab"
							aria-selected={activeTab === tab.id}
							size="none"
							variant="tab"
							className={`h-9 shrink-0 rounded-none border-b-2 px-3 ${
								activeTab === tab.id ? "border-baud-red text-baud-text" : "border-transparent text-baud-muted"
							}`}
							onClick={() => setActiveTab(tab.id)}
						>
							{tab.label}
						</Button>
					))}
				</div>

				<div className="max-h-[68vh] min-h-[360px] overflow-y-auto pr-1">
					{activeTab === "general" && (
						<div className="grid gap-4">
							{projectId && (
								<div>
									<label htmlFor={`${titleId}-project-id`} className="mb-1 block font-mono text-sm text-baud-muted">
										Project ID
									</label>
									<Input id={`${titleId}-project-id`} value={projectId} readOnly className="font-mono" />
									<p className="mt-1 text-xs leading-4 text-baud-muted">
										This stable ID lets the runner recognize later exports as the same script.
									</p>
								</div>
							)}
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<TextField
									label="Name"
									value={draft.name}
									error={nameError || nameLengthError}
									maxLength={128}
									onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
								/>
								<TextField
									label="Script Version"
									value={draft.version}
									error={versionError}
									maxLength={128}
									onChange={(value) => setDraft((current) => ({ ...current, version: value }))}
								/>
							</div>
							<div>
								<label htmlFor={descriptionId} className="mb-1 block font-mono text-sm text-baud-muted">
									Description
								</label>
								<Textarea
									id={descriptionId}
									value={draft.description}
									onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
									className="min-h-24"
									maxLength={4096}
								/>
								{descriptionError && <p className="mt-1 text-xs leading-4 text-baud-danger">{descriptionError}</p>}
							</div>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<TextField
									label="Author"
									value={draft.author}
									error={authorError}
									maxLength={128}
									onChange={(value) => setDraft((current) => ({ ...current, author: value }))}
								/>
								<TextField
									label="Repository URL"
									value={draft.repositoryUrl}
									error={repositoryUrlError}
									maxLength={2048}
									onChange={(value) => setDraft((current) => ({ ...current, repositoryUrl: value }))}
								/>
							</div>
							<p className="-mt-3 text-xs leading-4 text-baud-muted">
								The optional repository URL must use HTTPS and point to repository.json. The editor does not contact it.
							</p>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<TextField
									label="Website"
									value={draft.website}
									error={websiteError}
									maxLength={2048}
									onChange={(value) => setDraft((current) => ({ ...current, website: value }))}
								/>
								<TextField
									label="Source"
									value={draft.source}
									error={sourceError}
									maxLength={2048}
									onChange={(value) => setDraft((current) => ({ ...current, source: value }))}
								/>
							</div>
							<TagField
								tags={tagsDraft}
								inputValue={tagInput}
								error={tagsError}
								onInputChange={setTagInput}
								onTagsChange={setTagsDraft}
							/>
						</div>
					)}

					{activeTab === "runtime" && (
						<div className="grid gap-4">
							<div>
								<span className="mb-1 block font-mono text-sm text-baud-muted">Target Runtimes</span>
								<MultiOptionCombobox
									ariaLabel="Target runtimes"
									options={targetRuntimes.map((runtime) => ({ label: runtime, value: runtime }))}
									values={draft.targetRuntimes}
									onChange={(values) =>
										setDraft((current) => ({
											...current,
											targetRuntimes: values as TargetRuntime[],
										}))
									}
								/>
								{targetRuntimesError && (
									<p className="mt-1 text-xs leading-4 text-baud-danger">{targetRuntimesError}</p>
								)}
							</div>
							<TextField
								label="Minimum BaudBound Version"
								value={draft.minimumRunnerVersion}
								error={minimumRunnerError}
								maxLength={64}
								onChange={(value) => setDraft((current) => ({ ...current, minimumRunnerVersion: value }))}
							/>
						</div>
					)}

					{activeTab === "declaredVariables" && (
						<DeclaredVariableManager
							secrets={secretDeclarationsDraft}
							variables={declaredVariablesDraft}
							onChange={(variables, rename) => {
								setDeclaredVariablesDraft(variables);
								if (rename) {
									setDeclaredVariableRenames((current) => [...current, rename]);
								}
							}}
						/>
					)}

					{activeTab === "secrets" && (
						<SecretReferenceManager
							declarations={secretDeclarationsDraft}
							reservedVariableNames={
								new Set([
									...declaredVariablesDraft.map((variable) => variable.name),
									...scriptSettingsDraft.map((setting) => setting.name),
								])
							}
							simulationValues={simulationSecretValuesDraft}
							onDeclarationsChange={(declarations, rename) => {
								setSecretDeclarationsDraft(declarations);
								if (rename) {
									setSecretRenames((current) => [...current, rename]);
								}
							}}
							onSimulationValueChange={(name, value) =>
								setSimulationSecretValuesDraft((current) => {
									if (value === "") {
										const next = { ...current };
										delete next[name];
										return next;
									}
									return { ...current, [name]: value };
								})
							}
						/>
					)}

					{activeTab === "scriptSettings" && (
						<ScriptSettingManager
							settings={scriptSettingsDraft}
							onChange={(nextSettings, rename) => {
								setScriptSettingsDraft(nextSettings);
								if (rename) {
									setScriptSettingRenames((current) => [...current, rename]);
								}
							}}
						/>
					)}
				</div>

				<DialogFooter className="bg-baud-panel">
					<Button type="button" variant="toolbar" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" variant="primary" onClick={handleSave} disabled={hasErrors}>
						{saveLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function getProjectSettingsTabs(includeDefinitions: boolean): Array<{ id: ProjectSettingsTab; label: string }> {
	const tabs: Array<{ id: ProjectSettingsTab; label: string }> = [
		{ id: "general", label: "General" },
		{ id: "runtime", label: "Runtime" },
	];
	if (includeDefinitions) {
		tabs.push(
			{ id: "declaredVariables", label: "Variables" },
			{ id: "secrets", label: "Secrets" },
			{ id: "scriptSettings", label: "Script Settings" },
		);
	}
	return tabs;
}

function TextField({
	error,
	label,
	maxLength,
	value,
	onChange,
}: {
	error?: string;
	label: string;
	maxLength?: number;
	value: string;
	onChange: (value: string) => void;
}) {
	const inputId = useId();

	return (
		<div>
			<label htmlFor={inputId} className="mb-1 block font-mono text-sm text-baud-muted">
				{label}
			</label>
			<Input
				id={inputId}
				value={value}
				maxLength={maxLength}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={Boolean(error)}
			/>
			{error && <p className="mt-1 text-xs leading-4 text-baud-danger">{error}</p>}
		</div>
	);
}

function TagField({
	error,
	inputValue,
	tags,
	onInputChange,
	onTagsChange,
}: {
	error?: string;
	inputValue: string;
	tags: string[];
	onInputChange: (value: string) => void;
	onTagsChange: (tags: string[]) => void;
}) {
	const inputId = useId();

	const commitInput = () => {
		const nextTags = appendTags(tags, inputValue);
		if (nextTags !== tags) {
			onTagsChange(nextTags);
		}
		onInputChange("");
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Backspace" && !inputValue && tags.length > 0) {
			event.preventDefault();
			onTagsChange(tags.slice(0, -1));
			return;
		}

		if (!isTagCommitKey(event.key)) {
			return;
		}

		if (!inputValue.trim()) {
			return;
		}

		event.preventDefault();
		commitInput();
	};

	const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
		const pastedText = event.clipboardData.getData("text");
		const pastedTags = parseTags(pastedText);
		if (pastedTags.length <= 1) {
			return;
		}

		event.preventDefault();
		onTagsChange(appendTags(tags, pastedText));
		onInputChange("");
	};

	return (
		<div>
			<label htmlFor={inputId} className="mb-1 block font-mono text-sm text-baud-muted">
				Tags
			</label>
			<div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-baud-border bg-baud-soft px-2 py-1 transition-[border-color,box-shadow] focus-within:border-baud-red/75 focus-within:shadow-[0_0_0_2px_rgb(230_45_62_/_0.14)]">
				{tags.map((tag) => (
					<Badge key={tag} variant="outline" className="h-6 gap-1 border-baud-line bg-baud-panel px-2 text-baud-text">
						<span>{tag}</span>
						<button
							type="button"
							aria-label={`Remove ${tag}`}
							className="-mr-1 grid size-4 place-items-center rounded text-baud-muted hover:text-baud-text"
							onClick={() => onTagsChange(tags.filter((currentTag) => currentTag !== tag))}
						>
							<X size={12} />
						</button>
					</Badge>
				))}
				<input
					id={inputId}
					value={inputValue}
					onChange={(event) => onInputChange(event.target.value)}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
					onBlur={commitInput}
					className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-baud-muted"
					placeholder={tags.length === 0 ? "Add tags..." : ""}
					maxLength={64}
				/>
			</div>
			{error && <p className="mt-1 text-xs leading-4 text-baud-danger">{error}</p>}
			<p className="mt-1 text-xs leading-4 text-baud-muted">Press Enter, Space, Tab, or comma to create a tag.</p>
		</div>
	);
}

function isTagCommitKey(key: string) {
	return key === "Enter" || key === " " || key === "Spacebar" || key === "," || key === "Tab";
}

function appendTags(currentTags: string[], value: string) {
	const nextTags = [...currentTags];
	for (const tag of parseTags(value)) {
		if (!nextTags.includes(tag)) {
			nextTags.push(tag);
		}
	}

	return nextTags.length === currentTags.length ? currentTags : nextTags;
}

function parseTags(value: string) {
	return value
		.split(/[,\s]+/)
		.map((tag) => tag.trim())
		.filter(Boolean);
}

function getOptionalUrlError(value: string) {
	if (value.length > 2048) {
		return "URL cannot exceed 2048 characters.";
	}
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return "";
	}

	try {
		const url = new URL(trimmedValue);
		return url.protocol === "http:" || url.protocol === "https:" ? "" : "Use an http or https URL.";
	} catch {
		return "Use a valid URL.";
	}
}

function getTagsError(tags: string[]) {
	if (tags.length > 32) return "A project can have at most 32 tags.";
	if (tags.some((tag) => tag.length > 64)) return "Each tag can contain at most 64 characters.";
	return "";
}
