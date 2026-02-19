import { track } from "@vercel/analytics/server";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_RECIPIENT_RESOLUTION = new Set([
  "connected_target_wallet",
  "manual_input",
  "source_wallet_default",
]);

export async function POST(request: NextRequest) {
  try {
    const {
      amount,
      meta,
      recipientResolution,
      sourceChainId,
      targetChainId,
    } = await request.json();

    const normalizedRecipientResolution =
      typeof recipientResolution === "string" &&
      ALLOWED_RECIPIENT_RESOLUTION.has(recipientResolution)
        ? recipientResolution
        : "unknown";

    await track("bridge", {
      amount,
      meta,
      recipientResolution: normalizedRecipientResolution,
      sourceChainId,
      targetChainId,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
