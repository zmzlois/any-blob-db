import { readTable, withTable, writeTable } from "./storage"
import { DbConfig, TableDef, TableSchema, WithTableFn } from "./types"
import { SelectBuilder } from "./builders/select"
import { InsertBuilder } from "./builders/insert"
import { UpdateBuilder } from "./builders/update"
import { DeleteBuilder } from "./builders/delete"

// a snapshot of one table taken at the start of the transaction
interface Snapshot {
  data: unknown[]
  etag: string | null
}

export class TransactionDb {
  // keyed by table name — captured once, before the first write to that table
  private readonly snapshots = new Map<string, Snapshot>()

  constructor(private readonly config: DbConfig) {}

  // capture snapshot of a table before its first mutation in this tx
  private async ensureSnapshot(tableName: string): Promise<void> {
    if (this.snapshots.has(tableName)) return
    const { data, etag } = await readTable<unknown>(tableName, this.config)
    this.snapshots.set(tableName, { data: [...data], etag })
  }

  // write function injected into mutation builders
  // captures snapshot, then delegates to the normal withTable
  readonly withTableFn: WithTableFn = async <T>(
    tableName: string,
    transform: (rows: T[]) => T[]
  ) => {
    await this.ensureSnapshot(tableName)
    return withTable<T>(tableName, this.config, transform, this.config.maxRetries)
  }

  // restore all touched tables to their pre-transaction state
  async rollback(): Promise<void> {
    await Promise.all(
      Array.from(this.snapshots.entries()).map(([tableName, { data }]) =>
        // null etag = unconditional write (force overwrite for rollback)
        writeTable(tableName, data, null, this.config)
      )
    )
  }

  // same interface as the main db — select reads fresh data, mutations go through withTableFn
  select(fields?: Record<string, unknown>) {
    return new SelectBuilder(this.config, fields)
  }

  insert<S extends TableSchema>(table: TableDef<S>) {
    return new InsertBuilder(table, this.config, this.withTableFn)
  }

  update<S extends TableSchema>(table: TableDef<S>) {
    return new UpdateBuilder(table, this.config, this.withTableFn)
  }

  delete<S extends TableSchema>(table: TableDef<S>) {
    return new DeleteBuilder(table, this.config, this.withTableFn)
  }
}
