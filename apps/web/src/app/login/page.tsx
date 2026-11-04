import { headers } from "next/headers";
import { isTenantHost } from "@/lib/tenant/host";
import LoginForm from "./login-form";

// On a tenant subdomain the host already names the company (D21).
export default async function LoginPage() {
  const host = (await headers()).get("host");
  return <LoginForm showCompanyCode={!isTenantHost(host)} />;
}
