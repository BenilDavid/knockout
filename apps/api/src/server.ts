import dotenv from "dotenv";
dotenv.config({ path: ["../../.env", ".env"], quiet: true });
const { createApp } = await import("./app.js");
const { default: service } = await import("../../../service.mjs");
const { app } = await createApp();
// On Compute and under `prisma dev` the reserved port arrives through the
// service declaration; a process booted without the framework (local scripts)
// keeps the PORT variable and the old default.
const port = (() => {
  try {
    return service.port();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('missing required config param "url"')
    )
      return Number(process.env.PORT ?? 3000);
    throw error;
  }
})();
await app.listen({ port, host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
