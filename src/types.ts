export type ColType =
  | "text"
  | "integer"
  | "number"
  | "boolean"
  | "timestamp"
  | "json"

export type InferColType<T extends ColType> = T extends "text"
  ? string
  : T extends "integer" | "number"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "timestamp"
        ? Date
        : unknown

export class ColumnDef<T extends ColType> {
  readonly _name: string
  readonly _type: T
  _isPrimary = false
  _defaultVal?: InferColType<T> | (() => InferColType<T>)
  // thunk avoids circular reference errors when two tables reference each other
  _references?: () => ColumnDef<ColType>

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

  // T2 extends T ensures the referenced column's type is compatible
  references<T2 extends T>(ref: () => ColumnDef<T2>): this {
    this._references = ref as () => ColumnDef<ColType>
    return this
  }
}

export type TableSchema = Record<string, ColumnDef<ColType>>

export type InferRow<S extends TableSchema> = {
  [K in keyof S]: S[K] extends ColumnDef<infer T> ? InferColType<T> : never
}

type HasDefault<C> =
  C extends ColumnDef<ColType>
    ? C["_defaultVal"] extends undefined
      ? false
      : true
    : false
export type InsertRow<S extends TableSchema> = {
  [K in keyof S as HasDefault<S[K]> extends true ? never : K]: InferRow<S>[K]
} & {
  [K in keyof S as HasDefault<S[K]> extends true ? K : never]?: InferRow<S>[K]
}

export type TableDef<S extends TableSchema> = {
  _name: string
  _schema: S
} & { [K in keyof S]: S[K] }

export interface DbConfig {
  token: string
  prefix?: string
  maxRetries?: number
  access?: "public" | "private"
}

export interface Condition {
  type: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "and" | "or"
  col?: string
  colRight?: string // set when rhs is a column ref (join ON clauses)
  val?: unknown
  conditions?: Condition[]
}

// injectable so the transaction can swap in its snapshot-capturing version
export type WithTableFn = <T>(
  tableName: string,
  transform: (rows: T[]) => T[],
) => Promise<T[]>
