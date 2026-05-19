export type ColType = "text" | "integer" | "number" | "boolean" | "timestamp" | "json"

export type InferColType<T extends ColType> =
  T extends "text" ? string :
  T extends "integer" | "number" ? number :
  T extends "boolean" ? boolean :
  T extends "timestamp" ? Date :
  unknown

export class ColumnDef<T extends ColType> {
  readonly _name: string
  readonly _type: T
  _isPrimary = false
  _defaultVal?: InferColType<T> | (() => InferColType<T>)

  constructor(name: string, type: T) {
    this._name = name
    this._type = type
  }

  primaryKey(): this {
    this._isPrimary = true
    return this
  }

  default(val: InferColType<T> | (() => InferColType<T>)): this {
    this._defaultVal = val
    return this
  }
}

export type TableSchema = Record<string, ColumnDef<ColType>>

// maps { id: ColumnDef<"text">, age: ColumnDef<"integer"> } → { id: string, age: number }
export type InferRow<S extends TableSchema> = {
  [K in keyof S]: S[K] extends ColumnDef<infer T> ? InferColType<T> : never
}

// like InferRow but columns with a default value are optional — used for insert values()
type HasDefault<C> = C extends ColumnDef<ColType> ? (C["_defaultVal"] extends undefined ? false : true) : false
export type InsertRow<S extends TableSchema> =
  { [K in keyof S as HasDefault<S[K]> extends true ? never : K]: InferRow<S>[K] } &
  { [K in keyof S as HasDefault<S[K]> extends true ? K : never]?: InferRow<S>[K] }

// the object returned by defineTable — schema cols spread onto the def for dot-access in operators
export type TableDef<S extends TableSchema> = {
  _name: string
  _schema: S
} & { [K in keyof S]: S[K] }

export interface DbConfig {
  token: string
  // path prefix inside the blob store (default: "blob-db")
  prefix?: string
  // max retries on concurrent write conflicts detected via if-match (default: 3)
  maxRetries?: number
  // "public" (default) or "private" — must match your vercel blob store's access setting
  access?: "public" | "private"
}

export interface Condition {
  type: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "and" | "or"
  col?: string
  // set when the right-hand side is another column (used in join ON clauses)
  colRight?: string
  val?: unknown
  conditions?: Condition[]
}

// injectable write function — lets the transaction swap in its snapshot-capturing version
export type WithTableFn = <T>(tableName: string, transform: (rows: T[]) => T[]) => Promise<T[]>
