import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

declare global {
  var __cafeDb: DB | undefined;
}

function open(): DB {
  const file = path.resolve(process.env.DATABASE_PATH ?? "./data/cafe.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve("./drizzle") });
  return db;
}

/** Next 번들과 server.ts가 같은 프로세스에서 하나의 연결을 공유하도록 globalThis에 보관 */
function getDb(): DB {
  return (globalThis.__cafeDb ??= open());
}

/**
 * 처음 사용할 때 DB를 연다.
 * import 시점에 열면 `next build`가 페이지 데이터를 수집하는 여러 워커에서
 * 동시에 DB를 만들고 마이그레이션하다가 SQLITE_BUSY로 실패한다.
 */
export const db: DB = new Proxy({} as DB, {
  get(_, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export { schema };
