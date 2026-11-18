// The Composer module: the app root Prisma Compute deploys. The name decides
// which project on Prisma Cloud this app deploys to.
import { appRoot } from "@prisma/composer";
import { envSecret } from "@prisma/composer-prisma-cloud";
import { postgres } from "@prisma/composer-prisma-cloud/orm";
import service, { data } from "./service.mts";

export default appRoot("knockout", ({ provision }) => {
  const db = provision(
    postgres({ name: "db", contract: data, config: "./prisma.config.ts" }),
    { id: "db" },
  );
  provision(service, {
    deps: { db },
    input: {
      sessionSecret: envSecret("SESSION_SECRET"), // Signs session cookies and encrypts MFA secrets.
      publicOrigin: envSecret("PUBLIC_ORIGIN"), // Public origin the email links and origin checks use.
      smtpUrl: envSecret("SMTP_URL"), // SMTP server the app delivers verification and reset mail through.
      mailFrom: envSecret("MAIL_FROM"), // From address for the app's transactional email.
    },
  });
});
