import { track } from "@vercel/analytics/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const {
      amount,
      meta,
      recipientResolution,
      sourceChainId,
      targetChainId,
    } = await request.json();

    await track("bridge", {
      amount,
      meta,
      recipientResolution,
      sourceChainId,
      targetChainId,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
