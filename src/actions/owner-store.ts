'use server';

import {
  createOwnerMapEntry,
  createOwnerStore,
  getOwnerStore,
  isStoreHandleAvailable,
  listStoreCleanup,
  requestStoreCleanup,
  retryStoreProvisioning,
  updateOwnerStore,
} from '@/data/owner-store';
import { adminActionClient, userActionClient } from '@/lib/safe-action';
import { z } from 'zod';

const name = z.string().trim().min(1).max(100);
const pin = z.string().regex(/^\d{6}$/, 'Enter a six-digit store password');

export const getOwnerStoreAction = userActionClient
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => ({
    success: true,
    store: await getOwnerStore(ctx.user.id),
  }));

export const checkStoreHandleAction = userActionClient
  .inputSchema(z.object({ handle: z.string().min(3).max(30) }))
  .action(async ({ parsedInput }) => ({
    success: true,
    available: await isStoreHandleAvailable(parsedInput.handle),
  }));

export const createOwnerStoreAction = userActionClient
  .inputSchema(
    z
      .object({
        displayName: name,
        handle: z.string().trim().toLowerCase().min(3).max(30),
        pin,
        confirmPin: pin,
        domainConfirmed: z.literal(true),
      })
      .refine(
        (value) => value.pin === value.confirmPin,
        'Store passwords do not match'
      )
  )
  .action(async ({ ctx, parsedInput }) => ({
    success: true,
    ...(await createOwnerStore(ctx.user.id, parsedInput)),
  }));

export const updateOwnerStoreAction = userActionClient
  .inputSchema(
    z
      .object({ displayName: name.optional(), pin: pin.optional() })
      .refine(
        (value) => !!value.displayName || !!value.pin,
        'No changes supplied'
      )
  )
  .action(async ({ ctx, parsedInput }) => {
    await updateOwnerStore(ctx.user.id, parsedInput);
    return { success: true };
  });

export const openOwnerMapAction = userActionClient
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => ({
    success: true,
    url: await createOwnerMapEntry(ctx.user.id),
  }));

export const getStoreCleanupAction = adminActionClient
  .inputSchema(z.object({}))
  .action(async () => ({ success: true, stores: await listStoreCleanup() }));

export const requestStoreCleanupAction = adminActionClient
  .inputSchema(
    z.object({
      storeId: z.string().uuid(),
      confirmation: z.string().min(3).max(30),
    })
  )
  .action(async ({ ctx, parsedInput }) => {
    await requestStoreCleanup(
      ctx.user.id,
      parsedInput.storeId,
      parsedInput.confirmation
    );
    return { success: true };
  });

export const retryStoreProvisioningAction = adminActionClient
  .inputSchema(z.object({ storeId: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    await retryStoreProvisioning(ctx.user.id, parsedInput.storeId);
    return { success: true };
  });
