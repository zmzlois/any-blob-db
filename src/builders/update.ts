import { Condition, DbConfig, InferRow, TableDef, TableSchema, WithTableFn } from "../types"
import { matchesCondition } from "../filter"

export class UpdateBuilder<S extends TableSchema, TReturn = void> {
  private _updates: Partial<InferRow<S>> = {}
  private _condition?: Condition
  private _shouldReturn = false

  constructor(
    private readonly table: TableDef<S>,
    private readonly config: DbConfig,
    private readonly _withTable: WithTableFn
  ) {}

  set(updates: Partial<InferRow<S>>): this {
    this._updates = updates
    return this
  }

  where(condition: Condition): this {
    this._condition = condition
    return this
  }

  returning(): UpdateBuilder<S, InferRow<S>[]> {
    this._shouldReturn = true
    return this as unknown as UpdateBuilder<S, InferRow<S>[]>
  }

  then<TResult1 = TReturn, TResult2 = never>(
    resolve?: ((value: TReturn) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(resolve as any, reject) as Promise<TResult1 | TResult2>
  }

  private async _execute(): Promise<TReturn> {
    const { _updates: updates, _condition: condition } = this
    let updated: InferRow<S>[] = []

    await this._withTable<InferRow<S>>(this.table._name, rows => {
      updated = []
      return rows.map(row => {
        if (!condition || matchesCondition(row as Record<string, unknown>, condition)) {
          const next = { ...row, ...updates } as InferRow<S>
          updated.push(next)
          return next
        }
        return row
      })
    })

    return (this._shouldReturn ? updated : undefined) as TReturn
  }
}
