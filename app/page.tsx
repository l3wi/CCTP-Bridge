import { Suspense } from "react";
import HomeClientPage from "./home-client";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeClientPage />
    </Suspense>
  );
}
