import { Suspense } from "react";
import BridgeAddPageClient from "./bridge-add-page-client";

export default function BridgeAddPage() {
  return (
    <Suspense fallback={null}>
      <BridgeAddPageClient />
    </Suspense>
  );
}
