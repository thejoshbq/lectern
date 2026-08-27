import postgres, { type Sql } from "postgres";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is missing. Paste a Postgres URI — from Supabase: click Connect in the project dashboard, then copy the Transaction pooler URI (port 6543).",
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      "DATABASE_URL must be a Postgres URI starting with postgresql:// — not a Supabase API key (sb_secret_ / service_role). Copy the Transaction pooler URI from the Connect button.",
    );
  }
  return url;
}

let sql: Sql | null = null;
let tableReady = false;

function client(): Sql {
  if (!sql) {
    const url = databaseUrl();
    sql = postgres(url, {
      // Transaction-mode poolers (Supabase port 6543 / PgBouncer) cannot
      // use prepared statements. This app's queries are few and simple.
      prepare: false,
      max: 1,
      ssl: needsSsl(url) ? "require" : false,
    });
  }
  return sql;
}

function needsSsl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host !== "localhost" && host !== "127.0.0.1";
  } catch {
    return true;
  }
}

export async function ensureUsersTable(): Promise<void> {
  if (tableReady) return;
  await client()`
    CREATE TABLE IF NOT EXISTS lectern_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  tableReady = true;
}

export async function findUserByEmail(
  email: string,
): Promise<UserRecord | null> {
  await ensureUsersTable();
  const rows = await client()`
    SELECT id, email, password_hash
    FROM lectern_users
    WHERE email = ${email}
    LIMIT 1
  `;
  const row = rows[0] as
    | { id: string; email: string; password_hash: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, email: row.email, passwordHash: row.password_hash };
}

export async function insertUser(user: UserRecord): Promise<"ok" | "duplicate"> {
  await ensureUsersTable();
  try {
    await client()`
      INSERT INTO lectern_users (id, email, password_hash)
      VALUES (${user.id}, ${user.email}, ${user.passwordHash})
    `;
    return "ok";
  } catch (err) {
    if (isUniqueViolation(err)) return "duplicate";
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = "code" in err ? err.code : undefined;
  if (code === "23505") return true;
  const message = "message" in err ? err.message : undefined;
  return typeof message === "string" && /duplicate|unique/i.test(message);
}
