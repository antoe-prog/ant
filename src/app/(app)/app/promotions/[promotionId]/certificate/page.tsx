import { PromotionCertificateScreen } from "@/components/screens/promotion-certificate-screen";

export default async function PromotionCertificatePage({ params }: { params: Promise<{ promotionId: string }> }) {
  const { promotionId } = await params;

  return <PromotionCertificateScreen promotionId={promotionId} />;
}
