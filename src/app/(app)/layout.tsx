import { ProtectedRoute } from "@/components/routing/protected-route";
import { AppShell } from "@/components/shell/app-shell";

export default function ProtectedAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
