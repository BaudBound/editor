import { ChevronDown } from "lucide-react";
import { CopyTextButton } from "@/components/common/copy-text-button";
import { datetimeFormatTokenGroups } from "@/data/project/datetime-format";

/**
 * The tokens a format pattern is built from, with what each one renders.
 *
 * A node-level reference rather than a field-level one, so it keeps its place
 * whichever operation row is being edited and however many of them format a
 * datetime. It reads rather than writes for the same reason: with two format
 * operations in one pipeline there is no row a button could append to without
 * guessing.
 */
export function DatetimeTokenPanel() {
	return (
		<details className="group rounded border border-baud-border bg-baud-soft">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
				<span className="text-xs font-bold uppercase tracking-[0.18em] text-baud-muted">Format Tokens</span>
				<ChevronDown size={14} className="text-baud-muted transition-transform group-open:rotate-180" />
			</summary>
			<div className="space-y-3 border-t border-baud-border p-3 text-sm leading-5 text-baud-muted">
				<p>
					Letters are read as tokens and everything else is kept as written, so{" "}
					<span className="font-mono text-baud-text">yyyy-MM-dd HH:mm</span> gives{" "}
					<span className="font-mono text-baud-text">2026-07-03 14:05</span>.
				</p>
				<p>
					To keep a letter as text, wrap it in single quotes:{" "}
					<span className="font-mono text-baud-text">HH:mm 'on' EEEE</span> gives{" "}
					<span className="font-mono text-baud-text">14:05 on Friday</span>. Two quotes in a row write one quote.
				</p>
				{datetimeFormatTokenGroups.map((group) => (
					<div key={group.label} className="border-b border-baud-border pb-2 last:border-b-0 last:pb-0">
						<div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-baud-muted">{group.label}</div>
						{group.tokens.map((entry) => (
							<div key={entry.token} className="flex items-center justify-between gap-3 py-0.5">
								<div className="flex min-w-0 items-center gap-2">
									<span className="font-mono text-sm text-baud-text">{entry.token}</span>
									<CopyTextButton text={entry.token} label={`Copy ${entry.token}`} />
								</div>
								<span className="truncate text-sm text-baud-muted">{entry.description}</span>
							</div>
						))}
					</div>
				))}
			</div>
		</details>
	);
}
