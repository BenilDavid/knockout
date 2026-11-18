import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
dotenv.config({ path: [".env", "../../.env"], quiet: true });
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const email = (
  args.includes("--email")
    ? option("--email")
    : (process.env.ADMIN_EMAIL ?? "admin@knockout.local")
)
  .trim()
  .toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Provide a valid --email.");
if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD)
  throw new Error(
    "Set ADMIN_PASSWORD to a unique password (12+ characters) for provisioning.",
  );
const password =
  process.env.ADMIN_PASSWORD ?? randomBytes(18).toString("base64url");
if (password.length < 12)
  throw new Error("Use a password with at least 12 characters.");
if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== "production") {
  const secret = randomBytes(48).toString("base64url");
  await appendFile(".env", `\nSESSION_SECRET=${secret}\n`);
  process.env.SESSION_SECRET = secret;
}
const { Repository } = await import("./storage.js");
const { makeAccount, passwordHash } = await import("./identity.js");
const repo = new Repository();
try {
  const hashed = await passwordHash(password);
  let created = false;
  await repo.mutate((s) => {
    if (s.accounts.some((u) => u.email === email)) {
      console.log("Account already exists; credentials were preserved.");
      return;
    }
    s.accounts.push(
      makeAccount(email, "Workspace administrator", hashed, true),
    );
    created = true;
  });
  if (created) {
    if (!process.env.ADMIN_PASSWORD) {
      await mkdir("data", { recursive: true });
      await writeFile(
        "data/admin-access.txt",
        `Knockout local administrator\nEmail: ${email}\nPassword: ${password}\n\nSign in at http://127.0.0.1:5173/admin/login\nChange this password in Account settings. This file is ignored by Git.\n`,
        { mode: 0o600 },
      );
      console.log(
        "Administrator created. Credentials saved in data/admin-access.txt.",
      );
    } else console.log("Administrator created using ADMIN_PASSWORD.");
  }
} finally {
  await repo.close();
}
