/// <reference lib="webworker" />

import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { packageLimits } from "@/data/project/package-limits";

type WorkerRequest = { file: File };
type ExtractedEntry = { bytes: Uint8Array<ArrayBuffer>; path: string };
type CentralDirectoryEntry = { uncompressedSize: number };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	void extractArchive(event.data?.file)
		.then((entries) => {
			const transfer = entries.map((entry) => entry.bytes.buffer);
			self.postMessage(
				{
					entries: entries.map((entry) => ({ bytes: entry.bytes.buffer, path: entry.path })),
					ok: true,
				},
				{ transfer },
			);
		})
		.catch((error: unknown) => {
			self.postMessage({ message: boundedErrorMessage(error), ok: false });
		});
};

async function extractArchive(file: File): Promise<ExtractedEntry[]> {
	if (!(file instanceof File)) {
		throw new Error("Package reader did not receive a file.");
	}
	if (file.size === 0) {
		throw new Error("Package archive is empty.");
	}
	if (file.size > packageLimits.max_archive_bytes) {
		throw new Error(`Package archive exceeds the maximum of ${packageLimits.max_archive_bytes} bytes.`);
	}
	const centralDirectoryEntries = await validateCentralDirectory(file);

	const entries: ExtractedEntry[] = [];
	let entryCount = 0;
	let totalUncompressed = 0;
	let activeFiles = 0;
	let extractionError: Error | null = null;
	const unzip = new Unzip((entry) => {
		if (extractionError) return;
		try {
			entryCount += 1;
			if (entryCount > packageLimits.max_entry_count) {
				throw new Error(`Package contains more than ${packageLimits.max_entry_count} entries.`);
			}
			const isDirectory = entry.name.endsWith("/");
			const centralEntry = centralDirectoryEntries.get(entry.name);
			if (!centralEntry || !centralDirectoryEntries.delete(entry.name)) {
				throw new Error(`${entry.name}: local package entry is missing or duplicated in the central directory.`);
			}
			const maximum = entry.name.startsWith("assets/")
				? packageLimits.max_asset_bytes
				: packageLimits.max_metadata_bytes;
			let entrySize = 0;
			const bytes = isDirectory ? null : new Uint8Array(centralEntry.uncompressedSize);
			activeFiles += 1;
			entry.ondata = (error, chunk, final) => {
				if (extractionError) return;
				try {
					if (error) throw error;
					const nextEntrySize = checkedAdd(entrySize, chunk.byteLength, "package entry size");
					totalUncompressed = checkedAdd(totalUncompressed, chunk.byteLength, "package uncompressed size");
					if (isDirectory && nextEntrySize > 0) {
						throw new Error(`${entry.name}: directory entry contains data.`);
					}
					if (nextEntrySize > maximum) {
						throw new Error(`${entry.name}: size exceeds the maximum of ${maximum} bytes.`);
					}
					if (nextEntrySize > centralEntry.uncompressedSize) {
						throw new Error(`${entry.name}: expanded size exceeds its central directory size.`);
					}
					if (totalUncompressed > packageLimits.max_total_uncompressed_bytes) {
						throw new Error(`Package uncompressed size exceeds ${packageLimits.max_total_uncompressed_bytes} bytes.`);
					}
					if (
						totalUncompressed >= packageLimits.expansion_ratio_minimum_bytes &&
						totalUncompressed / file.size > packageLimits.max_expansion_ratio
					) {
						throw new Error(`Package archive expansion exceeds ${packageLimits.max_expansion_ratio}:1.`);
					}
					if (bytes && chunk.byteLength > 0) bytes.set(chunk, entrySize);
					entrySize = nextEntrySize;
					if (final) {
						if (entrySize !== centralEntry.uncompressedSize) {
							throw new Error(`${entry.name}: expanded size does not match its central directory size.`);
						}
						activeFiles -= 1;
						if (bytes) entries.push({ bytes, path: entry.name });
					}
				} catch (caught) {
					extractionError = asError(caught);
					entry.terminate();
				}
			};
			entry.start();
		} catch (caught) {
			extractionError = asError(caught);
			entry.terminate();
		}
	});
	unzip.register(UnzipPassThrough);
	unzip.register(UnzipInflate);

	const reader = file.stream().getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (extractionError) throw extractionError;
			if (done) {
				unzip.push(new Uint8Array(), true);
				break;
			}
			unzip.push(value);
		}
		if (extractionError) throw extractionError;
		if (activeFiles !== 0) {
			throw new Error("Package archive ended before all entries were complete.");
		}
		if (centralDirectoryEntries.size !== 0 || entryCount === 0) {
			throw new Error("Package archive entries do not match its central directory.");
		}
		return entries;
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

