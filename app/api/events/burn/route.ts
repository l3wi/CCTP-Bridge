import { after, NextResponse } from "next/server";
import {
  BridgeBurnEventValidationError,
  buildBridgeBurnEventPayload,
  parseBridgeBurnEventMetadata,
  type BridgeBurnEventInput,
} from "@/lib/analytics/bridgeBurnEvent";
import { recordBridgeBurnSubmission } from "@/lib/db/bridgeBurnSubmissions";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const input = body as BridgeBurnEventInput;
    const payload = buildBridgeBurnEventPayload(input);
    const metadata = parseBridgeBurnEventMetadata(payload.m);
    after(async () => {
      try {
        await recordBridgeBurnSubmission({
          eventId: payload.id,
          metadata,
          fromAddress: input.fromAddress.trim(),
          toAddress: input.toAddress.trim(),
          appFeeBps: input.appFeeBps,
        });
      } catch (error) {
        console.warn("[db] bridge burn recording failed:", error);
      }
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    if (error instanceof BridgeBurnEventValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.warn("[analytics] bridge burn event tracking failed:", error);
    return NextResponse.json({ error: "Failed to track bridge burn event" }, { status: 502 });
  }
}
