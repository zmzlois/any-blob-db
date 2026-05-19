import { createDb, defineTable, col, eq, and, gt } from "../src/index"

const token = process.env.BLOB_TOKEN
if (!token) {
  console.error("set BLOB_TOKEN=<your token> before running")
  process.exit(1)
}

// schema — .references() declares a FK and enables auto-join inference

const users = defineTable("users", {
  id:     col.text("id").primaryKey().default(() => crypto.randomUUID()),
  name:   col.text("name"),
  email:  col.text("email"),
  age:    col.integer("age"),
  active: col.boolean("active").default(true),
})

const posts = defineTable("posts", {
  id:        col.text("id").primaryKey().default(() => crypto.randomUUID()),
  authorId:  col.text("authorId").references(() => users.id),
  title:     col.text("title"),
  published: col.boolean("published").default(false),
})

const comments = defineTable("comments", {
  id:      col.text("id").primaryKey().default(() => crypto.randomUUID()),
  postId:  col.text("postId").references(() => posts.id),
  content: col.text("content"),
})

const db = createDb({ token, prefix: "blob-db-test" })

const pass = (msg: string) => console.log("  ✓", msg)
const fail = (msg: string) => { console.error("  ✗", msg); process.exitCode = 1 }
const assert = (ok: boolean, msg: string) => ok ? pass(msg) : fail(msg)

const wipe = () => db.wipe(users, posts, comments)

async function testCrud() {
  console.log("\ncrud")
  await wipe()

  await db.insert(users).values({ id: "1", name: "Alice", email: "alice@test.com", age: 30 })
  pass("insert")

  const [bob] = await db.insert(users)
    .values({ name: "Bob", email: "bob@test.com", age: 25 })
    .returning()
  assert(bob.name === "Bob",                               "insert returning — name")
  assert(typeof bob.id === "string" && bob.id.length > 0, "insert returning — uuid default")
  assert(bob.active === true,                              "insert returning — boolean default")

  const batch = await db.insert(users)
    .values([
      { name: "Carol", email: "carol@test.com", age: 35 },
      { name: "Dave",  email: "dave@test.com",  age: 20 },
    ])
    .returning()
  assert(batch.length === 2, "batch insert")

  assert((await db.select().from(users)).length === 4, "select all")

  const alices = await db.select().from(users).where(eq(users.name, "Alice"))
  assert(alices.length === 1 && alices[0].email === "alice@test.com", "select where eq")

  const young = await db.select().from(users).where(and(gt(users.age, 20), eq(users.active, true)))
  assert(young.length === 3, `select compound where (got ${young.length})`)

  await db.update(users).set({ age: 31 }).where(eq(users.name, "Alice"))
  pass("update")

  const updated = await db.update(users).set({ active: false }).where(eq(users.name, "Dave")).returning()
  assert(updated.length === 1 && updated[0].active === false, "update returning")
  assert((await db.select().from(users).where(eq(users.name, "Dave")))[0].active === false, "update persisted")

  await db.delete(users).where(eq(users.name, "Carol"))
  assert((await db.select().from(users)).length === 3, "delete")

  const deleted = await db.delete(users).where(eq(users.name, "Dave")).returning()
  assert(deleted.length === 1 && deleted[0].name === "Dave", "delete returning")
}

async function testUpsert() {
  console.log("\nupsert")
  await wipe()

  const [u1] = await db.insert(users)
    .values({ id: "upsert-1", name: "Alice", email: "a@test.com", age: 30 })
    .returning()
  assert(u1.name === "Alice", "initial insert")

  const [u2] = await db.insert(users)
    .values({ id: "upsert-1", name: "Alice Updated", email: "a@test.com", age: 31 })
    .onConflict(users.id, { set: { name: "Alice Updated", age: 31 } })
    .returning()
  assert(u2.name === "Alice Updated", "conflict updated name")
  assert(u2.age === 31,              "conflict updated age")
  assert((await db.select().from(users)).length === 1, "no duplicate rows")
}

