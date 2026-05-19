import { Condition, DbConfig, InferRow, TableDef, TableSchema, WithTableFn } from "../types"
import { matchesCondition } from "../filter"

export class DeleteBuilder<S extends TableSchema, TReturn = void> {
  private _condition?: Condition
  private _shouldReturn = false

  constructor(
    private readonly table: TableDef<S>,
    private readonly config: DbConfig,
    private readonly _withTable: WithTableFn
  ) {}

  where(condition: Condition): this {
    this._condition = condition
    return this
  }

  returning(): DeleteBuilder<S, InferRow<S>[]> {
    this._shouldReturn = true
    return this as unknown as DeleteBuilder<S, InferRow<S>[]>
  }

  then<TResult1 = TReturn, TResult2 = never>(
    resolve?: ((value: TReturn) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(resolve as any, reject) as Promise<TResult1 | TResult2>
  }

  private async _execute(): Promise<TReturn> {
    const condition = this._condition
    let deleted: InferRow<S>[] = []

    await this._withTable<InferRow<S>>(this.table._name, rows => {
      deleted = []
      return rows.filter(row => {
        if (!condition || matchesCondition(row as Record<string, unknown>, condition)) {
          deleted.push(row)
          return false
        }
        return true
      })
    })

    return (this._shouldReturn ? deleted : undefined) as TReturn
  }
}
