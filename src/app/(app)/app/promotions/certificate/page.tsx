"use client";

import { useSyncExternalStore } from "react";
import { PromotionCertificateScreen } from "@/components/screens/promotion-certificate-screen";

function subscribeLocationSearch() {
  return () => undefined;
}

function getLocationSearch() {
  return window.location.search;
}

function getServerLocationSearch() {
  return "";
}

export default function PromotionCertificateQueryPage() {
  const locationSearch = useSyncExternalStore(subscribeLocationSearch, getLocationSearch, getServerLocationSearch);
  const promotionId = new URLSearchParams(locationSearch).get("promotionId") ?? "";

  return <PromotionCertificateScreen promotionId={promotionId} />;
}
