import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { datetimeFormatTokenGroups } from "@/data/project/datetime-format";

type DatetimeTokenPanelProps = {
	value: string;
	onChange: (value: string) => void;
};

/**
 * The tokens a format pattern is built from, with a button per token.
 *
 * Modelled on the key reference in the keyboard trigger: the same collapsed
 * details element, and the same append-on-click, so an author can build a
 * pattern without learning the language first.
 */
export function DatetimeTokenPanel({ value, onChange }: DatetimeTokenPanelProps) {
	return (
		<details className="group rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs text-baud-muted">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-baud-text">
				Format token reference
				<ChevronDown size={14} className="transition-transform group-open:rotate-180" />
			</summary>
			<div className="mt-2 space-y-2 leading-4">
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
				<div className="max-h-72 space-y-3 overflow-y-auto rounded border border-baud-border bg-baud-panel p-2">
					{datetimeFormatTokenGroups.map((group) => (
						<div key={group.label}>
							<div className="mb-1 font-semibold uppercase tracking-[0.12em] text-baud-muted">{group.label}</div>
							<div className="flex flex-wrap gap-1">
								{group.tokens.map((entry) => (
									<Button
										key={entry.token}
										type="button"
										variant="outline"
										size="sm"
										title={entry.description}
										aria-label={`Add ${entry.token} to the pattern, ${entry.description}`}
										className="h-7 rounded border-baud-border bg-baud-soft px-2 font-mono text-xs text-baud-text hover:border-baud-line hover:bg-baud-line"
										onClick={() => onChange(`${value}${entry.token}`)}
									>
										{entry.token}
										<span className="ml-1 text-baud-muted">{entry.description}</span>
									</Button>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</details>
	);
}
