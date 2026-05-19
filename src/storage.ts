import { list } from "@vercel/blob"
import { DbConfig } from "./types"

// mirrors the sdk's internal api version — update if @vercel/blob bumps it
const BLOB_API_VERSION = "9"
const BLOB_API_BASE = "https://blob.vercel-storage.com"

function getPathname(tableName: string, config: DbConfig): string {
  return `${config.prefix ?? "blob-db"}/${tableName}.json`
}

function apiHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-api-version": BLOB_API_VERSION,
    ...extra,
  }
}

interface ReadResult<T> {
  data: T[]
  etag: string | null
}

export async function readTable<T>(tableName: string, config: DbConfig): Promise<ReadResult<T>> {
  const pathname = getPathname(tableName, config)

  // use sdk for list — we only need the url, not the (stripped) etag
  const { blobs } = await list({ prefix: pathname, token: config.token, limit: 1 })
  const blob = blobs.find(b => b.pathname === pathname)
  if (!blob) return { data: [], etag: null }

  // for private stores use downloadUrl (signed), otherwise the public url
  const fetchUrl = config.access === "private" ? blob.downloadUrl : blob.url
  const res = await fetch(fetchUrl, { cache: "no-store" })
  if (!res.ok) return { data: [], etag: null }

  const etag = res.headers.get("etag")
  const data = await res.json() as T[]
  return { data, etag }
}

export async function writeTable<T>(
  tableName: string,
  data: T[],
  etag: string | null,
  config: DbConfig
): Promise<void> {
  const pathname = getPathname(tableName, config)
  const params = new URLSearchParams({ pathname })
  const body = JSON.stringify(data)

  const res = await fetch(`${BLOB_API_BASE}/?${params}`, {
    method: "PUT",
    body,
    headers: apiHeaders(config.token, {
      "content-type": "application/octet-stream",
      "x-content-type": "application/json",
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "0",
      "x-access": config.access ?? "public",
      // conditional write: only succeed if nobody else wrote since we read
      ...(etag ? { "if-match": etag } : {}),
    }),
  })

  if (res.status === 412) {
    const err = new Error("blob-db: write conflict — another write occurred concurrently") as Error & { status: number }
    err.status = 412
    throw err
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`blob-db: write failed (${res.status}) — ${text}`)
  }
}

// read-modify-write with optimistic locking via etag + if-match.
// retries up to maxRetries times when a concurrent write is detected (412).
export async function withTable<T>(
  tableName: string,
  config: DbConfig,
  transform: (rows: T[]) => T[],
  maxRetries = 3
): Promise<T[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, etag } = await readTable<T>(tableName, config)
    const next = transform(data)

    try {
      await writeTable(tableName, next, etag, config)
      return next
    } catch (e: unknown) {
      const isConflict = (e as { status?: number })?.status === 412
      if (isConflict && attempt < maxRetries - 1) continue
      throw e
    }
  }

  throw new Error(`blob-db: write conflict after ${maxRetries} retries`)
}