async function validateCentralDirectory(file: File) {
	const eocd = await readEndOfCentralDirectory(file);
	if (eocd.entryCount > packageLimits.max_entry_count) {
		throw new Error(`Package contains more than ${packageLimits.max_entry_count} entries.`);
	}
	const centralEnd = checkedAdd(eocd.centralOffset, eocd.centralSize, "package central directory");
	if (centralEnd !== eocd.offset) {
		throw new Error("Package central directory location is invalid.");
	}

	const paths = new Set<string>();
	const lowercasePaths = new Set<string>();
	const entries = new Map<string, CentralDirectoryEntry>();
	let totalUncompressed = 0;
	let offset = eocd.centralOffset;
	for (let index = 0; index < eocd.entryCount; index += 1) {
		const fixed = await readFileBytes(file, offset, 46, "central directory entry");
		const view = dataView(fixed);
		if (view.getUint32(0, true) !== 0x02014b50) {
			throw new Error(`Package central directory entry ${index + 1} is invalid.`);
		}
		const flags = view.getUint16(8, true);
		const compression = view.getUint16(10, true);
		const crc32 = view.getUint32(16, true);
		const compressedSize = view.getUint32(20, true);
		const uncompressedSize = view.getUint32(24, true);
		const nameLength = view.getUint16(28, true);
		const extraLength = view.getUint16(30, true);
		const commentLength = view.getUint16(32, true);
		const diskNumber = view.getUint16(34, true);
		const localOffset = view.getUint32(42, true);
		if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
			throw new Error("ZIP64 package entries are not supported.");
		}
		if (diskNumber !== 0) throw new Error("Multi-disk package archives are not supported.");
		if ((flags & 0x41) !== 0) throw new Error("Encrypted package entries are not supported.");
		if (compression !== 0 && compression !== 8) {
			throw new Error(`Package entry ${index + 1} uses unsupported ZIP compression method ${compression}.`);
		}
		if (nameLength === 0 || nameLength > packageLimits.max_path_bytes) {
			throw new Error(`Package entry path exceeds ${packageLimits.max_path_bytes} UTF-8 bytes.`);
		}

		const recordLength = checkedAdd(
			46,
			checkedAdd(
				nameLength,
				checkedAdd(extraLength, commentLength, "package entry metadata"),
				"package entry metadata",
			),
			"package central directory entry",
		);
		const recordEnd = checkedAdd(offset, recordLength, "package central directory entry");
		if (recordEnd > centralEnd) throw new Error("Package central directory entry is truncated.");
		const nameBytes = await readFileBytes(file, offset + 46, nameLength, "package entry name");
		const path = decodeZipPath(nameBytes, (flags & 0x0800) !== 0);
		validateEntryPath(path, path.endsWith("/"), paths, lowercasePaths);
		const maximum = path.startsWith("assets/") ? packageLimits.max_asset_bytes : packageLimits.max_metadata_bytes;
		if (uncompressedSize > maximum) {
			throw new Error(`${path}: size exceeds the maximum of ${maximum} bytes.`);
		}
		totalUncompressed = checkedAdd(totalUncompressed, uncompressedSize, "package uncompressed size");
		if (totalUncompressed > packageLimits.max_total_uncompressed_bytes) {
			throw new Error(`Package uncompressed size exceeds ${packageLimits.max_total_uncompressed_bytes} bytes.`);
		}
		if (
			totalUncompressed >= packageLimits.expansion_ratio_minimum_bytes &&
			totalUncompressed / file.size > packageLimits.max_expansion_ratio
		) {
			throw new Error(`Package archive expansion exceeds ${packageLimits.max_expansion_ratio}:1.`);
		}
		entries.set(path, { uncompressedSize });
		await validateLocalHeader(file, {
			centralOffset: eocd.centralOffset,
			compressedSize,
			compression,
			crc32,
			flags,
			localOffset,
			nameBytes,
			uncompressedSize,
		});
		offset = recordEnd;
	}
	if (offset !== centralEnd) throw new Error("Package central directory contains trailing data.");
	return entries;
}

async function readEndOfCentralDirectory(file: File) {
	const minimumLength = 22;
	if (file.size < minimumLength) throw new Error("Package archive is missing its central directory.");
	const tailLength = Math.min(file.size, minimumLength + 0xffff);
	const tailOffset = file.size - tailLength;
	const tail = await readFileBytes(file, tailOffset, tailLength, "package central directory footer");
	const view = dataView(tail);
	for (let index = tail.length - minimumLength; index >= 0; index -= 1) {
		if (view.getUint32(index, true) !== 0x06054b50) continue;
		const commentLength = view.getUint16(index + 20, true);
		if (index + minimumLength + commentLength !== tail.length) continue;
		const diskNumber = view.getUint16(index + 4, true);
		const centralDisk = view.getUint16(index + 6, true);
		const entriesOnDisk = view.getUint16(index + 8, true);
		const entryCount = view.getUint16(index + 10, true);
		const centralSize = view.getUint32(index + 12, true);
		const centralOffset = view.getUint32(index + 16, true);
		if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
			throw new Error("ZIP64 package archives are not supported.");
		}
		if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
			throw new Error("Multi-disk package archives are not supported.");
		}
		return { centralOffset, centralSize, entryCount, offset: tailOffset + index };
	}
	throw new Error("Package archive is missing a valid central directory footer.");
}

