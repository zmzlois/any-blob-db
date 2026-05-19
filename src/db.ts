import { withTable } from "./storage"
import { DbConfig, TableDef, TableSchema, WithTableFn } from "./types"
import { SelectBuilder } from "./builders/select"
import { InsertBuilder } from "./builders/insert"
import { UpdateBuilder } from "./builders/update"
import { DeleteBuilder } from "./builders/delete"
import { TransactionDb } from "./transaction"

export function createDb(config: DbConfig) {
  // standard (non-tx) write function — reads fresh, transforms, writes with if-match
  const defaultWithTable: WithTableFn = <T>(tableName: string, transform: (rows: T[]) => T[]) =>
    withTable<T>(tableName, config, transform, config.maxRetries)

  return {
    select(fields?: Record<string, unknown>) {
      return new SelectBuilder(config, fields)
    },

    insert<S extends TableSchema>(table: TableDef<S>) {
      return new InsertBuilder(table, config, defaultWithTable)
    },

    update<S extends TableSchema>(table: TableDef<S>) {
      return new UpdateBuilder(table, config, defaultWithTable)
    },

    delete<S extends TableSchema>(table: TableDef<S>) {
      return new DeleteBuilder(table, config, defaultWithTable)
    },

    // runs fn with a transaction context. on error, all touched tables are rolled back
    // to their pre-transaction state. not acid — other readers may see partial state
    // during execution, but all mutations are undone on failure.
    async transaction<T>(fn: (tx: TransactionDb) => Promise<T>): Promise<T> {
      const tx = new TransactionDb(config)
      try {
        return await fn(tx)
      } catch (e) {
        await tx.rollback()
        throw e
      }
    },
  }
}
