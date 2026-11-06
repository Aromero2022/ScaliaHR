// k6 load test (D36) against the local Docker stack. Each virtual user is one
// employee: it signs in once (straight to Supabase Auth, not through the
// rate-limited login form), then opens app pages with a reading pause between
// them, like a person would. Scenarios run at the same time:
//   one_tenant      LOAD_VUS users (default 1,000) in tenant load-big
//   other_tenants   50 users in each of load-a, load-b and load-c
// Thresholds: page p95 < 500 ms, < 1 % failed requests, > 99 % checks; every
// page is also checked to show no other tenant's employees.
import http from "k6/http";
import encoding from "k6/encoding";
import exec from "k6/execution";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = __ENV.SUPABASE_URL ?? "http://localhost:54321";
const ANON_KEY = __ENV.ANON_KEY;
const COOKIE = __ENV.COOKIE_NAME ?? "sb-localhost-auth-token";
const VUS = Number(__ENV.LOAD_VUS ?? 1000);
const SMALL_VUS = Number(__ENV.SMALL_VUS ?? 50);
const HOLD = __ENV.HOLD ?? "4m";
const RAMP = __ENV.RAMP ?? "2m";
const RAMP_SECONDS = Number(RAMP.replace(/s$/, "").replace(/(\d+)m$/, (_, m) => String(Number(m) * 60)));
const THINK_MIN = Number(__ENV.THINK_MIN ?? 2);
const THINK_MAX = Number(__ENV.THINK_MAX ?? 6);

// One copy of the accounts for every VU (each VU would otherwise parse its own).
const ACCOUNTS_FILE = __ENV.ACCOUNTS ?? "/out/accounts.json";
const ACCOUNTS = new SharedArray("accounts", () => JSON.parse(open(ACCOUNTS_FILE)).accounts);
const PASSWORD = new SharedArray("password", () => [JSON.parse(open(ACCOUNTS_FILE)).password])[0];
const TAGS = ["LoadGrande", "LoadAlfa", "LoadBravo", "LoadCharlie"];

const stages = (target) => [
  { duration: RAMP, target },
  { duration: HOLD, target },
  { duration: "20s", target: 0 },
];

export const options = {
  scenarios: {
    one_tenant: { executor: "ramping-vus", stages: stages(VUS), env: { TENANT: "load-big" }, gracefulRampDown: "10s" },
    ...Object.fromEntries(
      ["load-a", "load-b", "load-c"].map((tenant) => [
        `other_tenants_${tenant}`,
        { executor: "ramping-vus", stages: stages(SMALL_VUS), env: { TENANT: tenant }, gracefulRampDown: "10s" },
      ]),
    ),
  },
  // The gate is the steady state: every user signed in and reading. Ramp-up
  // (1,150 bcrypt sign-ins in RAMP) is measured and reported too, not gated.
  thresholds: {
    "http_req_duration{kind:page,phase:steady}": ["p(95)<500"],
    "http_req_duration{kind:page,phase:ramp}": ["max>=0"], // listed in the summary only
    "http_req_failed{kind:page}": ["rate<0.01"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  // Keep each user's session across iterations, as a browser would (k6 clears
  // the cookie jar between iterations by default).
  noCookiesReset: true,
};

// What a session cookie of @supabase/ssr looks like: "base64-" + base64url(JSON),
// split into .0, .1… chunks past 3180 characters.
function sessionCookies(session) {
  const value = `base64-${encoding.b64encode(JSON.stringify(session), "rawurl")}`;
  if (value.length <= 3180) return { [COOKIE]: value };
  const chunks = {};
  for (let i = 0; i * 3180 < value.length; i++) chunks[`${COOKIE}.${i}`] = value.slice(i * 3180, (i + 1) * 3180);
  return chunks;
}

const PAGES = [
  { path: "/dashboard", weight: 3 },
  { path: "/employees", weight: 3 },
  { path: "/employees?page=2", weight: 1 },
  { path: "/employees?q=Empleado%201", weight: 2 },
  { path: "/org-chart", weight: 1 },
  { path: "/performance", weight: 2 },
  { path: "/skills-hub", weight: 1 },
  { path: "/profile", weight: 1 },
];
const WEIGHTED = PAGES.flatMap((page) => Array(page.weight).fill(page.path));

let signedIn = false;
let myAccount = null;

/** This VU's account: the n-th of its tenant (VU ids are unique across scenarios). */
function accountFor(tenant) {
  const own = [];
  for (let i = 0; i < ACCOUNTS.length; i++) if (ACCOUNTS[i].tenant === tenant) own.push(i);
  return ACCOUNTS[own[(exec.vu.idInTest - 1) % own.length]];
}

function signIn() {
  const account = (myAccount = accountFor(__ENV.TENANT));
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: account.email, password: PASSWORD }),
    { headers: { apikey: ANON_KEY, "Content-Type": "application/json" }, tags: { kind: "auth" } },
  );
  if (!check(res, { "signed in": (r) => r.status === 200 })) return false;
  const jar = http.cookieJar();
  for (const [name, value] of Object.entries(sessionCookies(res.json()))) jar.set(BASE_URL, name, value);
  return true;
}

export default function () {
  if (!signedIn) {
    signedIn = signIn();
    if (!signedIn) {
      sleep(5);
      return;
    }
  }
  const path = WEIGHTED[Math.floor(Math.random() * WEIGHTED.length)];
  const phase = exec.instance.currentTestRunDuration / 1000 < RAMP_SECONDS ? "ramp" : "steady";
  const res = http.get(`${BASE_URL}${path}`, { redirects: 0, tags: { kind: "page", page: path.split("?")[0], phase } });
  const ownTag = myAccount.tag;
  check(res, {
    "page 200": (r) => r.status === 200,
    "no other tenant's employees": (r) => TAGS.every((tag) => tag === ownTag || !String(r.body).includes(tag)),
  });
  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}
