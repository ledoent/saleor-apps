import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

migrate(drizzle(pool), { migrationsFolder: "./drizzle" })
  .then(() => {
    console.log("zift-app migrations applied");
    return pool.end();
  })
  .catch((error) => {
    console.error("zift-app migrations failed", error);
    process.exit(1);
  });
