import type {
  FamilyPaymentRequest,
  OnlinePaymentRequest,
  Payment,
  PaymentRecurringAgreement,
} from "./domain.ts";

export function createFamilySafeCollectionRequest(
  collectionRequest: FamilyPaymentRequest,
  viewerUserId: string,
): FamilyPaymentRequest {
  const requestedByViewer = collectionRequest.requestedByUserId === viewerUserId;

  return {
    ...collectionRequest,
    id: "",
    payerName: requestedByViewer ? collectionRequest.payerName : "다른 보호자",
    payerPhone: requestedByViewer ? collectionRequest.payerPhone : "",
    requestedByUserId: "",
  };
}

export function createFamilySafeOnlinePayment(onlinePayment: OnlinePaymentRequest): OnlinePaymentRequest {
  return {
    ...onlinePayment,
    processedWebhookEventIds: [],
    providerPaymentId: "",
    receipt: onlinePayment.receipt
      ? { ...onlinePayment.receipt, id: "", providerPaymentId: "" }
      : undefined,
    requestedByUserId: "",
  };
}

export function createFamilySafeRecurringAgreement(
  recurringAgreement: PaymentRecurringAgreement,
): PaymentRecurringAgreement {
  return {
    ...recurringAgreement,
    providerAgreementId: "",
    requestedByUserId: "",
  };
}

export function createFamilySafePayment(payment: Payment, viewerUserId: string): Payment {
  const collectionRequest = payment.collectionRequest;
  const onlinePayment = payment.onlinePayment;
  const recurringAgreement = payment.recurringAgreement;

  return {
    ...payment,
    collectionRequest: collectionRequest
      ? createFamilySafeCollectionRequest(collectionRequest, viewerUserId)
      : undefined,
    onlinePayment: onlinePayment ? createFamilySafeOnlinePayment(onlinePayment) : undefined,
    recurringAgreement: recurringAgreement
      ? createFamilySafeRecurringAgreement(recurringAgreement)
      : undefined,
    statusHistory: [],
  };
}
