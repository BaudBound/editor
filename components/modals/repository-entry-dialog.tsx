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

export function RepositoryEntryDialog({
	capabilities,
	generatedPackage,
	onClose,
	open,
	permissions,
	projectSettings,
	riskLevel,
}: RepositoryEntryDialogProps) {
	const packageUrlId = useId();
	const releaseNotesId = useId();
	const [packageUrl, setPackageUrl] = useState("");
	const [releaseNotes, setReleaseNotes] = useState("");
	const [repositoryJson, setRepositoryJson] = useState("");
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const packageUrlError = getDirectPackageUrlError(packageUrl);

	useEffect(() => {
		if (!open) {
			setPackageUrl("");
			setReleaseNotes("");
			setRepositoryJson("");
			setError("");
			setCopied(false);
			return;
		}
		if (packageUrlError) {
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
			<DialogContent className="grid h-[90vh] max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-6xl">
				<DialogHeader className="border-b border-baud-border px-6 py-5">
					<div className="flex items-start justify-between gap-4">
						<div>
							<DialogTitle>Create repository entry</DialogTitle>
							<DialogDescription>
								Enter the public package URL and release notes, then copy the complete repository.json.
							</DialogDescription>
						</div>
						<Button aria-label="Close repository entry" onClick={onClose} size="icon" type="button" variant="icon">
							<X size={15} />
						</Button>
					</div>
				</DialogHeader>

				<div className="grid min-h-0 gap-5 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
					<div className="grid gap-4 lg:grid-cols-2">
						<div className="grid content-start gap-4">
							<div>
								<label className="mb-1 block font-mono text-sm text-baud-muted" htmlFor={packageUrlId}>
									Package URL
								</label>
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
							</div>
							<div>
								<label className="mb-1 block font-mono text-sm text-baud-muted" htmlFor={releaseNotesId}>
									Release notes
								</label>
								<Textarea
									className="min-h-48 resize-y"
									id={releaseNotesId}
									onChange={(event) => setReleaseNotes(event.target.value)}
									placeholder="Describe the changes in this version using Markdown."
									value={releaseNotes}
								/>
								<p className="mt-1 text-xs text-baud-muted">
									{new TextEncoder().encode(releaseNotes).byteLength} of {MAX_RELEASE_NOTES_BYTES} bytes
								</p>
							</div>
						</div>
						<div className="min-h-48 rounded border border-baud-border bg-baud-elevated p-4">
							<div className="mb-3 text-xs font-bold tracking-[0.18em] text-baud-muted uppercase">Markdown preview</div>
							<div className="prose prose-invert max-w-none text-sm text-baud-text">
								<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
									{markdown}
								</ReactMarkdown>
							</div>
						</div>
					</div>

					<div className="min-h-72 overflow-hidden rounded border border-baud-border bg-[#090b10]">
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
					</div>

					{error ? (
						<div className="rounded border border-baud-danger/35 bg-baud-danger/10 px-4 py-3 text-sm text-baud-danger">
							{error}
						</div>
					) : null}
				</div>

				<div className="flex items-center justify-between border-t border-baud-border px-6 py-4">
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
