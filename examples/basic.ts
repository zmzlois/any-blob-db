import { createDb, defineTable, col, eq, and, gt } from "../src/index"

const token = process.env.BLOB_TOKEN
if (!token) {
  console.error("set BLOB_TOKEN=<your token> before running")
  process.exit(1)
}

// ── schema ────────────────────────────────────────────────────────────────────

const users = defineTable("users", {
  id:     col.text("id").primaryKey().default(() => crypto.randomUUID()),
  name:   col.text("name"),
  email:  col.text("email"),
  age:    col.integer("age"),
  active: col.boolean("active").default(true),
})

const posts = defineTable("posts", {
  id:       col.text("id").primaryKey().default(() => crypto.randomUUID()),
  authorId: col.text("authorId"),
  title:    col.text("title"),
  published: col.boolean("published").default(false),
})

const db = createDb({ token, prefix: "blob-db-test" })

// ── helpers ───────────────────────────────────────────────────────────────────

const pass = (msg: string) => console.log("  ✓", msg)
const fail = (msg: string) => { console.error("  ✗", msg); process.exitCode = 1 }
const assert = (ok: boolean, msg: string) => ok ? pass(msg) : fail(msg)

// ── tests ─────────────────────────────────────────────────────────────────────

async function testCrud() {
  console.log("\n── crud ──────────────────────────────────────────────────────")

  for (const u of await db.select().from(users)) await db.delete(users).where(eq(users.id, u.id))

  await db.insert(users).values({ id: "1", name: "Alice", email: "alice@test.com", age: 30 })
  pass("insert without returning")

  const [bob] = await db.insert(users)
    .values({ name: "Bob", email: "bob@test.com", age: 25 })
    .returning()
  assert(bob.name === "Bob",                            "insert returning — name correct")
  assert(typeof bob.id === "string" && bob.id.length > 0, "insert returning — default uuid applied")
  assert(bob.active === true,                           "insert returning — default boolean applied")

  const batch = await db.insert(users)
    .values([
      { name: "Carol", email: "carol@test.com", age: 35 },
      { name: "Dave",  email: "dave@test.com",  age: 20 },
    ])
    .returning()
  assert(batch.length === 2, "batch insert — 2 rows")

  const all = await db.select().from(users)
  assert(all.length === 4, `select all — 4 rows (got ${all.length})`)

  const alices = await db.select().from(users).where(eq(users.name, "Alice"))
  assert(alices.length === 1 && alices[0].email === "alice@test.com", "select where eq")

  const young = await db.select().from(users).where(and(gt(users.age, 20), eq(users.active, true)))
  assert(young.length === 3, `select compound where — 3 rows (got ${young.length})`)

  await db.update(users).set({ age: 31 }).where(eq(users.name, "Alice"))
  pass("update without returning")

  const updated = await db.update(users).set({ active: false }).where(eq(users.name, "Dave")).returning()
  assert(updated.length === 1 && updated[0].active === false, "update returning")

  const dave = await db.select().from(users).where(eq(users.name, "Dave"))
  assert(dave[0].active === false, "update persisted")

  await db.delete(users).where(eq(users.name, "Carol"))
  assert((await db.select().from(users)).length === 3, "delete — 3 rows remain")

  const deleted = await db.delete(users).where(eq(users.name, "Dave")).returning()
  assert(deleted.length === 1 && deleted[0].name === "Dave", "delete returning")
}

async function testUpsert() {
  console.log("\n── upsert ────────────────────────────────────────────────────")

  for (const u of await db.select().from(users)) await db.delete(users).where(eq(users.id, u.id))

  // first insert — no conflict
  const [u1] = await db.insert(users)
    .values({ id: "upsert-1", name: "Alice", email: "a@test.com", age: 30 })
    .returning()
  assert(u1.name === "Alice", "upsert: first insert")

  // second insert same id — should update, not duplicate
  const [u2] = await db.insert(users)
    .values({ id: "upsert-1", name: "Alice Updated", email: "a@test.com", age: 31 })
    .onConflict(users.id, { set: { name: "Alice Updated", age: 31 } })
    .returning()
  assert(u2.name === "Alice Updated", "upsert: conflict updates name")
  assert(u2.age === 31,              "upsert: conflict updates age")

  const all = await db.select().from(users)
  assert(all.length === 1, "upsert: no duplicate rows created")
}

