"use client";

import { CopyTextButton } from "@/components/common/copy-text-button";
import { cn } from "@/lib/utils";
import type { VerificationCheck } from "@/utils/verification";

type VerificationResultBlockProps = {
	check: VerificationCheck;
	className?: string;
};

export function VerificationResultBlock({ check, className }: VerificationResultBlockProps) {
	const details = check.details?.length ? check.details : null;
	const copyText = details ? details.join("\n") : check.message;

	return (
		<div
			data-verification-result
			className={cn(
				"relative mt-2 select-text rounded border border-baud-border bg-baud-panel/70 px-2.5 py-2 pr-10 text-sm leading-5",
				className,
			)}
		>
			<div className="absolute top-1.5 right-1.5">
				<CopyTextButton text={copyText} label={`Copy ${check.title} result`} />
			</div>

			{details ? (
				<ul className="space-y-1.5">
					{details.map((detail, index) => (
						<li key={`${check.id}-${index}`} className="flex items-start gap-2">
							<span aria-hidden="true" className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-current" />
							<span className="min-w-0 select-text break-words">{detail}</span>
						</li>
					))}
				</ul>
			) : (
				<p className="select-text">{check.message}</p>
			)}
		</div>
	);
}
