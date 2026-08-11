import { ClientRedirect } from "@/components/routing/client-redirect";

export default function Home() {
  return <ClientRedirect href="/app/dashboard" />;
}
