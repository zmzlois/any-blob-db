import { matchesCondition, matchesJoinCondition } from "../filter"
import { readTable } from "../storage"
import type {
  ColType,
  ColumnDef,
  Condition,
  DbConfig,
  InferRow,
  TableDef,
  TableSchema,
} from "../types"

interface JoinClause {
  table: TableDef<TableSchema>
  condition: Condition
  type: "inner" | "left"
}

function inferForeignKey(
  leftTable: TableDef<TableSchema>,
  rightTable: TableDef<TableSchema>,
): Condition | null {
  const ls = leftTable._schema as Record<string, ColumnDef<ColType>>
  const rs = rightTable._schema as Record<string, ColumnDef<ColType>>

  for (const [lk, lc] of Object.entries(ls)) {
    if (!lc._references) continue
    const target = lc._references()
    for (const [rk, rc] of Object.entries(rs)) {
      if (rc === target) return { type: "eq", col: lk, colRight: rk }
    }
  }

  // check the reverse direction so .from(users).innerJoin(posts) works too
  for (const [rk, rc] of Object.entries(rs)) {
    if (!rc._references) continue
    const target = rc._references()
    for (const [lk, lc] of Object.entries(ls)) {
      if (lc === target) return { type: "eq", col: lk, colRight: rk }
    }
  }

  return null
}

function resolveJoinCondition(
  existing: TableDef<TableSchema>[],
  newTable: TableDef<TableSchema>,
  explicit?: Condition,
): Condition {
  if (explicit) return explicit
  for (const t of existing) {
    const cond = inferForeignKey(t, newTable)
    if (cond) return cond
  }
  const names = existing.map((t) => `"${t._name}"`).join(", ")
  throw new Error(
    `blob-db: no foreign key found between [${names}] and "${newTable._name}" — pass an explicit ON condition`,
  )
}

export class SelectBuilder<TRow = never> {
  private _primary?: TableDef<TableSchema>
  private _joins: JoinClause[] = []
  private _condition?: Condition
  private _fields?: Record<string, unknown>

  constructor(
    private readonly config: DbConfig,
    fields?: Record<string, unknown>,
  ) {
    this._fields = fields
  }

  from<S extends TableSchema>(table: TableDef<S>): SelectBuilder<InferRow<S>> {
    this._primary = table
    return this as unknown as SelectBuilder<InferRow<S>>
  }

  // on is optional — omit to infer the condition from .references() declarations
  innerJoin<S extends TableSchema>(
    table: TableDef<S>,
    on?: Condition,
  ): SelectBuilder<TRow & InferRow<S>> {
    // biome-ignore lint/style/noNonNullAssertion: _primary is always set before join methods are callable
    const existing = [this._primary!, ...this._joins.map((j) => j.table)]
    this._joins.push({
      table,
      condition: resolveJoinCondition(existing, table, on),
      type: "inner",
    })
    return this as unknown as SelectBuilder<TRow & InferRow<S>>
  }

  leftJoin<S extends TableSchema>(
    table: TableDef<S>,
    on?: Condition,
  ): SelectBuilder<TRow & Partial<InferRow<S>>> {
    // biome-ignore lint/style/noNonNullAssertion: _primary is always set before join methods are callable
    const existing = [this._primary!, ...this._joins.map((j) => j.table)]
    this._joins.push({
      table,
      condition: resolveJoinCondition(existing, table, on),
      type: "left",
    })
    return this as unknown as SelectBuilder<TRow & Partial<InferRow<S>>>
  }

  where(condition: Condition): this {
    this._condition = condition
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional thenable — enables `await builder` syntax
  then<TResult1 = TRow[], TResult2 = never>(
    resolve?: ((value: TRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(resolve, reject) as Promise<TResult1 | TResult2>
  }

  private async _execute(): Promise<TRow[]> {
    if (!this._primary)
      throw new Error("blob-db: call .from(table) before awaiting select")

    const [primaryResult, ...joinResults] = await Promise.all([
      readTable<Record<string, unknown>>(this._primary._name, this.config),
      ...this._joins.map((j) =>
        readTable<Record<string, unknown>>(j.table._name, this.config),
      ),
    ])

    let rows: Record<string, unknown>[] = primaryResult.data

    for (let i = 0; i < this._joins.length; i++) {
      const { condition, type } = this._joins[i]
      const rightRows = joinResults[i].data
      if (type === "inner") {
        rows = rows.flatMap((left) => {
          const matches = rightRows.filter((r) =>
            matchesJoinCondition(left, r, condition),
          )
          return matches.map((r) => ({ ...left, ...r }))
        })
      } else {
        rows = rows.flatMap((left) => {
          const matches = rightRows.filter((r) =>
            matchesJoinCondition(left, r, condition),
          )
          return matches.length > 0
            ? matches.map((r) => ({ ...left, ...r }))
            : [left]
        })
      }
    }

    if (this._condition) {
      const cond = this._condition
      rows = rows.filter((row) => matchesCondition(row, cond))
    }

    if (this._fields) {
      const keys = Object.keys(this._fields)
      rows = rows.map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])))
    }

    return rows as unknown as TRow[]
  }
}
