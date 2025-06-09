import { Skeleton } from "../ui/skeleton";
import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";

export const InputCardSkeleton = () => (
  <div className="w-full space-y-4">
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <div className="flex space-x-2">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-16" />
      </div>
    </div>
    <Skeleton className="h-10 w-full" />
  </div>
);

export const HistoryTableSkeleton = () => (
  <div className="space-y-3">
    <div className="flex justify-between">
      <Skeleton className="h-5 w-16" />
      <Skeleton className="h-5 w-20" />
    </div>
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="grid grid-cols-4 gap-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ))}
    </div>
  </div>
);

export const BalanceLoader = ({ className }: { className?: string }) => (
  <div className={className}>
    <Skeleton className="h-4 w-24" />
  </div>
);

export const ChainSelectorSkeleton = () => (
  <div className="space-y-2">
    <Skeleton className="h-4 w-32" />
    <Skeleton className="h-10 w-full" />
  </div>
);

interface LoadingButtonProps {
  children: React.ReactNode;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
}

export const LoadingButton = ({
  children,
  isLoading = false,
  disabled = false,
  className,
  onClick,
  variant = "default",
}: LoadingButtonProps) => (
  <Button
    variant={variant}
    className={className}
    disabled={disabled || isLoading}
    onClick={onClick}
  >
    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
    {children}
  </Button>
);

interface TransactionStatusProps {
  status: "pending" | "success" | "error" | "idle";
  message?: string;
}

export const TransactionStatus = ({
  status,
  message,
}: TransactionStatusProps) => {
  const getStatusContent = () => {
    switch (status) {
      case "pending":
        return (
          <div className="flex items-center space-x-2 text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{message || "Transaction pending..."}</span>
          </div>
        );
      case "success":
        return (
          <div className="text-green-600">
            ✓ {message || "Transaction successful"}
          </div>
        );
      case "error":
        return (
          <div className="text-red-600">
            ✗ {message || "Transaction failed"}
          </div>
        );
      default:
        return null;
    }
  };

  return <div className="text-sm">{getStatusContent()}</div>;
};

export const AttestationLoader = ({ className }: { className?: string }) => (
  <div className={`flex items-center space-x-2 ${className}`}>
    <Loader2 className="h-4 w-4 animate-spin" />
    <span className="text-sm text-gray-600">Waiting for attestation...</span>
  </div>
);

export const FormFieldSkeleton = () => (
  <div className="space-y-2">
    <Skeleton className="h-4 w-20" />
    <Skeleton className="h-10 w-full" />
  </div>
);