async function testJoins() {
  console.log("\njoins")
  await wipe()

  const [alice] = await db.insert(users).values({ id: "j-alice", name: "Alice", email: "a@t.com", age: 30 }).returning()
  const [bob]   = await db.insert(users).values({ id: "j-bob",   name: "Bob",   email: "b@t.com", age: 25 }).returning()

  await db.insert(posts).values([
    { id: "p1", authorId: alice.id, title: "Alice Post 1", published: true  },
    { id: "p2", authorId: alice.id, title: "Alice Post 2", published: false },
    { id: "p3", authorId: bob.id,   title: "Bob Post 1",   published: true  },
    { id: "p4", authorId: "ghost",  title: "Orphan Post",  published: true  },
  ])

  await db.insert(comments).values([
    { postId: "p1", content: "great post!" },
    { postId: "p1", content: "agreed!"     },
    { postId: "p3", content: "nice one"    },
  ])

  // explicit ON
  const explicit = await db.select().from(posts).innerJoin(users, eq(posts.authorId, users.id))
  assert(explicit.length === 3, `explicit innerJoin (got ${explicit.length})`)

  // inferred from posts.authorId.references(() => users.id)
  const autoInner = await db.select().from(posts).innerJoin(users)
  assert(autoInner.length === 3, `auto innerJoin FK inferred (got ${autoInner.length})`)
  assert(autoInner.every(r => r.name !== undefined), "auto innerJoin — user fields present")

  const autoLeft = await db.select().from(posts).leftJoin(users)
  assert(autoLeft.length === 4, `auto leftJoin (got ${autoLeft.length})`)
  assert(autoLeft.find(r => r.title === "Orphan Post")!.name === undefined, "leftJoin — orphan undefined")

  const alicePosts = await db.select().from(posts).innerJoin(users).where(eq(users.name, "Alice"))
  assert(alicePosts.length === 2, `join + where (got ${alicePosts.length})`)

  const published = await db.select().from(posts).innerJoin(users)
    .where(and(eq(users.name, "Alice"), eq(posts.published, true)))
  assert(published.length === 1, `join + compound where (got ${published.length})`)

  // 3-table: comments.postId → posts.id, posts.authorId → users.id
  const threeway = await db.select().from(comments).innerJoin(posts).innerJoin(users)
  assert(threeway.length === 3, `3-table join (got ${threeway.length})`)
  assert(threeway.every(r => r.content && r.title && r.name), "3-table — all fields present")

  const aliceComments = await db.select().from(comments).innerJoin(posts).innerJoin(users)
    .where(eq(users.name, "Alice"))
  assert(aliceComments.length === 2, `3-table + where (got ${aliceComments.length})`)
}

async function testTransaction() {
  console.log("\ntransaction")
  await wipe()

  const txResult = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users)
      .values({ id: "tx-1", name: "Tx Alice", email: "tx@test.com", age: 30 })
      .returning()
    await tx.insert(posts).values({ authorId: user.id, title: "Tx Post" })
    return user.id
  })
  assert(typeof txResult === "string",                     "return value propagates")
  assert((await db.select().from(users)).length === 1,     "happy path — user committed")
  assert((await db.select().from(posts)).length === 1,     "happy path — post committed")

  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: "tx-2", name: "Should Rollback", email: "r@test.com", age: 99 })
      await tx.update(users).set({ name: "Also Rolled Back" }).where(eq(users.id, "tx-1"))
      throw new Error("intentional failure")
    })
  } catch { /* expected */ }

  const after = await db.select().from(users)
  assert(after.length === 1,                               "rollback — count restored")
  assert(!after.some(u => u.id === "tx-2"),                "rollback — insert undone")
  assert(after[0].name === "Tx Alice",                     "rollback — update undone")
}

async function testIfMatch() {
  console.log("\nif-match (two concurrent writes — one should 412 if Vercel honors it)")
  await wipe()

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

  if (!conflictDetected) console.log("  ⚠  no 412 — Vercel ignores If-Match (last-write-wins active)")

  const final = await db.select().from(users).where(eq(users.name, "Concurrent"))
  assert(final.length === 1,                           "row still exists")
  assert([2, 3].includes(final[0].age as number), `age is ${final[0].age}`)
}

async function main() {
  try {
    await testCrud()
    await testUpsert()
    await testJoins()
    await testTransaction()
    await testIfMatch()
    await wipe()
    console.log("\ndone.\n")
  } catch (e) {
    console.error("\nunhandled error:", e)
    process.exit(1)
  }
}

main()
