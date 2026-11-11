import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export { Prisma, PrismaClient } from "./generated/prisma/client.js";
export type { Todo, User } from "./generated/prisma/client.js";

/** Client options on the pg driver adapter (Prisma 7 has no built-in driver). */
export function prismaClientOptions (databaseUrl: string) {
    return { adapter: new PrismaPg({ connectionString: databaseUrl }) };
}

export function createPrismaClient (databaseUrl: string) {
    return new PrismaClient(prismaClientOptions(databaseUrl));
}
