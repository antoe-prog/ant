import { LoginScreen } from "@/components/screens/login-screen";
import { userRoles, type UserRole } from "@/lib/domain";

function toInitialRole(value: string | string[] | undefined): UserRole | null {
  const role = Array.isArray(value) ? value[0] : value;

  if (!role) {
    return null;
  }

  return userRoles.includes(role as UserRole) ? (role as UserRole) : null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  return <LoginScreen initialRole={toInitialRole(params.role)} />;
}
