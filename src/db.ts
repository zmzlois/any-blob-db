import { DeleteBuilder } from "./builders/delete"
import { InsertBuilder } from "./builders/insert"
import { SelectBuilder } from "./builders/select"
import { UpdateBuilder } from "./builders/update"
import { withTable } from "./storage"
import { TransactionDb } from "./transaction"
import type { DbConfig, TableDef, TableSchema, WithTableFn } from "./types"

export function createDb(config: DbConfig) {
  const defaultWithTable: WithTableFn = <T>(
    tableName: string,
    transform: (rows: T[]) => T[],
  ) => withTable<T>(tableName, config, transform, config.maxRetries)

  return {
    select(fields?: Record<string, unknown>) {
      return new SelectBuilder(config, fields)
    },

    insert<S extends TableSchema>(table: TableDef<S>) {
      return new InsertBuilder(table, defaultWithTable)
    },

    update<S extends TableSchema>(table: TableDef<S>) {
      return new UpdateBuilder(table, defaultWithTable)
    },

    delete<S extends TableSchema>(table: TableDef<S>) {
      return new DeleteBuilder(table, defaultWithTable)
    },

    // not acid — other readers may see partial state during execution,
    // but all touched tables are restored to their pre-tx state on error
    async transaction<T>(fn: (tx: TransactionDb) => Promise<T>): Promise<T> {
      const tx = new TransactionDb(config)
      try {
        return await fn(tx)
      } catch (e) {
        await tx.rollback()
        throw e
      }
    },

    async wipe(...tables: Array<{ _name: string }>): Promise<void> {
      await Promise.all(tables.map((t) => defaultWithTable(t._name, () => [])))
    },
  }
}
