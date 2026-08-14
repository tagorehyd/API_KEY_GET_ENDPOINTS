import { readFileSync, writeFileSync } from "node:fs";

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;

if (!databaseId) {
  throw new Error("Missing CLOUDFLARE_D1_DATABASE_ID environment variable.");
}

const configPath = "wrangler.jsonc";
const config = readFileSync(configPath, "utf8");
const updated = config.replace("REPLACE_WITH_D1_DATABASE_ID", databaseId);

if (updated === config) {
  throw new Error("Could not find D1 database id placeholder in wrangler.jsonc.");
}

writeFileSync(configPath, updated);
