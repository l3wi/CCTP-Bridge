import { track } from "@vercel/analytics/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const {
      amount,
      meta,
      sourceWallet,
      displayedRecipient,
      submittedRecipient,
      recipientResolution,
      sourceChainId,
      targetChainId,
    } = await request.json();

    await track("bridge", {
      amount,
      meta,
      sourceWallet,
      displayedRecipient,
      submittedRecipient,
      recipientResolution,
      sourceChainId,
      targetChainId,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
