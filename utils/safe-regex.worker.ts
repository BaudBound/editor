/// <reference lib="webworker" />

import { executeSafeRegex, type SafeRegexRequest } from "./safe-regex-engine";

self.onmessage = (event: MessageEvent<SafeRegexRequest>) => {
	try {
		self.postMessage({ ok: true, result: executeSafeRegex(event.data) });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Regular expression execution failed.";
		self.postMessage({ message: message.length <= 512 ? message : `${message.slice(0, 509)}...`, ok: false });
	}
};
