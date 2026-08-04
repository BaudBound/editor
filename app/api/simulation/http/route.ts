import { NextResponse } from "next/server";
import {
	executeSimulationHttpRequest,
	readBoundedJsonRequest,
	SimulationHttpError,
	validateSimulationHttpRequest,
} from "@/utils/server/simulation-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
	if (!isSameOriginRequest(request)) {
		return NextResponse.json(
			{ code: "ORIGIN_BLOCKED", message: "Cross-origin simulation requests are not allowed." },
			{ status: 403 },
		);
	}
	if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
		return NextResponse.json(
			{ code: "INVALID_CONTENT_TYPE", message: "Simulation requests must use JSON." },
			{ status: 415 },
		);
	}

	try {
		const value = await readBoundedJsonRequest(request);
		const simulationRequest = validateSimulationHttpRequest(value);
		const response = await executeSimulationHttpRequest(simulationRequest, request.signal);
		return NextResponse.json(response, { status: 200 });
	} catch (error) {
		const known = error instanceof SimulationHttpError;
		return NextResponse.json(
			{
				code: known ? error.code : "HTTP_REQUEST_FAILED",
				message: known ? error.message : "Simulation HTTP request failed.",
			},
			{ status: known ? 400 : 502 },
		);
	}
}

function isSameOriginRequest(request: Request) {
	const requestUrl = new URL(request.url);
	const origin = request.headers.get("origin");
	const fetchSite = request.headers.get("sec-fetch-site");
	return origin === requestUrl.origin && (!fetchSite || fetchSite === "same-origin");
}
