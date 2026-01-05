import { Skeleton } from "../ui/skeleton";
import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";

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
