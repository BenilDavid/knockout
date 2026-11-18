import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
dotenv.config({ path: [".env", "../../.env"], quiet: true });
if (process.env.NODE_ENV === "production")
  throw new Error("Demo community seeding is disabled in production.");
const { Repository, audit } = await import("./storage.js");
const { makeAccount, passwordHash } = await import("./identity.js");
const { grant, synchronize } = await import("./predictions.js");
const repo = new Repository();
try {
  const password = randomBytes(18).toString("base64url");
  const hashed = await passwordHash(password);
  let created = false;
  await repo.mutate((s) => {
    const t = s.tournaments.find((t) => t.name === "Midnight Invitational");
    if (!t)
      throw new Error(
        "The example tournament was not found; other events were preserved.",
      );
    const admin = s.accounts.find((a) => a.role === "admin");
    if (!admin) throw new Error("Run admin:create first.");
    if (s.accounts.some((a) => a.email === "player@knockout.local"))
      throw new Error(
        "Demo participant already exists; existing credentials were preserved.",
      );
    const u = makeAccount("player@knockout.local", "Demo participant", hashed);
    u.verified = true;
    s.accounts.push(u);
    s.memberships.push({
      id: crypto.randomUUID(),
      tournamentId: t.id,
      userId: u.id,
      playerId: null,
      kind: "predictor",
      role: "participant",
      status: "approved",
      checkedIn: false,
      createdAt: new Date().toISOString(),
    });
    grant(s, u, t.id, admin.id);
    t.predictionsEnabled = true;
    t.stakeLimit = 25;
    synchronize(s, t);
    audit(t, "DEMO_COMMUNITY_CREATED", "Development prediction pool enabled.");
    created = true;
  });
  if (created) {
    await mkdir("data", { recursive: true });
    await writeFile(
      "data/player-access.txt",
      `Knockout example prediction participant\nEmail: player@knockout.local\nPassword: ${password}\n\n100 virtual points in the Midnight Invitational.\nDevelopment account only. Change its password after signing in.\n`,
      { mode: 0o600 },
    );
    console.log(
      "Example community enabled. Participant credentials saved in data/player-access.txt.",
    );
  }
} finally {
  await repo.close();
}
