"use client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, Clock, DollarSign, Zap, Shield } from "lucide-react";
import Image from "next/image";
import { formatUnits } from "viem";
import { BridgeSummaryState } from "@/lib/types";
import { isV2Supported } from "@/constants/contracts";
import { blockConfirmations } from "@/constants/endpoints";
import { useState, useEffect } from "react";

interface BridgeSummaryProps {
  summary: BridgeSummaryState;
  onConfirm: (version: 'v1' | 'v2', transferType: 'standard' | 'fast') => void;
  onBack: () => void;
  isLoading?: boolean;
}

export function BridgeSummary({ 
  summary, 
  onConfirm, 
  onBack, 
  isLoading = false 
}: BridgeSummaryProps) {
  const [selectedVersion, setSelectedVersion] = useState<'v1' | 'v2'>(summary.version);
  const [selectedTransferType, setSelectedTransferType] = useState<'standard' | 'fast'>(summary.transferType);
  
  const isV2Available = isV2Supported(summary.sourceChain.id) && isV2Supported(summary.targetChain.id);
  
  // Reset to V1 if V2 is not available
  useEffect(() => {
    if (!isV2Available && selectedVersion === 'v2') {
      setSelectedVersion('v1');
      setSelectedTransferType('standard');
    }
  }, [isV2Available, selectedVersion]);

  const getEstimatedTime = (version: 'v1' | 'v2', transferType: 'standard' | 'fast') => {
    if (version === 'v2' && transferType === 'fast') {
      return blockConfirmations.fast[summary.sourceChain.id]?.time || '~8-20 seconds';
    }
    return blockConfirmations.standard[summary.sourceChain.id]?.time || '13-19 minutes';
  };

  const getFee = (version: 'v1' | 'v2', transferType: 'standard' | 'fast') => {
    if (version === 'v2' && transferType === 'fast') {
      return summary.fee; // This would come from API call
    }
    return 'Free';
  };

  const currentEstimatedTime = getEstimatedTime(selectedVersion, selectedTransferType);
  const currentFee = getFee(selectedVersion, selectedTransferType);

  return (
    <Card className="w-full max-w-lg mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Bridge Summary</span>
          <Badge variant={selectedVersion === 'v2' ? 'default' : 'secondary'}>
            CCTP {selectedVersion.toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Route Summary */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center space-x-3">
            <Image
              src={`/${summary.sourceChain.id}.svg`}
              width={32}
              height={32}
              alt={summary.sourceChain.name}
              className="w-8 h-8"
            />
            <div>
              <p className="font-medium text-sm">{summary.sourceChain.name}</p>
              <p className="text-xs text-gray-500">{summary.amount.str} USDC</p>
            </div>
          </div>
          
          <ArrowRight className="w-5 h-5 text-gray-400" />
          
          <div className="flex items-center space-x-3">
            <Image
              src={`/${summary.targetChain.id}.svg`}
              width={32}
              height={32}
              alt={summary.targetChain.name}
              className="w-8 h-8"
            />
            <div>
              <p className="font-medium text-sm">{summary.targetChain.name}</p>
              <p className="text-xs text-gray-500">
                {summary.targetAddress.slice(0, 6)}...{summary.targetAddress.slice(-4)}
              </p>
            </div>
          </div>
        </div>

        {/* Version Selection */}
        {isV2Available && (
          <>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Select Bridge Version</Label>
              <RadioGroup 
                value={selectedVersion} 
                onValueChange={(value: 'v1' | 'v2') => {
                  setSelectedVersion(value);
                  if (value === 'v1') {
                    setSelectedTransferType('standard');
                  }
                }}
                className="space-y-2"
              >
                <div className="flex items-start space-x-3 p-3 border rounded-lg">
                  <RadioGroupItem value="v1" id="v1" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="v1" className="flex items-center space-x-2 cursor-pointer">
                      <Shield className="w-4 h-4" />
                      <span className="font-medium">CCTP V1 (Standard)</span>
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      Proven reliability, free transfers, longer confirmation time
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3 p-3 border rounded-lg">
                  <RadioGroupItem value="v2" id="v2" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="v2" className="flex items-center space-x-2 cursor-pointer">
                      <Zap className="w-4 h-4" />
                      <span className="font-medium">CCTP V2 (Fast + Standard)</span>
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      New features with fast transfers available (fees apply)
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Transfer Type Selection for V2 */}
            {selectedVersion === 'v2' && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Transfer Speed</Label>
                <RadioGroup 
                  value={selectedTransferType} 
                  onValueChange={(value: 'standard' | 'fast') => setSelectedTransferType(value)}
                  className="space-y-2"
                >
                  <div className="flex items-start space-x-3 p-3 border rounded-lg">
                    <RadioGroupItem value="standard" id="standard" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="standard" className="flex items-center space-x-2 cursor-pointer">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">Standard Transfer</span>
                        <Badge variant="secondary" className="text-xs">Free</Badge>
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">13-19 minutes</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3 p-3 border rounded-lg">
                    <RadioGroupItem value="fast" id="fast" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="fast" className="flex items-center space-x-2 cursor-pointer">
                        <Zap className="w-4 h-4" />
                        <span className="font-medium">Fast Transfer</span>
                        <Badge variant="default" className="text-xs">Premium</Badge>
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">8-20 seconds</p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}
            
            <Separator />
          </>
        )}

        {/* Transaction Details */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-sm">Estimated Time</span>
            </div>
            <span className="text-sm font-medium">{currentEstimatedTime}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-gray-500" />
              <span className="text-sm">Bridge Fee</span>
            </div>
            <span className="text-sm font-medium">{currentFee}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm">You will receive</span>
            <span className="text-sm font-medium">{summary.amount.str} USDC</span>
          </div>
        </div>

        <Separator />

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <Button 
            variant="outline" 
            onClick={onBack}
            disabled={isLoading}
            className="flex-1"
          >
            Back
          </Button>
          <Button 
            onClick={() => onConfirm(selectedVersion, selectedTransferType)}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? "Processing..." : `Confirm Bridge`}
          </Button>
        </div>

        {/* Disclaimer */}
        <div className="text-xs text-gray-500 text-center p-3 bg-gray-50 rounded-lg">
          {selectedVersion === 'v2' && selectedTransferType === 'fast' 
            ? "Fast transfers use CCTP V2 and include additional fees for faster processing."
            : "This transaction will be processed using Circle's Cross-Chain Transfer Protocol."
          }
        </div>
      </CardContent>
    </Card>
  );
}