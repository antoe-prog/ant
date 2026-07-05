import { PaymentCheckoutScreen } from "@/components/screens/payment-checkout-screen";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function PaymentCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ method?: string | string[] | undefined; paymentId?: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  return <PaymentCheckoutScreen initialPaymentMethod={firstParam(params.method)} paymentId={firstParam(params.paymentId)} />;
}
