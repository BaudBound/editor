import { ChevronDown } from "lucide-react";
import { CopyTextButton } from "@/components/common/copy-text-button";
import { durationFormatTokenGroups } from "@/data/project/duration-format";

/** A reference for the duration format operation in Text Transform. */
export function DurationTokenPanel() {
	return (
		<details className="group rounded border border-baud-border bg-baud-soft">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
				<span className="text-xs font-bold uppercase tracking-[0.18em] text-baud-muted">Duration Format Tokens</span>
				<ChevronDown size={14} className="text-baud-muted transition-transform group-open:rotate-180" />
			</summary>
			<div className="space-y-3 border-t border-baud-border p-3 text-sm leading-5 text-baud-muted">
				<p>
					Recognized letters are format tokens; punctuation and whitespace are kept as written, so{" "}
					<span className="font-mono text-baud-text">D HH:mm:ss</span> gives{" "}
					<span className="font-mono text-baud-text">1 01:01:01</span> for 90,061 seconds.
				</p>
				<p>Hours are the part remaining after whole days. To keep letters as text, wrap them in single quotes.</p>
				{durationFormatTokenGroups.map((group) => (
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
