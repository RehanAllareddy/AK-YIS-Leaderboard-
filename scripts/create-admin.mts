/**
 * Creates an administrator, or resets an existing one's password.
 *
 *   npm run admin:create -- --username <name> [--display-name "Ms. Rivera"]
 *
 * The password is prompted for (hidden) — never pass it as an argument, where
 * it would land in shell history. For automation, pipe it on stdin:
 *   printf '%s' "$PASSWORD" | npm run admin:create -- --username <name> --password-stdin
 *
 * Other options:
 *   --deactivate     disable the account and end its sessions
 */
import readline from "node:readline";
import { hashPassword } from "../src/lib/auth/password.ts";
import { PASSWORD_MIN_LENGTH, USERNAME_MIN_LENGTH } from "../src/lib/constants.ts";
import { runMigrations } from "../src/lib/db/migrate.ts";
import { openDb } from "./env.mts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    rlAny._writeToOutput = (s: string) => {
      if (!muted || s.includes("\n")) rlAny.output.write(muted ? "\n" : s);
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

const username = arg("username")?.trim().toLowerCase();
if (!username || username.length < USERNAME_MIN_LENGTH || !/^[a-z0-9._-]+$/.test(username)) {
  console.error(
    `Usage: npm run admin:create -- --username <name>\n` +
      `Username: at least ${USERNAME_MIN_LENGTH} characters; letters, digits, dot, dash, underscore.`,
  );
  process.exit(1);
}

const db = await openDb();
try {
  await runMigrations(db);

  if (process.argv.includes("--deactivate")) {
    const { rows } = await db.query<{ id: number }>("update admins set is_active = false where username = $1 returning id", [username]);
    if (!rows[0]) throw new Error(`No admin named ${username}.`);
    await db.query("delete from admin_sessions where admin_id = $1", [rows[0].id]);
    console.log(`Deactivated ${username} and ended their sessions.`);
  } else {
    let password: string;
    if (process.argv.includes("--password-stdin")) {
      password = await readStdin();
    } else {
      if (!process.stdin.isTTY) throw new Error("No terminal available; use --password-stdin.");
      password = await promptHidden(`Password for ${username} (min ${PASSWORD_MIN_LENGTH} chars): `);
      const confirm = await promptHidden("Confirm password: ");
      if (password !== confirm) throw new Error("Passwords do not match.");
    }
    if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (password.toLowerCase().includes(username)) throw new Error("Password must not contain the username.");

    const hash = await hashPassword(password);
    const { rows } = await db.query<{ id: number; inserted: boolean }>(
      `insert into admins (username, password_hash, display_name) values ($1, $2, $3)
       on conflict (username) do update
         set password_hash = excluded.password_hash,
             display_name = coalesce(excluded.display_name, admins.display_name),
             is_active = true
       returning id, (xmax = 0) as inserted`,
      [username, hash, arg("display-name") ?? null],
    );
    if (!rows[0].inserted) {
      // A password reset ends any existing sessions.
      await db.query("delete from admin_sessions where admin_id = $1", [rows[0].id]);
    }
    console.log(rows[0].inserted ? `Created admin ${username}.` : `Updated password for ${username}; existing sessions ended.`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
