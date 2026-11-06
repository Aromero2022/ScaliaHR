import { headers } from "next/headers";
import { demoLoginHint } from "@/lib/auth/demo-hint";
import { isTenantHost } from "@/lib/tenant/host";
import LoginForm from "./login-form";

// On a tenant subdomain the host already names the company (D21). Demo
// credentials appear only on a local stack that sets them (D41).
export default async function LoginPage() {
  const host = (await headers()).get("host");
  return <LoginForm showCompanyCode={!isTenantHost(host)} demoHint={demoLoginHint()} />;
}
