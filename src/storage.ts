import { BlobPreconditionFailedError, get, put } from "@vercel/blob"
import type { DbConfig } from "./types"

function getPathname(tableName: string, config: DbConfig): string {
  return `${config.prefix ?? "blob-db"}/${tableName}.json`
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

  // useCache: false fetches directly from origin, bypassing the vercel blob cdn.
  // required for read-modify-write correctness — cdn caches have a minimum ttl of ~60s
  // and would return stale etags, causing spurious 412s on the next conditional write.
  const result = await get(pathname, {
    token: config.token,
    access: config.access ?? "public",
    useCache: false,
  })

  if (!result || !result.stream) return { data: [], etag: null }

  const data = (await new Response(
    result.stream as ReadableStream,
  ).json()) as T[]
  return { data, etag: result.blob.etag || null }
}

export async function writeTable<T>(
  tableName: string,
  data: T[],
  etag: string | null,
  config: DbConfig,
): Promise<void> {
  const pathname = getPathname(tableName, config)
  try {
    await put(pathname, JSON.stringify(data), {
      access: config.access ?? "public",
      token: config.token,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      // conditional write: only succeed if nobody else wrote since we read
      ...(etag ? { ifMatch: etag } : {}),
    })
  } catch (e: unknown) {
    if (e instanceof BlobPreconditionFailedError) {
      const err = new Error(
        "blob-db: write conflict — another write occurred concurrently",
      ) as Error & { status: number }
      err.status = 412
      throw err
    }
    throw e
  }
}

// read-modify-write with optimistic locking via etag + x-if-match.
// retries up to maxRetries times when a concurrent write is detected (412).
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
