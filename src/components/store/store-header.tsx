import { StoreLocaleToggle } from '@/components/store/store-locale-toggle';

interface StoreHeaderProps {
  displayName: string;
  logoKey: string | null;
}

/**
 * Store-branded header: the shopper page must look like the store's own
 * service (requirements §9), so the store name leads and the platform mark
 * stays in the footer.
 */
export function StoreHeader({ displayName, logoKey }: StoreHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-foreground border-b bg-[var(--background)]">
      <div className="mx-auto flex h-15 max-w-2xl items-center justify-between px-4">
        <a href="/" className="flex min-w-0 items-center gap-2">
          {/* Logo upload lands in Phase 5; until then the name is the brand.
              Quiet cream header with an ink hairline — wherebear never fills
              page headers, and the multiply bear couldn't sit on orange. */}
          <span className="wa-display truncate font-bold text-foreground text-lg">
            {displayName}
          </span>
        </a>
        <StoreLocaleToggle />
      </div>
    </header>
  );
}
