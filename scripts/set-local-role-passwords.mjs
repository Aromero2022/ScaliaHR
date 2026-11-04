// Gives the migration-created roles prisma_app, worker_app (D17) and
// email_enqueuer (D20) the passwords from .env.docker, in the LOCAL database
// only. Called by scripts/local-up.sh:
//   node --env-file=.env.docker scripts/set-local-role-passwords.mjs <db-url>
import { pathToFileURL } from "node:url";
import pg from "pg";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ROLE_PASSWORD_VARS = {
  prisma_app: "PRISMA_APP_PASSWORD",
  worker_app: "WORKER_APP_PASSWORD",
  email_enqueuer: "EMAIL_ENQUEUER_PASSWORD",
};

export function assertLocalDbUrl(raw) {
  let url;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new Error("the database URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("the database URL must use postgres://");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`refusing to change passwords on a non-local database (host "${url.hostname}")`);
  }
  if (url.search) {
    throw new Error("refusing a database URL with query parameters: they can redirect the connection");
  }
  return url.toString();
}

export function passwordsFromEnv(env) {
  return Object.entries(ROLE_PASSWORD_VARS).map(([role, name]) => {
    const password = env[name];
    if (!password || password.length < 8) {
      throw new Error(`${name} must be set (8+ characters) in .env.docker`);
    }
    return { role, password };
  });
}

async function main() {
  const dbUrl = assertLocalDbUrl(process.argv[2]);
  const passwords = passwordsFromEnv(process.env);
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    for (const { role, password } of passwords) {
      // ALTER ROLE takes no bind parameters; the role name is a fixed identifier.
      await client.query(`ALTER ROLE ${role} WITH PASSWORD ${client.escapeLiteral(password)}`);
      console.log(`set local password for ${role}`);
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
