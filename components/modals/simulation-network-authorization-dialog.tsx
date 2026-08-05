import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

export function SimulationNetworkAuthorizationDialog({
	open,
	origins,
	onAuthorize,
	onCancel,
}: {
	open: boolean;
	origins: readonly string[];
	onAuthorize: () => void;
	onCancel: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<DialogContent className="sm:max-w-lg" showCloseButton={false}>
				<DialogHeader>
					<div className="flex items-center gap-3">
						<ShieldAlert aria-hidden="true" className="shrink-0 text-baud-warning" size={24} />
						<DialogTitle>Authorize live HTTP requests</DialogTitle>
					</div>
					<DialogDescription>
						This simulation can send resolved headers, request bodies, and secrets to the listed destinations.
						Authorization lasts only for the current simulation session.
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-56 overflow-y-auto rounded border border-baud-border bg-baud-bg p-2">
					<ul className="space-y-1">
						{origins.map((origin) => (
							<li key={origin} className="break-all rounded bg-baud-soft px-3 py-2 font-mono text-xs text-baud-text">
								{origin}
							</li>
						))}
					</ul>
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button type="button" variant="destructive" onClick={onAuthorize}>
						Authorize
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
