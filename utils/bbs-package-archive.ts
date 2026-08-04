import { packageLimits } from "@/data/project/package-limits";
import { type PackageArchive, readArchiveWithWorker } from "./package-archive-worker-client";

export type { PackageArchive, PackageArchiveEntry } from "./package-archive-worker-client";

export async function readBbsPackageArchive(file: File, signal?: AbortSignal): Promise<PackageArchive> {
	if (file.size > packageLimits.max_archive_bytes) {
		throw new Error(`Package archive is ${file.size} bytes. The maximum is ${packageLimits.max_archive_bytes} bytes.`);
	}
	return readArchiveWithWorker(
		file,
		() => new Worker(new URL("./bbs-package.worker.ts", import.meta.url), { type: "module" }),
		signal,
	);
}
