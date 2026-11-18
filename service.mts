// The app's Composer service declaration. The compiled build output imports
// this file (by its .mjs name) to reach its database and configuration, so it
// must compile with the app: the apps/api tsconfig covers this directory.
import { compute } from "@prisma/composer-prisma-cloud";
import { dataContract, postgres } from "@prisma/composer-prisma-cloud/orm";
import { secretString } from "@prisma/composer/arktype";
import node from "@prisma/composer/node";
import { type } from "arktype";
import type { Contract } from "./apps/api/src/prisma/contract.js";
import contractJson from "./apps/api/src/prisma/contract.json" with { type: "json" };

const data = dataContract<Contract>(contractJson);
export { data };

export default compute({
  name: "web",
  deps: {
    db: postgres(data),
  },
  build: node({
    module: import.meta.url,
    dir: "./apps/api/dist",
    entry: "apps/api/src/server.js",
    dependencies: "external",
  }),
  input: type({
    sessionSecret: secretString(),
    "publicOrigin?": secretString(),
    "smtpUrl?": secretString(),
    "mailFrom?": secretString(),
  }),
});
