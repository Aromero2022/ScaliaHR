// D36: one route at a fixed arrival rate, below the web process's saturation,
// so the web container's CPU per request can be read from its cgroup without a
// queue. Not part of the D36/D56 harness (load/): a tool of scripts/perf.
// The sessions come from the accounts that load/seed.mjs writes; each request
// uses one of them, signed in once in setup().
import http from "k6/http";
import encoding from "k6/encoding";
import exec from "k6/execution";
import { check } from "k6";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = __ENV.SUPABASE_URL ?? "http://localhost:54321";
const ANON_KEY = __ENV.ANON_KEY;
const COOKIE = __ENV.COOKIE_NAME ?? "sb-localhost-auth-token";
const ROUTE = __ENV.ROUTE ?? "/employees";
const RATE = Number(__ENV.RATE ?? 15);
const DURATION = __ENV.DURATION ?? "60s";
const SESSIONS = Number(__ENV.SESSIONS ?? 40);
const ACCOUNTS_FILE = __ENV.ACCOUNTS ?? "/out/accounts.json";
const ACCOUNTS = new SharedArray("accounts", () => JSON.parse(open(ACCOUNTS_FILE)).accounts);
const PASSWORD = new SharedArray("password", () => [JSON.parse(open(ACCOUNTS_FILE)).password])[0];

export const options = {
  scenarios: {
    fixed: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: DURATION, preAllocatedVUs: 40, maxVUs: 200 },
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  // Listed in the summary only.
  thresholds: { "http_req_duration{kind:page}": ["max>=0"], "http_reqs{kind:page}": ["count>=0"], "checks{check:status 200}": ["rate>=0"] },
};

function sessionCookies(session) {
  const value = `base64-${encoding.b64encode(JSON.stringify(session), "rawurl")}`;
  if (value.length <= 3180) return { [COOKIE]: value };
  const chunks = {};
  for (let i = 0; i * 3180 < value.length; i++) chunks[`${COOKIE}.${i}`] = value.slice(i * 3180, (i + 1) * 3180);
  return chunks;
}

export function setup() {
  const accounts = ACCOUNTS.filter((a) => a.tenant === "load-big").slice(0, SESSIONS);
  if (accounts.length === 0) throw new Error("no load-big accounts: run load/seed.mjs first");
  return {
    sessions: accounts.map((a) => {
      const res = http.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, JSON.stringify({ email: a.email, password: PASSWORD }), {
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        tags: { kind: "auth" },
      });
      if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
      return sessionCookies(res.json());
    }),
  };
}

export default function (data) {
  const cookies = data.sessions[exec.scenario.iterationInTest % data.sessions.length];
  const jar = http.cookieJar();
  for (const [name, value] of Object.entries(cookies)) jar.set(BASE_URL, name, value);
  const res = http.get(`${BASE_URL}${ROUTE}`, { redirects: 0, tags: { kind: "page" } });
  check(res, { "status 200": (r) => r.status === 200 });
}
