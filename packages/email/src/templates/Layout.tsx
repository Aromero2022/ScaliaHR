import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
import type { ResolvedBranding } from "../branding.js";
import type { Locale } from "../contract.js";
import { messagesFor } from "../messages.js";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function Layout(props: {
  locale: Locale;
  branding: ResolvedBranding;
  preview: string;
  heading: string;
  children: ReactNode;
  action?: { url: string; label: string };
}) {
  const { m, t } = messagesFor(props.locale);
  const { branding } = props;
  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={{ backgroundColor: "#F3F4F6", fontFamily: font, margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#FFFFFF", borderRadius: 8, maxWidth: 560, padding: "32px" }}>
          <Section style={{ marginBottom: 24 }}>
            {branding.logoUrl ? (
              <Img src={branding.logoUrl} alt={branding.tenantName} height={40} style={{ height: 40, width: "auto" }} />
            ) : (
              <Text style={{ color: branding.primaryColor, fontSize: 20, fontWeight: 700, margin: 0 }}>
                {branding.tenantName}
              </Text>
            )}
          </Section>
          <Heading as="h1" style={{ color: "#111827", fontSize: 22, lineHeight: "30px", margin: "0 0 16px" }}>
            {props.heading}
          </Heading>
          {props.children}
          {props.action ? (
            <>
              <Section style={{ margin: "24px 0" }}>
                <Button
                  href={props.action.url}
                  style={{
                    backgroundColor: branding.primaryColor,
                    borderRadius: 6,
                    color: branding.buttonTextColor,
                    fontSize: 16,
                    fontWeight: 600,
                    padding: "12px 20px",
                    textDecoration: "none",
                  }}
                >
                  {props.action.label}
                </Button>
              </Section>
              <Text style={{ color: "#4B5563", fontSize: 14 }}>
                {m.common.linkFallback}{" "}
                <Link href={props.action.url} style={{ color: "#1F2937", wordBreak: "break-all" }}>
                  {props.action.url}
                </Link>
              </Text>
            </>
          ) : null}
          <Hr style={{ borderColor: "#E5E7EB", margin: "24px 0" }} />
          <Text style={{ color: "#6B7280", fontSize: 13, margin: 0 }}>
            {t(m.common.footer, { tenant: branding.tenantName })} {m.common.ignore}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const paragraph = { color: "#1F2937", fontSize: 16, lineHeight: "24px", margin: "0 0 12px" } as const;
