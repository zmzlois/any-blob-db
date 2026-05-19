import { readTable } from "../storage"
import { matchesCondition, matchesJoinCondition } from "../filter"
import { Condition, DbConfig, InferRow, TableDef, TableSchema } from "../types"

interface JoinClause {
  table: TableDef<any>
  condition: Condition
  type: "inner" | "left"
}

export class SelectBuilder<TRow = never> {
  private _tables: TableDef<any>[] = []
  private _joins: JoinClause[] = []
  private _condition?: Condition
  private _fields?: Record<string, unknown>

  constructor(
    private readonly config: DbConfig,
    fields?: Record<string, unknown>
  ) {
    this._fields = fields
  }

  from<S extends TableSchema>(table: TableDef<S>): SelectBuilder<InferRow<S>> {
    this._tables = [table]
    return this as unknown as SelectBuilder<InferRow<S>>
  }

  // rows with no match in the right table are dropped
  innerJoin<S extends TableSchema>(
    table: TableDef<S>,
    on: Condition
  ): SelectBuilder<TRow & InferRow<S>> {
    this._joins.push({ table, condition: on, type: "inner" })
    return this as unknown as SelectBuilder<TRow & InferRow<S>>
  }

  // rows with no match in the right table are kept, right-side fields are undefined
  leftJoin<S extends TableSchema>(
    table: TableDef<S>,
    on: Condition
  ): SelectBuilder<TRow & Partial<InferRow<S>>> {
    this._joins.push({ table, condition: on, type: "left" })
    return this as unknown as SelectBuilder<TRow & Partial<InferRow<S>>>
  }

  where(condition: Condition): this {
    this._condition = condition
    return this
  }

  then<TResult1 = TRow[], TResult2 = never>(
    resolve?: ((value: TRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(resolve, reject) as Promise<TResult1 | TResult2>
  }

  private async _execute(): Promise<TRow[]> {
    if (this._tables.length === 0) {
      throw new Error("blob-db: call .from(table) before awaiting select")
    }

    const primaryTable = this._tables[0]

    // read primary + all joined tables in parallel
    const [primaryResult, ...joinResults] = await Promise.all([
      readTable<Record<string, unknown>>(primaryTable._name, this.config),
      ...this._joins.map(j => readTable<Record<string, unknown>>(j.table._name, this.config)),
    ])

    let rows: Record<string, unknown>[] = primaryResult.data

    // apply each join in sequence
    for (let i = 0; i < this._joins.length; i++) {
      const { condition, type } = this._joins[i]
      const rightRows = joinResults[i].data

      if (type === "inner") {
        rows = rows.flatMap(leftRow => {
          const matches = rightRows.filter(r => matchesJoinCondition(leftRow, r, condition))
          return matches.map(r => ({ ...leftRow, ...r }))
        })
      } else {
        // left join: keep left row even when nothing matches, right fields just absent
        rows = rows.flatMap(leftRow => {
          const matches = rightRows.filter(r => matchesJoinCondition(leftRow, r, condition))
          return matches.length > 0
            ? matches.map(r => ({ ...leftRow, ...r }))
            : [leftRow]
        })
      }
    }

    // where filter runs on the fully merged row
    if (this._condition) {
      rows = rows.filter(row => matchesCondition(row, this._condition!))
    }

    // optional field projection
    if (this._fields) {
      const keys = Object.keys(this._fields)
      rows = rows.map(row => Object.fromEntries(keys.map(k => [k, row[k]])))
    }

    return rows as unknown as TRow[]
  }
}
