import service from "../../../service.mjs";

// On Prisma Compute and under `prisma dev` the whole configuration arrives
// through the service declaration: the boot stashes the input document in
// COMPOSER_INPUT and `service.input()` returns it, secrets as redacting boxes.
// A process booted without the framework — the repository's file-backed tests
// and local scripts — has no service environment; only there does the app keep
// reading the environment variables it read before the service existed.
function tryInput() {
  try {
    return service.input();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("(env COMPOSER_INPUT is unset)")
    )
      return undefined;
    throw error;
  }
}

const input = tryInput();

function read(
  field: keyof NonNullable<ReturnType<typeof service.input>>,
  envName: string,
): string | undefined {
  const value = input?.[field];
  if (value !== undefined) return value.expose();
  return process.env[envName];
}

export const sessionSecret = () => read("sessionSecret", "SESSION_SECRET");
export const publicOrigin = () => read("publicOrigin", "PUBLIC_ORIGIN");
export const smtpUrl = () => read("smtpUrl", "SMTP_URL");
export const mailFrom = () => read("mailFrom", "MAIL_FROM");
