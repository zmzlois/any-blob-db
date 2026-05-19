import type {
  ColType,
  ColumnDef,
  InferColType,
  InferRow,
  InsertRow,
  TableDef,
  TableSchema,
  WithTableFn,
} from "../types"

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

export class InsertBuilder<S extends TableSchema, TReturn = void> {
  private _rows: InsertRow<S>[] = []
  private _shouldReturn = false
  private _conflict?: ConflictClause<S>
  private readonly _withTable: WithTableFn

  constructor(
    private readonly table: TableDef<S>,
    withTable: WithTableFn,
  ) {
    this._withTable = withTable
  }

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

  returning(): InsertBuilder<S, InferRow<S>[]> {
    this._shouldReturn = true
    return this as unknown as InsertBuilder<S, InferRow<S>[]>
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional thenable — enables `await builder` syntax
  then<TResult1 = TReturn, TResult2 = never>(
    resolve?: ((value: TReturn) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    // biome-ignore lint/suspicious/noExplicitAny: thenable pattern requires cast to pass typed resolve/reject
    return this._execute().then(resolve as any, reject) as Promise<
      TResult1 | TResult2
    >
  }

  private async _execute(): Promise<TReturn> {
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