async function testJoins() {
  console.log("\n── joins ─────────────────────────────────────────────────────")

  // seed users
  for (const u of await db.select().from(users)) await db.delete(users).where(eq(users.id, u.id))
  for (const p of await db.select().from(posts)) await db.delete(posts).where(eq(posts.id, p.id))

  const [alice] = await db.insert(users).values({ id: "j-alice", name: "Alice", email: "a@t.com", age: 30 }).returning()
  const [bob]   = await db.insert(users).values({ id: "j-bob",   name: "Bob",   email: "b@t.com", age: 25 }).returning()

  // alice has 2 posts, bob has 1 post, no author has 1 orphan post
  await db.insert(posts).values([
    { id: "p1", authorId: alice.id, title: "Alice Post 1", published: true },
    { id: "p2", authorId: alice.id, title: "Alice Post 2", published: false },
    { id: "p3", authorId: bob.id,   title: "Bob Post 1",   published: true },
    { id: "p4", authorId: "ghost",  title: "Orphan Post",  published: true },
  ])

  // inner join — only posts with a matching user (drops the orphan)
  const inner = await db.select()
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
  assert(inner.length === 3, `innerJoin — 3 rows (got ${inner.length})`)
  assert(inner.every(r => r.name !== undefined), "innerJoin — user fields present")

  // left join — all posts kept, orphan has undefined user fields
  const left = await db.select()
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
  assert(left.length === 4, `leftJoin — 4 rows (got ${left.length})`)

  const orphan = left.find(r => r.title === "Orphan Post")!
  assert(orphan.name === undefined, "leftJoin — orphan row has undefined user fields")

  // join + where
  const alicePosts = await db.select()
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(eq(users.name, "Alice"))
  assert(alicePosts.length === 2, `join + where — 2 alice posts (got ${alicePosts.length})`)

  // join + where on joined field
  const publishedAlice = await db.select()
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(eq(users.name, "Alice"), eq(posts.published, true)))
  assert(publishedAlice.length === 1, `join + compound where — 1 published alice post (got ${publishedAlice.length})`)
}

async function testTransaction() {
  console.log("\n── transaction ───────────────────────────────────────────────")

  for (const u of await db.select().from(users)) await db.delete(users).where(eq(users.id, u.id))
  for (const p of await db.select().from(posts)) await db.delete(posts).where(eq(posts.id, p.id))

  // happy path — both writes commit
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: "tx-1", name: "Tx Alice", email: "tx@test.com", age: 30 })
    await tx.insert(posts).values({ id: "tx-p1", authorId: "tx-1", title: "Tx Post" })
  })
  assert((await db.select().from(users)).length === 1, "tx happy path — user committed")
  assert((await db.select().from(posts)).length === 1, "tx happy path — post committed")

  // rollback — error mid-tx undoes all mutations
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: "tx-2", name: "Should Rollback", email: "r@test.com", age: 99 })
      throw new Error("intentional failure")
    })
  } catch {
    // expected
  }
  const usersAfterRollback = await db.select().from(users)
  assert(usersAfterRollback.length === 1,           "tx rollback — user count restored")
  assert(!usersAfterRollback.some(u => u.id === "tx-2"), "tx rollback — rolled-back user gone")

  // return value propagates from the fn
  const result = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users)
      .values({ name: "Tx Bob", email: "txb@test.com", age: 20 })
      .returning()
    return u.id
  })
  assert(typeof result === "string" && result.length > 0, "tx return value propagates")
}

async function testIfMatch() {
  console.log("\n── if-match / optimistic locking ────────────────────────────")
  console.log("  (two concurrent writes — one should see a 412 if Vercel honors If-Match)\n")

  for (const u of await db.select().from(users)) await db.delete(users).where(eq(users.id, u.id))
  await db.insert(users).values({ name: "Concurrent", email: "c@test.com", age: 1 })

  let conflictDetected = false
  const results = await Promise.allSettled([
    db.update(users).set({ age: 2 }).where(eq(users.name, "Concurrent")),
    db.update(users).set({ age: 3 }).where(eq(users.name, "Concurrent")),
  ])

  for (const r of results) {
    if (r.status === "rejected") {
      const msg = String(r.reason)
      if (msg.includes("412") || msg.includes("conflict")) {
        conflictDetected = true
        pass("If-Match honored — 412 on concurrent write")
      } else {
        fail(`unexpected error: ${msg}`)
      }
    }
  }

  if (!conflictDetected) {
    console.log("  ⚠  no 412 — Vercel does not enforce If-Match (last-write-wins active)")
  }

  const final = await db.select().from(users).where(eq(users.name, "Concurrent"))
  assert(final.length === 1, "concurrent writes — row still exists")
  assert([2, 3].includes(final[0].age as number), `concurrent writes — age is ${final[0].age}`)
}

async function cleanup() {
  console.log("\n── cleanup ───────────────────────────────────────────────────")
  for (const u of await db.select().from(users)) await db.delete(users).where(eq(users.id, u.id))
  for (const p of await db.select().from(posts)) await db.delete(posts).where(eq(posts.id, p.id))
  assert((await db.select().from(users)).length === 0, "users empty")
  assert((await db.select().from(posts)).length === 0, "posts empty")
}

async function main() {
  try {
    await testCrud()
    await testUpsert()
    await testJoins()
    await testTransaction()
    await testIfMatch()
    await cleanup()
    console.log("\ndone.\n")
  } catch (e) {
    console.error("\nunhandled error:", e)
    process.exit(1)
  }
}

main()
