import 'server-only';

import { sendEmail } from '@/mail';
import { getBaseUrl } from '@/lib/urls';

/**
 * Tell the owner their store is open for scanning (requirements §6).
 *
 * Publishing the map is the moment their store becomes real, and until this
 * existed nothing said so: the mapping tool's toast claimed "owner notified"
 * while `publishFloorMap` sent nothing at all, so a paying owner could sit
 * indefinitely on a store we had already finished.
 *
 * Never throws — a failed notification must not fail the publish.
 */
export async function notifyStoreReady(params: {
  storeHandle: string;
  storeName: string;
  ownerEmail: string;
  shelfCount: number;
  /** True when the owner still has no staff PIN, which blocks /staff. */
  needsStaffPin: boolean;
}): Promise<void> {
  try {
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const storeUrl = `${protocol}://${params.storeHandle}.${rootDomain}`;
    const base = getBaseUrl();

    // Without a PIN /staff is unusable, and nothing else in the funnel asks
    // for one — so the "you can start scanning" email is the right place.
    const pinStep = params.needsStaffPin
      ? `<li><strong>Set your staff PIN</strong> at <a href="${base}/manage/profile">${base}/manage/profile</a> — your team needs it to open the scanning screen.</li>`
      : '';

    await sendEmail({
      to: params.ownerEmail,
      subject: `${params.storeName} is ready — you can start scanning shelves`,
      html: `
        <p>Your store map is done. ${params.storeName} is live at
        <a href="${storeUrl}">${storeUrl}</a>, and we set up
        ${params.shelfCount} shelves from your walkthrough video.</p>
        <p>To fill it in:</p>
        <ol>
          ${pinStep}
          <li>Open <a href="${storeUrl}/staff">${storeUrl}/staff</a> on a phone and photograph your shelves. Pick a shelf, snap a few photos, save.</li>
          <li>Check the map matches your aisle signs at
          <a href="${base}/manage/map">${base}/manage/map</a>. If a number is
          wrong, send it back and we will redraw it — your store stays open
          either way.</li>
        </ol>
        <p>Print your QR posters from
        <a href="${base}/manage/posters">${base}/manage/posters</a> once a few
        shelves are in.</p>
      `,
    });
  } catch (err) {
    console.error('[store-ready] notification failed:', err);
  }
}
