import { list } from "@vercel/blob"
import type { DbConfig } from "./types"

// update this when @vercel/blob bumps its internal api version
const BLOB_API_VERSION = "9"
const BLOB_API_BASE = "https://blob.vercel-storage.com"

function getPathname(tableName: string, config: DbConfig): string {
  return `${config.prefix ?? "blob-db"}/${tableName}.json`
}

function apiHeaders(
  token: string,
  extra: Record<string, string> = {},
): Record<string, string> {
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

export async function readTable<T>(
  tableName: string,
  config: DbConfig,
): Promise<ReadResult<T>> {
  const pathname = getPathname(tableName, config)
  const { blobs } = await list({
    prefix: pathname,
    token: config.token,
    limit: 1,
  })
  const blob = blobs.find((b) => b.pathname === pathname)
  if (!blob) return { data: [], etag: null }

  // the sdk strips etag from list results — fetch the url directly to capture it from response headers
  const fetchUrl = config.access === "private" ? blob.downloadUrl : blob.url
  const res = await fetch(fetchUrl, { cache: "no-store" })
  if (!res.ok) return { data: [], etag: null }

  return { data: (await res.json()) as T[], etag: res.headers.get("etag") }
}

export async function writeTable<T>(
  tableName: string,
  data: T[],
  etag: string | null,
  config: DbConfig,
): Promise<void> {
  const pathname = getPathname(tableName, config)
  const res = await fetch(
    `${BLOB_API_BASE}/?${new URLSearchParams({ pathname })}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
      headers: apiHeaders(config.token, {
        "content-type": "application/octet-stream",
        "x-content-type": "application/json",
        "x-add-random-suffix": "0",
        "x-cache-control-max-age": "0",
        // private stores reject this header — only send it for public stores
        ...((config.access ?? "public") === "public"
          ? { "x-access": "public" }
          : {}),
        ...(etag ? { "if-match": etag } : {}),
      }),
    },
  )

  if (res.status === 412) {
    const err = new Error(
      "blob-db: write conflict — another write occurred concurrently",
    ) as Error & { status: number }
    err.status = 412
    throw err
  }

  if (!res.ok) {
    throw new Error(
      `blob-db: write failed (${res.status}) — ${await res.text().catch(() => res.statusText)}`,
    )
  }
}

export async function withTable<T>(
  tableName: string,
  config: DbConfig,
  transform: (rows: T[]) => T[],
  maxRetries = 3,
): Promise<T[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, etag } = await readTable<T>(tableName, config)
    const next = transform(data)
    try {
      await writeTable(tableName, next, etag, config)
      return next
    } catch (e: unknown) {
      if (
        (e as { status?: number })?.status === 412 &&
        attempt < maxRetries - 1
      )
        continue
      throw e
    }
  }
  throw new Error(`blob-db: write conflict after ${maxRetries} retries`)
}
