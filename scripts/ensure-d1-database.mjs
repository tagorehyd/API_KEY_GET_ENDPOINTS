import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const databaseName = "api-key-get-endpoints";
const configPath = "wrangler.jsonc";

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || findOrCreateDatabaseId();
const config = readFileSync(configPath, "utf8");
const updated = config.replace("REPLACE_WITH_D1_DATABASE_ID", databaseId);

if (updated === config) {
  throw new Error("Could not find D1 database id placeholder in wrangler.jsonc.");
}

writeFileSync(configPath, updated);
console.log(`Configured D1 database '${databaseName}' (${databaseId}).`);

function findOrCreateDatabaseId() {
  const databases = JSON.parse(runWrangler(["d1", "list", "--json"]));
  const existing = databases.find((database) => database.name === databaseName);

  if (existing?.uuid) {
    return existing.uuid;
  }

  const output = runWrangler(["d1", "create", databaseName]);
  const createdDatabaseId = output.match(/database_id\s*=\s*"([^"]+)"/)?.[1]
    ?? output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i)?.[1];

  if (!createdDatabaseId) {
    throw new Error(`Could not read created D1 database id from wrangler output:\n${output}`);
  }

  return createdDatabaseId;
}

function runWrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
