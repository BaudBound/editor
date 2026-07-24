"use client";

import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import { Check, Copy, FileJson, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CapabilitySummary, PermissionSummary, ProjectSettings, RiskLevel } from "@/lib/types";
import type { GeneratedBbsPackage } from "@/utils/bbs-package";
import {
	createScriptRepositoryDocument,
	getDirectPackageUrlError,
	MAX_RELEASE_NOTES_BYTES,
} from "@/utils/script-repository";

type RepositoryEntryDialogProps = {
	capabilities: CapabilitySummary[];
	generatedPackage: GeneratedBbsPackage;
	onClose: () => void;
	open: boolean;
	permissions: PermissionSummary[];
	projectSettings: ProjectSettings;
	riskLevel: RiskLevel;
};

type ReleaseNotesTab = "editor" | "preview";

export function RepositoryEntryDialog({
	capabilities,
	generatedPackage,
	onClose,
	open,
	permissions,
	projectSettings,
	riskLevel,
}: RepositoryEntryDialogProps) {
	const repositoryNameId = useId();
	const repositoryDescriptionId = useId();
	const repositoryHomepageId = useId();
	const packageUrlId = useId();
	const releaseNotesId = useId();
	const [repositoryName, setRepositoryName] = useState("My BaudBound Scripts");
	const [repositoryDescription, setRepositoryDescription] = useState("");
	const [repositoryHomepage, setRepositoryHomepage] = useState("");
	const [packageUrl, setPackageUrl] = useState("");
	const [releaseNotes, setReleaseNotes] = useState("");
	const [releaseNotesTab, setReleaseNotesTab] = useState<ReleaseNotesTab>("editor");
	const [repositoryJson, setRepositoryJson] = useState("");
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const packageUrlError = getDirectPackageUrlError(packageUrl);

	useEffect(() => {
		if (open) {
			return;
		}

		setRepositoryName("My BaudBound Scripts");
		setRepositoryDescription("");
		setRepositoryHomepage("");
		setPackageUrl("");
		setReleaseNotes("");
		setReleaseNotesTab("editor");
		setRepositoryJson("");
		setError("");
		setCopied(false);
	}, [open]);

	useEffect(() => {
		if (!open || packageUrlError || !repositoryName.trim()) {
			setRepositoryJson("");
			setError("");
			return;
		}

		let cancelled = false;
		void createScriptRepositoryDocument({
			bytes: generatedPackage.bytes,
			capabilities,
			packageUrl,
			permissions,
			projectSettings,
			releaseNotes,
			repositoryDescription,
			repositoryHomepage,
			repositoryName,
			riskLevel,
			scriptId: generatedPackage.scriptId,
		})
			.then((document) => {
				if (cancelled) return;
				setRepositoryJson(`${JSON.stringify(document, null, 2)}\n`);
				setError("");
			})
			.catch((reason) => {
				if (cancelled) return;
				setRepositoryJson("");
				setError(reason instanceof Error ? reason.message : "Repository JSON could not be created.");
			});
		return () => {
			cancelled = true;
		};
	}, [
		capabilities,
		generatedPackage,
		open,
		packageUrl,
		packageUrlError,
		permissions,
		projectSettings,
		releaseNotes,
		repositoryDescription,
		repositoryHomepage,
		repositoryName,
		riskLevel,
	]);

	const markdown = useMemo(() => releaseNotes.trim() || "No release notes have been entered.", [releaseNotes]);

	const copyRepositoryJson = async () => {
		if (!repositoryJson) return;
		setCopied(false);
		try {
			await navigator.clipboard.writeText(repositoryJson);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2_000);
		} catch {
			setError("The repository JSON could not be copied. Select it in the editor and copy it manually.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
			<DialogContent
				className="grid h-[92vh] max-h-[92vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-6xl"
				showCloseButton={false}
			>
				<DialogHeader className="border-b border-baud-border px-6 py-5">
					<div className="flex items-start justify-between gap-4">
						<div>
							<DialogTitle>Create repository entry</DialogTitle>
							<DialogDescription>
								Enter repository details, the public package URL, and release notes. Then copy the generated
								repository.json.
							</DialogDescription>
						</div>
						<Button aria-label="Close repository entry" onClick={onClose} size="icon" type="button" variant="icon">
							<X size={15} />
						</Button>
					</div>
				</DialogHeader>

				<div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
					<section className="rounded border border-baud-border bg-baud-elevated p-4">
						<h3 className="mb-4 text-xs font-bold tracking-[0.18em] text-baud-muted uppercase">
							Repository information
						</h3>
						<div className="grid gap-4 lg:grid-cols-2">
							<Field id={repositoryNameId} label="Repository name">
								<Input
									id={repositoryNameId}
									maxLength={160}
									onChange={(event) => setRepositoryName(event.target.value)}
									placeholder="My BaudBound Scripts"
									value={repositoryName}
								/>
							</Field>
							<Field id={repositoryHomepageId} label="Repository homepage">
								<Input
									id={repositoryHomepageId}
									maxLength={2048}
									onChange={(event) => setRepositoryHomepage(event.target.value)}
									placeholder="https://example.com/scripts"
									value={repositoryHomepage}
								/>
							</Field>
							<Field className="lg:col-span-2" id={repositoryDescriptionId} label="Repository description">
								<Textarea
									className="min-h-24 resize-y"
									id={repositoryDescriptionId}
									maxLength={4000}
									onChange={(event) => setRepositoryDescription(event.target.value)}
									placeholder="Describe this collection of scripts."
									value={repositoryDescription}
								/>
							</Field>
							<Field className="lg:col-span-2" id={packageUrlId} label="Package URL">
								<Input
									id={packageUrlId}
									maxLength={2048}
									onChange={(event) => setPackageUrl(event.target.value)}
									placeholder="https://example.com/packages/script-id/script-1.0.0.bbs"
									value={packageUrl}
								/>
								{packageUrl && packageUrlError ? (
									<p className="mt-1 text-xs text-baud-danger">{packageUrlError}</p>
								) : null}
							</Field>
						</div>
					</section>

					<section className="overflow-hidden rounded border border-baud-border bg-baud-elevated">
						<div className="flex items-center justify-between gap-4 border-b border-baud-border px-4 py-3">
							<h3 className="text-xs font-bold tracking-[0.18em] text-baud-muted uppercase">Release notes</h3>
							<div
								aria-label="Release notes view"
								className="flex rounded border border-baud-border bg-baud-bg p-0.5"
								role="tablist"
							>
								{(["editor", "preview"] as const).map((tab) => (
									<Button
										key={tab}
										aria-selected={releaseNotesTab === tab}
										className="h-7 capitalize"
										onClick={() => setReleaseNotesTab(tab)}
										role="tab"
										type="button"
										variant={releaseNotesTab === tab ? "toolbarActive" : "ghost"}
									>
										{tab}
									</Button>
								))}
							</div>
						</div>
						<div className="min-h-56 p-4">
							{releaseNotesTab === "editor" ? (
								<>
									<Textarea
										className="min-h-44 resize-y"
										id={releaseNotesId}
										onChange={(event) => setReleaseNotes(event.target.value)}
										placeholder="Describe the changes in this version using Markdown."
										value={releaseNotes}
									/>
									<p className="mt-2 text-xs text-baud-muted">
										{new TextEncoder().encode(releaseNotes).byteLength} of {MAX_RELEASE_NOTES_BYTES} bytes
									</p>
								</>
							) : (
								<div className="min-h-44 text-sm leading-6 text-baud-text">
									<ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
										{markdown}
									</ReactMarkdown>
								</div>
							)}
						</div>
					</section>

					<section className="min-h-72 overflow-hidden rounded border border-baud-border bg-[#090b10]">
						<div className="flex items-center gap-2 border-b border-baud-border px-4 py-3 text-sm font-semibold">
							<FileJson size={15} />
							repository.json
						</div>
						<CodeMirror
							basicSetup={{ foldGutter: true, lineNumbers: true }}
							editable={false}
							extensions={[json()]}
							height="320px"
							readOnly
							theme="dark"
							value={repositoryJson}
						/>
					</section>

					{error ? (
						<div className="rounded border border-baud-danger/35 bg-baud-danger/10 px-4 py-3 text-sm text-baud-danger">
							{error}
						</div>
					) : null}
				</div>

				<div className="flex items-center justify-between gap-4 border-t border-baud-border px-6 py-4">
					<p className="text-xs text-baud-muted">
						Copy this document into the repository.json file hosted by the publisher.
					</p>
					<Button disabled={!repositoryJson} onClick={() => void copyRepositoryJson()} type="button" variant="primary">
						{copied ? <Check size={14} /> : <Copy size={14} />}
						{copied ? "Copied" : "Copy repository JSON"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Field({
	children,
	className,
	id,
	label,
}: {
	children: React.ReactNode;
	className?: string;
	id: string;
	label: string;
}) {
	return (
		<div className={className}>
			<label className="mb-1 block font-mono text-sm text-baud-muted" htmlFor={id}>
				{label}
			</label>
			{children}
		</div>
	);
}

const markdownComponents = {
	h1: ({ children }: { children?: React.ReactNode }) => (
		<h1 className="mb-3 text-xl font-bold text-baud-text">{children}</h1>
	),
	h2: ({ children }: { children?: React.ReactNode }) => (
		<h2 className="mb-2 mt-4 text-lg font-bold text-baud-text">{children}</h2>
	),
	h3: ({ children }: { children?: React.ReactNode }) => (
		<h3 className="mb-2 mt-3 font-bold text-baud-text">{children}</h3>
	),
	p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
	ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
	ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
	code: ({ children }: { children?: React.ReactNode }) => (
		<code className="rounded bg-baud-bg px-1 py-0.5 font-mono text-baud-text">{children}</code>
	),
};
