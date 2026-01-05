"use client";

import AnimatedBackground from "@/components/animated-bg";

export default function Home() {
  return (
    <AnimatedBackground>
      <div className="w-full max-w-xl pt-5">
        {/* Floating Header */}
        <div className="mb-4">
          <h1 className="relative inline-block text-4xl font-bold text-white pb-2 ">
            CCTP Bridge
            <span className="block absolute text-xs text-blue-500 -top-[7px] -right-[70px] transform rotate-15 bg-slate-800/50 px-2 py-1 rounded-md">
              {`Now with Solana!`}
            </span>
          </h1>

          <div className="text-xs text-slate-500">
            {`A native USDC bridge powered by Circle's CCTP infrastructure.`}
          </div>
        </div>
      </div>
    </AnimatedBackground>
  );
}
