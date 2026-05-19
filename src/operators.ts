import { type ColType, ColumnDef, type Condition } from "./types"

type AnyCol = ColumnDef<ColType>

function colOrVal(
  _col: AnyCol,
  rhs: AnyCol | unknown,
): Pick<Condition, "colRight" | "val"> {
  return rhs instanceof ColumnDef
    ? { colRight: (rhs as AnyCol)._name }
    : { val: rhs }
}

export const eq = (col: AnyCol, rhs: AnyCol | unknown): Condition => ({
  type: "eq",
  col: col._name,
  ...colOrVal(col, rhs),
})
export const ne = (col: AnyCol, rhs: AnyCol | unknown): Condition => ({
  type: "ne",
  col: col._name,
  ...colOrVal(col, rhs),
})
export const gt = (col: AnyCol, rhs: AnyCol | unknown): Condition => ({
  type: "gt",
  col: col._name,
  ...colOrVal(col, rhs),
})
export const gte = (col: AnyCol, rhs: AnyCol | unknown): Condition => ({
  type: "gte",
  col: col._name,
  ...colOrVal(col, rhs),
})
export const lt = (col: AnyCol, rhs: AnyCol | unknown): Condition => ({
  type: "lt",
  col: col._name,
  ...colOrVal(col, rhs),
})
export const lte = (col: AnyCol, rhs: AnyCol | unknown): Condition => ({
  type: "lte",
  col: col._name,
  ...colOrVal(col, rhs),
})

export const like = (col: AnyCol, pattern: string): Condition => ({
  type: "like",
  col: col._name,
  val: pattern,
})
export const inArray = (col: AnyCol, vals: unknown[]): Condition => ({
  type: "in",
  col: col._name,
  val: vals,
})
export const and = (...conditions: Condition[]): Condition => ({
  type: "and",
  conditions,
})
export const or = (...conditions: Condition[]): Condition => ({
  type: "or",
  conditions,
})
