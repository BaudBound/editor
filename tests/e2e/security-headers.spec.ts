import { expect, test } from "@playwright/test";

test("serves the editor with production browser security headers", async ({ request }) => {
	const response = await request.get("/");
	expect(response.ok()).toBe(true);

	const headers = response.headers();
	expect(headers["content-security-policy"]).toContain("default-src 'self'");
	expect(headers["content-security-policy"]).toContain("connect-src 'self' http: https: ws: wss:");
	expect(headers["content-security-policy"]).toContain("object-src 'none'");
	expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
	expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
	expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
	expect(headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
	expect(headers["x-content-type-options"]).toBe("nosniff");
	expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
});
