import { Condition } from "./types"

export function matchesCondition(row: Record<string, unknown>, cond: Condition): boolean {
  const val = cond.col !== undefined ? row[cond.col] : undefined
  // colRight lets a where clause compare two columns on the same (merged) row
  const right = cond.colRight !== undefined ? row[cond.colRight] : cond.val

  switch (cond.type) {
    case "eq": return val === right
    case "ne": return val !== right
    case "gt": return (val as number) > (right as number)
    case "gte": return (val as number) >= (right as number)
    case "lt": return (val as number) < (right as number)
    case "lte": return (val as number) <= (right as number)
    case "like": return matchLike(String(val), String(cond.val))
    case "in": return (cond.val as unknown[]).includes(val)
    case "and": return (cond.conditions ?? []).every(c => matchesCondition(row, c))
    case "or": return (cond.conditions ?? []).some(c => matchesCondition(row, c))
  }
}

// for join ON clauses: col refers to left table, colRight refers to right table
export function matchesJoinCondition(
  leftRow: Record<string, unknown>,
  rightRow: Record<string, unknown>,
  cond: Condition
): boolean {
  switch (cond.type) {
    case "eq":
      return cond.colRight
        ? leftRow[cond.col!] === rightRow[cond.colRight]
        : leftRow[cond.col!] === cond.val
    case "ne":
      return cond.colRight
        ? leftRow[cond.col!] !== rightRow[cond.colRight]
        : leftRow[cond.col!] !== cond.val
    case "and":
      return (cond.conditions ?? []).every(c => matchesJoinCondition(leftRow, rightRow, c))
    case "or":
      return (cond.conditions ?? []).some(c => matchesJoinCondition(leftRow, rightRow, c))
    default:
      // fall back to evaluating on the merged row for other condition types
      return matchesCondition({ ...leftRow, ...rightRow }, cond)
  }
}

// sql like: % = any chars, _ = any single char
function matchLike(str: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/%/g, ".*").replace(/_/g, ".") + "$",
    "i"
  )
  return regex.test(str)
}
