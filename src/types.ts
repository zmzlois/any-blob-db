export type ColType =
  | "text"
  | "integer"
  | "number"
  | "boolean"
  | "timestamp"
  | "json"

export type InferColType<T extends ColType> = T extends "text"
  ? string
  : T extends "integer" | "number"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "timestamp"
        ? Date
        : unknown

export class ColumnDef<T extends ColType> {
  readonly _name: string
  readonly _type: T
  _isPrimary = false
  _defaultVal?: InferColType<T> | (() => InferColType<T>)
  // thunk avoids circular reference errors when two tables reference each other
  _references?: () => ColumnDef<ColType>

  constructor(name: string, type: T) {
    this._name = name
    this._type = type
  }

  primaryKey(): this {
    this._isPrimary = true
    return this
  }

  default(val: InferColType<T> | (() => InferColType<T>)): this {
    this._defaultVal = val
    return this
  }

  // T2 extends T ensures the referenced column's type is compatible
  references<T2 extends T>(ref: () => ColumnDef<T2>): this {
    this._references = ref as () => ColumnDef<ColType>
    return this
  }
}

export type TableSchema = Record<string, ColumnDef<ColType>>

export type InferRow<S extends TableSchema> = {
  [K in keyof S]: S[K] extends ColumnDef<infer T> ? InferColType<T> : never
}

type HasDefault<C> =
  C extends ColumnDef<ColType>
    ? C["_defaultVal"] extends undefined
      ? false
      : true
    : false
export type InsertRow<S extends TableSchema> = {
  [K in keyof S as HasDefault<S[K]> extends true ? never : K]: InferRow<S>[K]
} & {
  [K in keyof S as HasDefault<S[K]> extends true ? K : never]?: InferRow<S>[K]
}

export type TableDef<S extends TableSchema> = {
  _name: string
  _schema: S
} & { [K in keyof S]: S[K] }

export interface StorageAdapter {
  read(pathname: string): Promise<{ text: string | null; etag: string | null }>
  create(pathname: string, body: string): Promise<void>
  update(pathname: string, body: string, etag: string | null): Promise<void>
  delete?(pathname: string): Promise<void>
}

export interface R2HTTPMetadata {
  contentType?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  cacheControl?: string
  cacheExpiry?: Date
}

export type R2CustomMetadata = Record<string, string>

export interface R2Conditions {
  etagMatches?: string
  etagDoesNotMatch?: string
  uploadedAfter?: Date
  uploadedBefore?: Date
}

// byte range for partial reads.
export interface R2Range {
  offset?: number
  length?: number
  suffix?: number
}

export interface R2Object {
  etag: string
  httpEtag: string
  size: number
  uploaded: Date
  httpMetadata?: R2HTTPMetadata
  customMetadata?: R2CustomMetadata
  writeHttpMetadata(headers: Headers): void
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream
  bodyUsed: boolean
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
  json(): Promise<unknown>
}

export type R2Value =
  | ReadableStream
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | null

export interface R2BucketLike {
  get(
    key: string,
    options?: {
      onlyIf?: Headers | R2Conditions
      range?: Headers | R2Range
    },
  ): Promise<R2ObjectBody | null>

  put(
    key: string,
    value: R2Value,
    options?: {
      onlyIf?: Headers | R2Conditions
      httpMetadata?: Headers | R2HTTPMetadata
      customMetadata?: R2CustomMetadata
    },
  ): Promise<R2Object | null>

  delete(key: string | string[]): Promise<void>
}

interface BaseDbConfig {
  prefix?: string
  maxRetries?: number
}

export interface VercelBlobConfig extends BaseDbConfig {
  adapter?: "vercel-blob"
  token: string
  access?: "public" | "private"
}

export interface R2Config extends BaseDbConfig {
  adapter: "r2"
  bucket: R2BucketLike
}

export interface S3Config extends BaseDbConfig {
  adapter: "s3"
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  accountId?: string
  endpoint?: string
  region?: string
}

// escape hatch — bring your own storage backend
export interface CustomStorageConfig extends BaseDbConfig {
  adapter: "custom"
  storage: StorageAdapter
}

export type DbConfig =
  | VercelBlobConfig
  | R2Config
  | S3Config
  | CustomStorageConfig

export interface Condition {
  type: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "and" | "or"
  col?: string
  colRight?: string // set when rhs is a column ref (join ON clauses)
  val?: unknown
  conditions?: Condition[]
}

export type WithTableFn = <T>(
  tableName: string,
  transform: (rows: T[]) => T[],
) => Promise<T[]>
