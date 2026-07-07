/**
 * Seed script for local development.
 *
 * Usage: pnpm seed
 *
 * Creates two isolated demo stores so tenant isolation is testable from day
 * one (requirements §5):
 * - demo.localhost:3000  — Demo Market  (owner demo-owner@example.test,  PIN 1234)
 * - mart2.localhost:3000 — Second Mart  (owner mart2-owner@example.test, PIN 5678)
 *
 * Both owners use password: Demo12345678!
 * Idempotent: safe to run repeatedly.
 */
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const OWNER_PASSWORD = 'Demo12345678!';

const STORES = [
  {
    handle: 'demo',
    displayName: 'Demo Market',
    displayNameZh: '示范超市',
    announcement: 'Fresh produce arrives every Tuesday!',
    announcementZh: '每周二新鲜蔬果到货！',
    ownerEmail: 'demo-owner@example.test',
    ownerName: 'Demo Owner',
    pin: '1234',
    shelves: [
      { code: 'A1', label: 'Produce', labelZh: '蔬果' },
      { code: 'A2', label: 'Snacks', labelZh: '零食' },
      { code: 'B1', label: 'Rice & Noodles', labelZh: '米面' },
      { code: 'B2', label: 'Canned Food', labelZh: '罐头' },
      { code: 'B3', label: 'Condiments', labelZh: '调味品' },
      { code: 'B4', label: 'Sauces', labelZh: '酱料' },
      { code: 'C1', label: 'Frozen', labelZh: '冷冻' },
      { code: 'C2', label: 'Drinks', labelZh: '饮料' },
    ],
  },
  {
    handle: 'mart2',
    displayName: 'Second Mart',
    displayNameZh: '二号超市',
    announcement: null,
    announcementZh: null,
    ownerEmail: 'mart2-owner@example.test',
    ownerName: 'Mart2 Owner',
    pin: '5678',
    shelves: [
      { code: 'D1', label: 'Household', labelZh: '日用品' },
      { code: 'D2', label: 'Snacks', labelZh: '零食' },
    ],
  },
];

async function main() {
  const { getDb } = await import('../src/db');
  const { account, store, shelf, user } = await import('../src/db/schema');
  const { hashPin } = await import('../src/lib/pin');
  const { hashPassword } = await import('better-auth/crypto');
  const { eq } = await import('drizzle-orm');
  const { nanoid } = await import('nanoid');

  const db = await getDb();

  for (const def of STORES) {
    // --- owner user ---
    let ownerId: string;
    const existingUser = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, def.ownerEmail))
      .limit(1);

    if (existingUser.length > 0) {
      ownerId = existingUser[0].id;
      console.log(`seed: user ${def.ownerEmail} already exists`);
    } else {
      // Insert the user + credential account directly, using better-auth's
      // own password hasher so real logins work against the seeded rows.
      ownerId = nanoid();
      const now = new Date();
      await db.insert(user).values({
        id: ownerId,
        name: def.ownerName,
        email: def.ownerEmail,
        normalizedEmail: def.ownerEmail,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(account).values({
        id: nanoid(),
        accountId: ownerId,
        providerId: 'credential',
        userId: ownerId,
        password: await hashPassword(OWNER_PASSWORD),
        createdAt: now,
        updatedAt: now,
      });
      console.log(`seed: created user ${def.ownerEmail}`);
    }

    // --- store ---
    const existingStore = await db
      .select({ id: store.id })
      .from(store)
      .where(eq(store.handle, def.handle))
      .limit(1);

    let storeId: string;
    if (existingStore.length > 0) {
      storeId = existingStore[0].id;
      console.log(`seed: store ${def.handle} already exists`);
    } else {
      storeId = nanoid();
      await db.insert(store).values({
        id: storeId,
        handle: def.handle,
        ownerUserId: ownerId,
        displayName: def.displayName,
        displayNameZh: def.displayNameZh,
        announcement: def.announcement,
        announcementZh: def.announcementZh,
        staffPinHash: await hashPin(def.pin),
      });
      console.log(`seed: created store ${def.handle} (PIN ${def.pin})`);
    }

    // --- shelves ---
    const shelfCount = await db
      .select({ id: shelf.id })
      .from(shelf)
      .where(eq(shelf.storeId, storeId));
    if (shelfCount.length === 0) {
      for (const [i, s] of def.shelves.entries()) {
        await db.insert(shelf).values({
          id: nanoid(),
          storeId,
          code: s.code,
          label: s.label,
          labelZh: s.labelZh,
          sortOrder: i,
        });
      }
      console.log(
        `seed: created ${def.shelves.length} shelves for ${def.handle}`
      );
    } else {
      console.log(`seed: shelves for ${def.handle} already exist`);
    }
  }

  console.log('seed: done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
