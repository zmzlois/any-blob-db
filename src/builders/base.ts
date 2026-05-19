import type { InferRow, TableDef, TableSchema, WithTableFn } from "../types"

export abstract class WriteBuilder<S extends TableSchema, TReturn = void> {
  protected _shouldReturn = false

  constructor(
    protected readonly table: TableDef<S>,
    protected readonly _withTable: WithTableFn,
  ) {}

  returning(): WriteBuilder<S, InferRow<S>[]> {
    this._shouldReturn = true
    return this as unknown as WriteBuilder<S, InferRow<S>[]>
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

  protected abstract _execute(): Promise<TReturn>
}
