import type { ReactNode } from "react";
import { TransferSpeed, type TransferSpeedValue } from "@/lib/cctp/transferSpeed";
import type { EstimateLabels } from "./utils";

interface BridgeComparisonProps {
  fastTransferSupported: boolean;
  fastLabels: EstimateLabels;
  standardLabels: EstimateLabels;
  renderButton: (speed: TransferSpeedValue, isPrimary: boolean) => ReactNode;
}

export function BridgeComparison({
  fastTransferSupported,
  fastLabels,
  standardLabels,
  renderButton,
}: BridgeComparisonProps) {
  const renderMobileCard = (
    speed: TransferSpeedValue,
    labels: EstimateLabels,
    isPrimary: boolean
  ) => (
    <div className={`rounded-lg p-3 ${isPrimary ? "bg-slate-900/30" : "bg-slate-800/20"}`}>
      <h3 className="text-white text-base font-semibold mb-3">
        {speed === TransferSpeed.FAST ? "Fast Bridge" : "Standard Bridge"}
      </h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Estimate speed</span>
          <span className="text-white">{labels.speedLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Confirmation</span>
          <span className="text-white">{labels.confirmationLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Fee amount</span>
          <span className="text-white">{labels.feeLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">You will receive</span>
          <span className="text-white">{labels.receiveLabel}</span>
        </div>
      </div>
      <div className="mt-3">{renderButton(speed, isPrimary)}</div>
    </div>
  );

  return (
    <div>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left py-1 pr-3 text-slate-400 font-normal text-sm"></th>
              {fastTransferSupported && (
                <th className="text-center py-1 px-3">
                  <span className="text-white text-sm font-semibold">Fast Bridge</span>
                </th>
              )}
              <th className="text-center py-1 px-3">
                <span className="text-white text-sm font-semibold">Standard Bridge</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-800">
              <td className="py-1 pr-3 text-slate-400 text-sm">Estimate speed</td>
              {fastTransferSupported && (
                <td className="py-1 px-3 text-center text-white text-sm">{fastLabels.speedLabel}</td>
              )}
              <td className="py-1 px-3 text-center text-white text-sm">{standardLabels.speedLabel}</td>
            </tr>
            <tr className="border-b border-slate-800">
              <td className="py-1 pr-3 text-slate-400 text-sm">Confirmation</td>
              {fastTransferSupported && (
                <td className="py-1 px-3 text-center text-white text-sm">{fastLabels.confirmationLabel}</td>
              )}
              <td className="py-1 px-3 text-center text-white text-sm">{standardLabels.confirmationLabel}</td>
            </tr>
            <tr className="border-b border-slate-800">
              <td className="py-1 pr-3 text-slate-400 text-sm">Fee amount</td>
              {fastTransferSupported && (
                <td className="py-1 px-3 text-center text-white text-sm">{fastLabels.feeLabel}</td>
              )}
              <td className="py-1 px-3 text-center text-white text-sm">{standardLabels.feeLabel}</td>
            </tr>
            <tr className="border-b border-slate-800">
              <td className="py-1 pr-3 text-slate-400 text-sm">You will receive</td>
              {fastTransferSupported && (
                <td className="py-1 px-3 text-center text-white text-sm">{fastLabels.receiveLabel}</td>
              )}
              <td className="py-1 px-3 text-center text-white text-sm">{standardLabels.receiveLabel}</td>
            </tr>
            <tr>
              <td className="pt-2 pr-3"></td>
              {fastTransferSupported && (
                <td className="pt-2 px-3">{renderButton(TransferSpeed.FAST, true)}</td>
              )}
              <td className="pt-2 px-3">{renderButton(TransferSpeed.SLOW, !fastTransferSupported)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-4">
        {fastTransferSupported && renderMobileCard(TransferSpeed.FAST, fastLabels, true)}
        {renderMobileCard(TransferSpeed.SLOW, standardLabels, !fastTransferSupported)}
      </div>
    </div>
  );
}
