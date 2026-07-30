import { PrismaClient } from "@prisma/client";

// One shared connection for the whole app. We'll import `db` wherever we
// need to talk to the database, instead of creating new connections
// everywhere (that would eventually exhaust the database's connection limit).
export const db = new PrismaClient();
