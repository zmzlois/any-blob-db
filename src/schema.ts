import { ColumnDef, TableDef, TableSchema } from "./types"

export function defineTable<S extends TableSchema>(name: string, schema: S): TableDef<S> {
  return { _name: name, _schema: schema, ...schema }
}

// column builders — mirrors drizzle's col.text(), col.integer(), etc.
export const col = {
  text: (name: string) => new ColumnDef(name, "text" as const),
  integer: (name: string) => new ColumnDef(name, "integer" as const),
  number: (name: string) => new ColumnDef(name, "number" as const),
  boolean: (name: string) => new ColumnDef(name, "boolean" as const),
  timestamp: (name: string) => new ColumnDef(name, "timestamp" as const),
  json: (name: string) => new ColumnDef(name, "json" as const),
}
