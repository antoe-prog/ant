import type { OnlinePaymentProvider, Payment, PaymentReceipt } from "@/lib/domain";
import { getPaymentRemainingRefundableAmount } from "../lib/payment-amounts.ts";

export type PaymentWebhookEvent = "paid" | "failed" | "refunded";

export type PaymentWebhookBody = {
  amount?: number;
  event?: PaymentWebhookEvent;
  occurredAt?: string;
  providerEventId?: string;
  providerPaymentId?: string;
  reason?: string;
  receiptId?: string;
  receiptUrl?: string;
};

export type OnlinePaymentRuntimeBlocker =
  | "PAYMENT_PROVIDER_NOT_CONFIGURED"
  | "PAYMENT_CHECKOUT_BASE_URL_MISSING"
  | "PAYMENT_CHECKOUT_BASE_URL_INVALID"
  | "PAYMENT_WEBHOOK_SECRET_MISSING";

export type OnlinePaymentRuntimeReadiness = {
  blockers: OnlinePaymentRuntimeBlocker[];
  ok: boolean;
  provider: OnlinePaymentProvider;
};

export const paymentReceiptUrlMaxLength = 2048;

export function isValidPaymentReceiptUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > paymentReceiptUrlMaxLength) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function normalizePaymentCheckoutBaseUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function getOnlinePaymentRuntimeReadiness(env: NodeJS.ProcessEnv = process.env): OnlinePaymentRuntimeReadiness {
  const isProduction = env.NODE_ENV === "production";
  const hasExternalProvider = Boolean(env.FINAL_JUDO_PAYMENT_PROVIDER?.trim());
  const checkoutBaseUrl = env.FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL?.trim();
  const blockers: OnlinePaymentRuntimeBlocker[] = [];

  if (isProduction && !hasExternalProvider) {
    blockers.push("PAYMENT_PROVIDER_NOT_CONFIGURED");
  }

  if (isProduction && hasExternalProvider && !checkoutBaseUrl) {
    blockers.push("PAYMENT_CHECKOUT_BASE_URL_MISSING");
  } else if (checkoutBaseUrl && !normalizePaymentCheckoutBaseUrl(checkoutBaseUrl)) {
    blockers.push("PAYMENT_CHECKOUT_BASE_URL_INVALID");
  }

  if (isProduction && hasExternalProvider && !env.FINAL_JUDO_PAYMENT_WEBHOOK_SECRET?.trim()) {
    blockers.push("PAYMENT_WEBHOOK_SECRET_MISSING");
  }

  return {
    blockers,
    ok: blockers.length === 0,
    provider: hasExternalProvider ? "external" : "mock",
  };
}

export function getOnlinePaymentProvider(env: NodeJS.ProcessEnv = process.env): OnlinePaymentProvider {
  const readiness = getOnlinePaymentRuntimeReadiness(env);

  if (!readiness.ok) {
    throw new Error(`Online payment runtime is not ready: ${readiness.blockers.join(", ")}`);
  }

  return readiness.provider;
}

export function getOnlinePaymentAmount(payment: Payment) {
  return getPaymentRemainingRefundableAmount(payment);
}

export function createProviderPaymentId(paymentId: string) {
  return `fj_${paymentId}_${Date.now()}`;
}

export function createProviderAgreementId(paymentId: string) {
  return `fj_agreement_${paymentId}_${Date.now()}`;
}

export function getBillingDayOfMonth(dateOnly: string) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return 1;
  }

  return Math.min(Math.max(date.getUTCDate(), 1), 28);
}

export function getNextBillingDateFromExpiry(expiresAt: string) {
  const expiryDate = new Date(`${expiresAt}T00:00:00.000Z`);

  if (Number.isNaN(expiryDate.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  expiryDate.setUTCDate(expiryDate.getUTCDate() + 1);
  return expiryDate.toISOString().slice(0, 10);
}

export function createCheckoutUrl(providerPaymentId: string) {
  const configuredBaseUrl = process.env.FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return `/app/payments?checkout=${encodeURIComponent(providerPaymentId)}`;
  }

  const checkoutBaseUrl = normalizePaymentCheckoutBaseUrl(configuredBaseUrl);

  if (!checkoutBaseUrl) {
    throw new Error("PAYMENT_CHECKOUT_BASE_URL_INVALID");
  }

  return `${checkoutBaseUrl}/checkout/${encodeURIComponent(providerPaymentId)}`;
}

export function getWebhookSecret() {
  const configuredSecret = process.env.FINAL_JUDO_PAYMENT_WEBHOOK_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  return process.env.NODE_ENV === "production" ? null : "final-judo-dev-webhook-secret";
}

export function createPaymentReceipt(
  payment: Payment,
  body: PaymentWebhookBody,
  occurredAt: string,
): PaymentReceipt {
  const receiptId = typeof body.receiptId === "string" ? body.receiptId.trim() : "";
  const receiptUrl = typeof body.receiptUrl === "string" ? body.receiptUrl.trim() : "";

  return {
    id: receiptId || `receipt-${payment.id}-${Date.now()}`,
    issuedAt: occurredAt,
    providerPaymentId: payment.onlinePayment?.providerPaymentId ?? body.providerPaymentId ?? payment.id,
    ...(receiptUrl ? { receiptUrl } : {}),
  };
}
