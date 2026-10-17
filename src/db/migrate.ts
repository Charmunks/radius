import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";

const client = new SQL(process.env.DATABASE_URL!);

await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
await client.close();
console.log("Migrations applied");
