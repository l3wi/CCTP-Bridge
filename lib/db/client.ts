import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const getRequiredEnv = (name: "TURSO_DATABASE_URL" | "TURSO_AUTH_TOKEN"): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

const createDatabase = () => {
  const client: Client = createClient({
    url: getRequiredEnv("TURSO_DATABASE_URL"),
    authToken: getRequiredEnv("TURSO_AUTH_TOKEN"),
  });

  return drizzle({ client, schema });
};

type Database = ReturnType<typeof createDatabase>;
let database: Database | undefined;

export const getDatabase = (): Database => {
  database ??= createDatabase();
  return database;
};
