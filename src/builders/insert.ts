import type {
  ColType,
  ColumnDef,
  InferColType,
  InferRow,
  InsertRow,
  TableSchema,
} from "../types"
import { WriteBuilder } from "./base"

function applyDefaults<S extends TableSchema>(
  schema: S,
  row: Partial<InferRow<S>>,
): InferRow<S> {
  const result = { ...row } as InferRow<S>
  for (const [key, colDef] of Object.entries(schema) as [
    string,
    ColumnDef<ColType>,
  ][]) {
    if (!(key in result) && colDef._defaultVal !== undefined) {
      ;(result as Record<string, unknown>)[key] =
        typeof colDef._defaultVal === "function"
          ? (colDef._defaultVal as () => InferColType<ColType>)()
          : colDef._defaultVal
    }
  }
  return result
}

interface ConflictClause<S extends TableSchema> {
  target: string
  set: Partial<InferRow<S>>
}

export class InsertBuilder<
  S extends TableSchema,
  TReturn = void,
> extends WriteBuilder<S, TReturn> {
  private _rows: InsertRow<S>[] = []
  private _conflict?: ConflictClause<S>

  values(rows: InsertRow<S> | InsertRow<S>[]): this {
    this._rows = Array.isArray(rows) ? rows : [rows]
    return this
  }

  onConflict(
    target: ColumnDef<ColType>,
    opts: { set: Partial<InferRow<S>> },
  ): this {
    this._conflict = { target: target._name, set: opts.set }
    return this
  }

  protected async _execute(): Promise<TReturn> {
    const toInsert = this._rows.map((row) =>
      applyDefaults(this.table._schema, row as unknown as Partial<InferRow<S>>),
    )

    let affected: InferRow<S>[] = []

    if (this._conflict) {
      const { target, set } = this._conflict
      await this._withTable<InferRow<S>>(this.table._name, (rows) => {
        affected = []
        const next = [...rows]
        for (const newRow of toInsert) {
          const idx = next.findIndex(
            (r) =>
              (r as Record<string, unknown>)[target] ===
              (newRow as Record<string, unknown>)[target],
          )
          if (idx >= 0) {
            next[idx] = { ...next[idx], ...set } as InferRow<S>
            affected.push(next[idx])
          } else {
            next.push(newRow)
            affected.push(newRow)
          }
        }
        return next
      })
    } else {
      await this._withTable<InferRow<S>>(this.table._name, (rows) => [
        ...rows,
        ...toInsert,
      ])
      affected = toInsert
    }

    return (this._shouldReturn ? affected : undefined) as TReturn
  }
}
