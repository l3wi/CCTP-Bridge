"use client";
import { InputCard } from "./inputCard";
import { LocalTransaction } from "@/lib/types";
import History from "./history";
import { useState } from "react";
import { Label } from "@radix-ui/react-label";
import { Button } from "./ui/button";
import { ClaimCard } from "./claimCard";
import { useTransactionStore } from "@/lib/store/transactionStore";

export default function ContentWrapper() {
  const [isClaim, setClaim] = useState(false);

  return (
    <>
      <div className="flex flex-col justify-between items-center px-10 pb-10 lg:pt-20 lg:flex-row gap-10">
        <div className="relative flex flex-col items-center justify-center max-w-xl w-full h-full lg:pr-24">
          <div className="flex flex-col items-start space-y-8">
            <div className="relative">
              <h1 className="text-5xl font-extrabold leading-tight text-gray-100 sm:text-4xl md:text-5xl">
                Bridge USDC without extra fees.
              </h1>
            </div>

            <p
              data-primary="blue-700"
              className="text-md text-blue-300 inline-block"
            >
              {`Bridge your USDC via Circle's CCTP bridge. Interact with the bridge directly instead of using a relaying service.`}
            </p>
            <a
              href="https://developers.circle.com/stablecoin/docs/cctp-getting-started"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-5 text-xl inline-block  font-medium tracking-wide text-center text-blue-500 transition duration-200 bg-white rounded-lg hover:bg-gray-100 ease"
            >
              Learn More
            </a>
          </div>
        </div>

        <div className="relative flex flex-col items-start justify-start p-6 lg:p-10 bg-white shadow-2xl rounded-xl min-h-[380px] w-full max-w-xl">
          {!isClaim ? (
            <>
              <div className="flex w-full justify-between items-center">
                <h3 className="text-2xl font-bold text-gray-600">
                  Start Bridging
                </h3>
                <Button
                  className="text-sm"
                  variant="outline"
                  onClick={() => setClaim(!isClaim)}
                >
                  {"Manually Claim"}
                </Button>
              </div>

              <h3 className="text-sm text-gray-400 pt-2">
                Send one transaction to burn the USDC. Then another to mint it
                on the destination chain.
              </h3>
              <InputCard onBurn={setClaim} />
            </>
          ) : (
            <>
              <div className="flex w-full justify-between items-center">
                <h3 className="text-2xl font-bold text-gray-600">
                  Finish Bridging
                </h3>
                <Label className="text-sm" onClick={() => setClaim(!isClaim)}>
                  {"New TX"}
                </Label>
              </div>

              <h3 className="text-sm text-gray-400 pt-2">
                {`Enter burn transaction hash to claim USDC & originchain to finalize transaction.`}
              </h3>
              <ClaimCard onBurn={setClaim} />
            </>
          )}
        </div>
      </div>
      <div className="relative z-10 w-full space-y-8 px-10">
        <div className="flex flex-col items-start justify-start p-6 lg:p-10 bg-white shadow-2xl rounded-xl min-h-[380px]">
          <History />
        </div>
      </div>
    </>
  );
}
