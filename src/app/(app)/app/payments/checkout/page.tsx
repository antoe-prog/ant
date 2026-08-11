"use client";

import { useSyncExternalStore } from "react";
import { PaymentCheckoutScreen } from "@/components/screens/payment-checkout-screen";

function subscribeLocationSearch() {
  return () => undefined;
}

function getLocationSearch() {
  return window.location.search;
}

function getServerLocationSearch() {
  return "";
}

export default function PaymentCheckoutPage() {
  const locationSearch = useSyncExternalStore(subscribeLocationSearch, getLocationSearch, getServerLocationSearch);
  const params = new URLSearchParams(locationSearch);

  return <PaymentCheckoutScreen initialPaymentMethod={params.get("method") ?? ""} paymentId={params.get("paymentId") ?? ""} />;
}
