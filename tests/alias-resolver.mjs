import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node's test runner has no bundler, so it cannot see the "@/*" -> "./*"
// mapping declared in tsconfig.json. This hook makes bare "@/..." imports
// resolvable when a test imports a module (directly or transitively) that
// uses the alias, without changing any application source imports.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const candidateSuffixes = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
	if (!specifier.startsWith("@/")) {
		return nextResolve(specifier, context);
	}

	const base = path.join(projectRoot, specifier.slice(2));
	for (const suffix of candidateSuffixes) {
		const candidate = base + suffix;
		if (existsSync(candidate)) {
			return nextResolve(pathToFileURL(candidate).href, context);
		}
	}

	return nextResolve(specifier, context);
}