async function validateLocalHeader(
	file: File,
	entry: {
		centralOffset: number;
		compressedSize: number;
		compression: number;
		crc32: number;
		flags: number;
		localOffset: number;
		nameBytes: Uint8Array;
		uncompressedSize: number;
	},
) {
	const fixed = await readFileBytes(file, entry.localOffset, 30, "local package entry");
	const view = dataView(fixed);
	if (view.getUint32(0, true) !== 0x04034b50) throw new Error("Package local entry header is invalid.");
	const localFlags = view.getUint16(6, true);
	const localCompression = view.getUint16(8, true);
	const localCrc32 = view.getUint32(14, true);
	const localCompressedSize = view.getUint32(18, true);
	const localUncompressedSize = view.getUint32(22, true);
	const nameLength = view.getUint16(26, true);
	const extraLength = view.getUint16(28, true);
	if (localFlags !== entry.flags || localCompression !== entry.compression || nameLength !== entry.nameBytes.length) {
		throw new Error("Package local and central entry headers disagree.");
	}
	const localName = await readFileBytes(file, entry.localOffset + 30, nameLength, "local package entry name");
	if (!bytesEqual(localName, entry.nameBytes)) throw new Error("Package local and central entry names disagree.");
	if ((entry.flags & 0x0008) === 0) {
		if (
			localCrc32 !== entry.crc32 ||
			localCompressedSize !== entry.compressedSize ||
			localUncompressedSize !== entry.uncompressedSize
		) {
			throw new Error("Package local and central entry sizes disagree.");
		}
	}
	const dataOffset = checkedAdd(
		entry.localOffset,
		checkedAdd(30, checkedAdd(nameLength, extraLength, "local package entry"), "local package entry"),
		"local package entry",
	);
	if (checkedAdd(dataOffset, entry.compressedSize, "compressed package entry") > entry.centralOffset) {
		throw new Error("Package entry data overlaps its central directory.");
	}
}

async function readFileBytes(file: File, offset: number, length: number, label: string) {
	const end = checkedAdd(offset, length, label);
	if (offset < 0 || end > file.size) throw new Error(`${label} is truncated.`);
	return new Uint8Array(await file.slice(offset, end).arrayBuffer());
}

function decodeZipPath(bytes: Uint8Array, utf8: boolean) {
	if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
		throw new Error("Package entry names containing non-ASCII text must use UTF-8.");
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("Package contains an invalid UTF-8 entry name.");
	}
}

function dataView(bytes: Uint8Array) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
	return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function validateEntryPath(path: string, isDirectory: boolean, paths: Set<string>, lowercasePaths: Set<string>) {
	if (!path || path.includes("\uFFFD")) throw new Error("Package contains an invalid entry name.");
	if (new TextEncoder().encode(path).byteLength > packageLimits.max_path_bytes) {
		throw new Error(`Package entry path exceeds ${packageLimits.max_path_bytes} UTF-8 bytes.`);
	}
	if (path.startsWith("/") || path.includes("\\") || path.includes(":")) {
		throw new Error(`${path}: package entry path must be relative.`);
	}
	if (
		[...path].some((character) => {
			const codePoint = character.codePointAt(0);
			return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
		})
	) {
		throw new Error(`${path}: package entry path contains a control character.`);
	}

	const pathWithoutDirectorySuffix = isDirectory ? path.slice(0, -1) : path;
	const segments = pathWithoutDirectorySuffix.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
		throw new Error(`${path}: package entry path contains an unsafe segment.`);
	}
	if (segments.length > packageLimits.max_path_depth) {
		throw new Error(`${path}: package entry path exceeds ${packageLimits.max_path_depth} segments.`);
	}
	if (paths.has(path)) throw new Error(`${path}: duplicate package entry.`);
	paths.add(path);
	const lowercasePath = path.toLowerCase();
	if (lowercasePaths.has(lowercasePath)) throw new Error(`${path}: case-colliding package entry.`);
	lowercasePaths.add(lowercasePath);
}

function checkedAdd(left: number, right: number, label: string) {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new Error(`${label} overflowed.`);
	return result;
}

function asError(value: unknown) {
	return value instanceof Error ? value : new Error(String(value));
}

function boundedErrorMessage(value: unknown) {
	const message = asError(value).message || "Package archive could not be read.";
	return message.length <= 512 ? message : `${message.slice(0, 509)}...`;
}
