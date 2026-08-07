import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node's test runner has no bundler, so it cannot see the "@/*" -> "./*"
// mapping declared in tsconfig.json. This hook makes bare "@/..." imports
// resolvable when a test imports a module (directly or transitively) that
// uses the alias, without changing any application source imports.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const candidateSuffixes = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith("@/")) {
		return resolveAgainstBase(path.join(projectRoot, specifier.slice(2)), specifier, context, nextResolve);
	}

	// Application source imports extensionless relative specifiers everywhere
	// (bundler-style resolution). Node's own ESM resolver requires an explicit
	// extension, so a plain relative import that transitively reaches this test
	// runner otherwise fails with ERR_MODULE_NOT_FOUND. Resolve those the same
	// way the "@/..." alias is resolved above, without touching source imports.
	if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
		const parentPath = fileURLToPath(context.parentURL);
		const base = path.join(path.dirname(parentPath), specifier);
		return resolveAgainstBase(base, specifier, context, nextResolve);
	}

	return nextResolve(specifier, context);
}

async function resolveAgainstBase(base, specifier, context, nextResolve) {
	for (const suffix of candidateSuffixes) {
		const candidate = base + suffix;
		if (existsSync(candidate)) {
			return nextResolve(pathToFileURL(candidate).href, context);
		}
	}

	return nextResolve(specifier, context);
}

// Application source imports ".json" files with no "with { type: 'json' }"
// clause, relying on the bundler's built-in JSON support. Plain Node ESM
// requires that import attribute, and it can only be satisfied at the load
// step (a resolve hook can't add it retroactively), so JSON is loaded
// directly here instead of deferring to the default loader's stricter check.
export async function load(url, context, nextLoad) {
	if (url.startsWith("file:") && url.endsWith(".json")) {
		return { format: "json", shortCircuit: true, source: readFileSync(fileURLToPath(url), "utf8") };
	}

	return nextLoad(url, context);
}
