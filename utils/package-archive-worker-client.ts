export type PackageArchiveEntry = {
	bytes: Uint8Array<ArrayBuffer>;
	path: string;
};

export type PackageArchive = {
	entries: ReadonlyMap<string, PackageArchiveEntry>;
	fileNames: readonly string[];
};

type ArchiveWorkerEntry = {
	bytes: ArrayBuffer;
	path: string;
};

type ArchiveWorkerResponse = { entries: ArchiveWorkerEntry[]; ok: true } | { message: string; ok: false };

export function readArchiveWithWorker(
	file: File,
	createWorker: () => Worker,
	signal?: AbortSignal,
): Promise<PackageArchive> {
	if (signal?.aborted) {
		return Promise.reject(createAbortError());
	}

	return new Promise<PackageArchive>((resolve, reject) => {
		const worker = createWorker();
		let settled = false;

		const finish = (result: { archive: PackageArchive } | { error: unknown }) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", handleAbort);
			worker.terminate();
			if ("archive" in result) {
				resolve(result.archive);
			} else {
				reject(result.error);
			}
		};
		const handleAbort = () => finish({ error: createAbortError() });

		worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
			const response = event.data;
			if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
				finish({ error: new Error("Package reader returned an invalid response.") });
				return;
			}
			if (!response.ok) {
				finish({ error: new Error(response.message) });
				return;
			}

			const entries = new Map<string, PackageArchiveEntry>();
			for (const entry of response.entries) {
				if (typeof entry.path !== "string" || !(entry.bytes instanceof ArrayBuffer)) {
					finish({ error: new Error("Package reader returned an invalid archive entry.") });
					return;
				}
				entries.set(entry.path, { bytes: new Uint8Array(entry.bytes), path: entry.path });
			}
			finish({
				archive: {
					entries,
					fileNames: [...entries.keys()].sort(),
				},
			});
		};
		worker.onerror = (event) => {
			event.preventDefault();
			finish({ error: new Error(event.message || "Package reader worker failed.") });
		};
		worker.onmessageerror = () => finish({ error: new Error("Package reader response could not be decoded.") });
		signal?.addEventListener("abort", handleAbort, { once: true });
		worker.postMessage({ file });
	});
}

function createAbortError() {
	return new DOMException("Package reading was cancelled.", "AbortError");
}
