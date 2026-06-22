import { track } from "@vercel/analytics/server";
import { NextResponse } from "next/server";
import {
  BRIDGE_BURN_EVENT_NAME,
  BridgeBurnEventValidationError,
  buildBridgeBurnEventPayload,
  type BridgeBurnEventInput,
} from "@/lib/analytics/bridgeBurnEvent";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS === "1") {
    return new NextResponse(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const payload = buildBridgeBurnEventPayload(body as BridgeBurnEventInput);
    await track(BRIDGE_BURN_EVENT_NAME, { id: payload.id, m: payload.m });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    if (error instanceof BridgeBurnEventValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.warn("[analytics] bridge burn event tracking failed:", error);
    return NextResponse.json({ error: "Failed to track bridge burn event" }, { status: 502 });
  }
}
