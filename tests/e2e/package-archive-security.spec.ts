import { writeFileSync } from "node:fs";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import JSZip from "jszip";
import packageLimits from "../../contracts/package-limits.json";
import { readArchiveWithWorker } from "../../utils/package-archive-worker-client";

test("package import rejects excessive actual archive expansion", async ({ page }, testInfo) => {
	const zip = new JSZip();
	zip.file("assets/compressed.bin", new Uint8Array(2 * 1024 * 1024));
	const bytes = await zip.generateAsync({
		compression: "DEFLATE",
		compressionOptions: { level: 9 },
		type: "nodebuffer",
	});

	await expectPackageReadFailure(page, testInfo, "expansion.bbs", bytes, /archive expansion exceeds 200:1/i);
});

test("package import rejects paths deeper than the shared contract", async ({ page }, testInfo) => {
	const zip = new JSZip();
	const path = `${Array.from({ length: packageLimits.max_path_depth }, (_, index) => `level${index}`).join("/")}/file`;
	zip.file(path, "data");

	await expectPackageReadFailure(
		page,
		testInfo,
		"deep-path.bbs",
		await zip.generateAsync({ type: "nodebuffer" }),
		new RegExp(`exceeds ${packageLimits.max_path_depth} segments`, "i"),
	);
});

test("package import rejects entry paths longer than the shared byte limit", async ({ page }, testInfo) => {
	const zip = new JSZip();
	zip.file("a".repeat(packageLimits.max_path_bytes + 1), "data");

	await expectPackageReadFailure(
		page,
		testInfo,
		"long-path.bbs",
		await zip.generateAsync({ compression: "STORE", type: "nodebuffer" }),
		new RegExp(`path exceeds ${packageLimits.max_path_bytes} UTF-8 bytes`, "i"),
	);
});

test("package import rejects case-colliding entry names", async ({ page }, testInfo) => {
	const zip = new JSZip();
	zip.file("assets/Name.txt", "first");
	zip.file("assets/name.txt", "second");

	await expectPackageReadFailure(
		page,
		testInfo,
		"case-collision.bbs",
		await zip.generateAsync({ type: "nodebuffer" }),
		/case-colliding package entry/i,
	);
});

test("package import rejects exact duplicate entry names", async ({ page }, testInfo) => {
	const zip = new JSZip();
	zip.file("entry-a", "first");
	zip.file("entry-b", "second");
	const bytes = Buffer.from(await zip.generateAsync({ compression: "STORE", type: "nodebuffer" }));
	const replacements = replaceAllBytes(bytes, Buffer.from("entry-b"), Buffer.from("entry-a"));
	expect(replacements).toBe(2);

	await expectPackageReadFailure(page, testInfo, "duplicate.bbs", bytes, /duplicate package entry/i);
});

test("package import enforces actual bytes when ZIP metadata underreports an entry", async ({ page }, testInfo) => {
	const zip = new JSZip();
	const path = "program.json";
	zip.file(path, Buffer.alloc(packageLimits.max_metadata_bytes + 1, 0x61));
	const bytes = Buffer.from(await zip.generateAsync({ compression: "STORE", type: "nodebuffer" }));
	patchAdvertisedUncompressedSize(bytes, path, 1);

	await expectPackageReadFailure(
		page,
		testInfo,
		"underreported-size.bbs",
		bytes,
		new RegExp(
			`size exceeds the maximum of ${packageLimits.max_metadata_bytes} bytes|expanded size exceeds its central directory size`,
			"i",
		),
	);
});

test("package import rejects excessive entry counts", async ({ page }, testInfo) => {
	const zip = new JSZip();
	for (let index = 0; index <= packageLimits.max_entry_count; index += 1) {
		zip.file(`entry-${index}`, "");
	}

	await expectPackageReadFailure(
		page,
		testInfo,
		"too-many-entries.bbs",
		await zip.generateAsync({ compression: "STORE", type: "nodebuffer" }),
		new RegExp(`more than ${packageLimits.max_entry_count} entries`, "i"),
	);
});

test("package import rejects a truncated central directory", async ({ page }, testInfo) => {
	const zip = new JSZip();
	zip.file("manifest.json", "{}");
	const complete = await zip.generateAsync({ type: "nodebuffer" });
	const truncated = complete.subarray(0, complete.length - 12);

	await expectPackageReadFailure(
		page,
		testInfo,
		"truncated.bbs",
		truncated,
		/(invalid zip|archive ended|central directory|could not be read)/i,
	);
});

