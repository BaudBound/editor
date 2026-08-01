import { NextResponse } from "next/server";

const staticSecurityHeaders = [
	["Cross-Origin-Resource-Policy", "same-origin"],
	["Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()"],
	["Referrer-Policy", "strict-origin-when-cross-origin"],
	["X-Content-Type-Options", "nosniff"],
	["X-Frame-Options", "SAMEORIGIN"],
	["X-Permitted-Cross-Domain-Policies", "none"],
] as const;

function contentSecurityPolicy(): string {
	const scriptSources = ["'self'", "'unsafe-inline'"];
	if (process.env.NODE_ENV !== "production") {
		scriptSources.push("'unsafe-eval'");
	}

	return [
		"default-src 'self'",
		"base-uri 'self'",
		"connect-src 'self' http: https: ws: wss:",
		"font-src 'self' data:",
		"form-action 'self'",
		"frame-ancestors 'self'",
		"frame-src 'self'",
		"img-src 'self' data: blob:",
		"manifest-src 'self'",
		"media-src 'self' data: blob:",
		"object-src 'none'",
		`script-src ${scriptSources.join(" ")}`,
		"style-src 'self' 'unsafe-inline'",
		"worker-src 'self' blob:",
	].join("; ");
}

export function proxy() {
	const response = NextResponse.next();
	response.headers.set("Content-Security-Policy", contentSecurityPolicy());
	for (const [name, value] of staticSecurityHeaders) {
		response.headers.set(name, value);
	}
	if (process.env.NODE_ENV === "production") {
		response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
	}

	return response;
}
