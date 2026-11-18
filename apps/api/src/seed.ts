import dotenv from "dotenv";
dotenv.config({ path: [".env", "../../.env"], quiet: true });
if (process.env.NODE_ENV === "production")
  throw new Error("Demo seeding is disabled in production.");
const { Repository } = await import("./storage.js");
const { seed } = await import("./tournaments.js");
const repo = new Repository();
try {
  await repo.mutate(async (state) => {
    if (state.tournaments.length || state.players.length)
      throw new Error(
        "Demo seeding requires an empty workspace. Existing records were preserved.",
      );
    await seed(state);
  });
  console.log(`Example tournament created in ${repo.mode} storage.`);
} finally {
  await repo.close();
}
