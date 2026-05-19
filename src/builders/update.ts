import { matchesCondition } from "../filter"
import type {
  Condition,
  InferRow,
  TableDef,
  TableSchema,
  WithTableFn,
} from "../types"

export class UpdateBuilder<S extends TableSchema, TReturn = void> {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read via destructuring in _execute
  private _updates: Partial<InferRow<S>> = {}
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read via destructuring in _execute
  private _condition?: Condition
  private _shouldReturn = false
  private readonly _withTable: WithTableFn

  constructor(
    private readonly table: TableDef<S>,
    withTable: WithTableFn,
  ) {
    this._withTable = withTable
  }

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
    const { _updates: updates, _condition: condition } = this
    let updated: InferRow<S>[] = []

    await this._withTable<InferRow<S>>(this.table._name, (rows) => {
      updated = []
      return rows.map((row) => {
        if (
          !condition ||
          matchesCondition(row as Record<string, unknown>, condition)
        ) {
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
