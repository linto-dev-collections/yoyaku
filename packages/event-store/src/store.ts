import {
  type DrizzleSqliteDODatabase,
  drizzle,
} from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
// @ts-expect-error -- `pnpm es:generate`（drizzle-kit generate）で ./drizzle/migrations が生成される
import migrations from "../drizzle/migrations";
import * as schema from "./schema";

export type EventStoreDb = DrizzleSqliteDODatabase<typeof schema>;

/** DO の storage に Drizzle(durable-sqlite) を載せる。 */
export function createEventStoreDb(
  storage: DurableObjectStorage,
): EventStoreDb {
  return drizzle(storage, { schema, logger: false });
}

/** DO 起動時に blockConcurrencyWhile 内で呼ぶ。生成済みマイグレーションを適用。 */
export async function migrateEventStore(db: EventStoreDb): Promise<void> {
  await migrate(db, migrations);
}
