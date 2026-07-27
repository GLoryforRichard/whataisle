import { listCommercialOnboarding } from '@/actions/commercial-onboarding';
import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

export default async function CommercialOnboardingPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { leads } = await listCommercialOnboarding();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 lg:px-6">
      <div>
        <h1 className="font-bold text-2xl">Commercial onboarding</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Review demo requests from prospective stores.
        </p>
      </div>

      <section>
        <h2 className="mb-3 font-semibold text-lg">Demo requests</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left">
              <tr>
                <th className="p-3">Store</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Location</th>
                <th className="p-3">Consent</th>
                <th className="p-3">Received</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t align-top">
                  <td className="p-3 font-medium">
                    {lead.storeName}
                    <div className="font-normal text-muted-foreground">
                      {lead.storeCount} store(s) · {lead.preferredLanguage}
                    </div>
                  </td>
                  <td className="p-3">
                    {lead.contactName}
                    <div>
                      <a className="underline" href={`mailto:${lead.email}`}>
                        {lead.email}
                      </a>
                    </div>
                  </td>
                  <td className="p-3">
                    {lead.city}, {lead.province}
                  </td>
                  <td className="p-3">
                    {lead.marketingConsent ? 'Yes' : 'Transactional only'}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {lead.createdAt.toLocaleDateString('en-CA')}
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td
                    className="p-6 text-center text-muted-foreground"
                    colSpan={5}
                  >
                    No demo requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