test("package validation and extraction keep the editor event loop responsive", async ({ page }, testInfo) => {
	const zip = new JSZip();
	for (let index = 0; index < 500; index += 1) {
		zip.file(`assets/responsiveness-${index}.bin`, Buffer.alloc(32 * 1024, index % 251));
	}
	const packagePath = testInfo.outputPath("responsive-import.bbs");
	writeFileSync(packagePath, await zip.generateAsync({ compression: "STORE", type: "nodebuffer" }));

	await page.goto("/");
	await page.evaluate(() => {
		type ArchiveHeartbeatWindow = Window & {
			__baudboundArchiveHeartbeat?: { complete: boolean; frames: number };
		};
		const currentWindow = window as ArchiveHeartbeatWindow;
		const input = document.querySelector<HTMLInputElement>('input[type="file"]');
		if (!input) throw new Error("Package input was not found.");

		input.addEventListener(
			"change",
			() => {
				const heartbeat = { complete: false, frames: 0 };
				currentWindow.__baudboundArchiveHeartbeat = heartbeat;
				const observer = new MutationObserver(() => {
					const rejected = [...document.querySelectorAll("h1, h2, h3")].some(
						(element) => element.textContent?.trim() === "Import Rejected",
					);
					if (rejected) {
						heartbeat.complete = true;
						observer.disconnect();
					}
				});
				observer.observe(document.body, { childList: true, subtree: true });
				const tick = () => {
					if (heartbeat.complete) return;
					heartbeat.frames += 1;
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			},
			{ capture: true, once: true },
		);
	});

	await page.locator('input[type="file"]').setInputFiles(packagePath);
	await expect(page.getByRole("heading", { name: "Import Rejected" })).toBeVisible();
	const frames = await page.evaluate(() => {
		type ArchiveHeartbeatWindow = Window & {
			__baudboundArchiveHeartbeat?: { complete: boolean; frames: number };
		};
		return (window as ArchiveHeartbeatWindow).__baudboundArchiveHeartbeat?.frames ?? 0;
	});
	expect(frames).toBeGreaterThan(1);
});

test("package worker cancellation terminates the owned worker", async () => {
	const workers = new ControlledPackageWorkers();
	const controller = new AbortController();
	const pending = readArchiveWithWorker({ size: 1 } as File, workers.create, controller.signal);
	expect(workers.instances).toHaveLength(1);

	controller.abort();
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	expect(workers.instances[0].terminateCount).toBe(1);
});

test("concurrent package reads keep worker ownership and completion isolated", async () => {
	const workers = new ControlledPackageWorkers();
	const firstController = new AbortController();
	const first = readArchiveWithWorker({ size: 1 } as File, workers.create, firstController.signal);
	const second = readArchiveWithWorker({ size: 1 } as File, workers.create);
	expect(workers.instances).toHaveLength(2);

	firstController.abort();
	workers.instances[1].succeed([{ bytes: new TextEncoder().encode("{}").buffer, path: "manifest.json" }]);

	await expect(first).rejects.toMatchObject({ name: "AbortError" });
	const archive = await second;
	expect(archive.fileNames).toEqual(["manifest.json"]);
	expect(workers.instances.map((worker) => worker.terminateCount)).toEqual([1, 1]);
});

async function expectPackageReadFailure(
	page: Page,
	testInfo: TestInfo,
	fileName: string,
	bytes: Uint8Array,
	message: RegExp,
) {
	const packagePath = testInfo.outputPath(fileName);
	writeFileSync(packagePath, bytes);
	await page.goto("/");
	await page.locator('input[type="file"]').setInputFiles(packagePath);

	await expect(page.getByRole("heading", { name: "Import Rejected" })).toBeVisible();
	await expect(page.getByText(message).first()).toBeVisible();
	await expect(page.getByText("Package Read")).toBeVisible();
}

function replaceAllBytes(bytes: Buffer, search: Buffer, replacement: Buffer) {
	if (search.length !== replacement.length) throw new Error("ZIP test replacements must preserve byte length.");
	let replacements = 0;
	let offset = 0;
	while (true) {
		const index = bytes.indexOf(search, offset);
		if (index < 0) return replacements;
		replacement.copy(bytes, index);
		replacements += 1;
		offset = index + replacement.length;
	}
}

function patchAdvertisedUncompressedSize(bytes: Buffer, path: string, size: number) {
	const name = Buffer.from(path);
	let localHeaders = 0;
	let centralHeaders = 0;
	let offset = 0;
	while (true) {
		const nameOffset = bytes.indexOf(name, offset);
		if (nameOffset < 0) break;
		if (nameOffset >= 30 && bytes.readUInt32LE(nameOffset - 30) === 0x04034b50) {
			bytes.writeUInt32LE(size, nameOffset - 8);
			localHeaders += 1;
		}
		if (nameOffset >= 46 && bytes.readUInt32LE(nameOffset - 46) === 0x02014b50) {
			bytes.writeUInt32LE(size, nameOffset - 22);
			centralHeaders += 1;
		}
		offset = nameOffset + name.length;
	}
	if (localHeaders !== 1 || centralHeaders !== 1) {
		throw new Error(`Expected one local and central ZIP header for ${path}.`);
	}
}

class ControlledPackageWorker {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	terminateCount = 0;

	postMessage() {}

	terminate() {
		this.terminateCount += 1;
	}

	succeed(entries: Array<{ bytes: ArrayBuffer; path: string }>) {
		this.onmessage?.({ data: { entries, ok: true } } as MessageEvent);
	}
}

class ControlledPackageWorkers {
	readonly instances: ControlledPackageWorker[] = [];

	readonly create = () => {
		const worker = new ControlledPackageWorker();
		this.instances.push(worker);
		return worker as unknown as Worker;
	};
}
