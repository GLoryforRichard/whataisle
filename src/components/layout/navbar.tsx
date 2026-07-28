'use client';

import { LoginWrapper } from '@/components/auth/login-wrapper';
import Container from '@/components/layout/container';
import { Logo } from '@/components/layout/logo';
import { NavbarMobile } from '@/components/layout/navbar-mobile';
import { UserButton } from '@/components/layout/user-button';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavbarLinks } from '@/config/navbar-config';
import { useScroll } from '@/hooks/use-scroll';
import { LocaleLink, useLocalePathname } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';
import { ArrowUpRightIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { LocaleSwitcher } from './locale-switcher';

interface NavBarProps {
  scroll?: boolean;
}

export function Navbar({ scroll = true }: NavBarProps) {
  const t = useTranslations();
  const scrolled = useScroll(50);
  const menuLinks = useNavbarLinks();
  const localePathname = useLocalePathname();
  const [mounted, setMounted] = useState(false);
  const [menuValue, setMenuValue] = useState<string | undefined>(undefined);
  const { data: session, isPending } = authClient.useSession();
  const currentUser = session?.user;
  const showBarBg = scroll && scrolled;

  // Sync mount (avoid auth hydration mismatch) and close menu on route change
  useEffect(() => {
    setMounted(true);
    setMenuValue(undefined);
  }, [localePathname]);

  return (
    // Thin full-width brand strip — the page below is pure white, so the
    // strip and the footer are the only two dark anchors on the page.
    <header className="sticky inset-x-0 top-0 z-40">
      <div
        className={cn(
          'bg-[var(--brand)] text-[var(--brand-paper)] transition-shadow duration-300',
          showBarBg &&
            'shadow-[0_6px_20px_color-mix(in_srgb,var(--brand-ink)_16%,transparent)]'
        )}
      >
        <Container className="px-3 sm:px-6">
          <div className="py-2.5">
            {/* desktop navbar */}
            <nav
              aria-label="Main navigation"
              className="hidden lg:flex lg:items-center lg:justify-between lg:gap-4"
            >
              <LocaleLink
                href="/"
                aria-label="Home"
                className="flex items-center gap-2 shrink-0"
              >
                <Logo />
                <span className="text-xl font-semibold">
                  {t('Metadata.name')}
                </span>
              </LocaleLink>

              <NavigationMenu
                value={menuValue}
                onValueChange={setMenuValue}
                className="flex-1 justify-center"
              >
                <NavigationMenuList aria-orientation={undefined}>
                  {menuLinks?.map((item) =>
                    item.items ? (
                      <NavigationMenuItem key={item.title} value={item.title}>
                        <NavigationMenuTrigger
                          className={cn(
                            'bg-transparent',
                            item.items.some((sub) =>
                              sub.href
                                ? localePathname.startsWith(sub.href)
                                : false
                            ) && 'font-semibold text-foreground'
                          )}
                        >
                          {item.title}
                        </NavigationMenuTrigger>
                        <NavigationMenuContent>
                          <ul className="grid w-100 gap-3 p-3 md:w-125 md:grid-cols-2 lg:w-150">
                            {item.items.map((sub) => {
                              const isSubActive =
                                sub.href && localePathname.startsWith(sub.href);
                              return (
                                <li key={sub.title}>
                                  <NavigationMenuLink asChild>
                                    <LocaleLink
                                      href={sub.href ?? '#'}
                                      target={
                                        sub.external ? '_blank' : undefined
                                      }
                                      rel={
                                        sub.external
                                          ? 'noopener noreferrer'
                                          : undefined
                                      }
                                      onClick={() => setMenuValue(undefined)}
                                      className={cn(
                                        'group flex select-none flex-row items-center gap-4 rounded-md',
                                        'p-2 leading-none no-underline outline-hidden transition-colors',
                                        'hover:bg-accent hover:text-accent-foreground',
                                        'focus:bg-accent focus:text-accent-foreground',
                                        isSubActive &&
                                          'bg-accent text-accent-foreground'
                                      )}
                                    >
                                      {sub.icon ? (
                                        <div className="size-4 shrink-0">
                                          {sub.icon}
                                        </div>
                                      ) : null}
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium">
                                          {sub.title}
                                        </div>
                                        {sub.description ? (
                                          <p className="text-xs text-muted-foreground">
                                            {sub.description}
                                          </p>
                                        ) : null}
                                      </div>
                                      {sub.external ? (
                                        <ArrowUpRightIcon className="size-4 shrink-0" />
                                      ) : null}
                                    </LocaleLink>
                                  </NavigationMenuLink>
                                </li>
                              );
                            })}
                          </ul>
                        </NavigationMenuContent>
                      </NavigationMenuItem>
                    ) : (
                      <NavigationMenuItem key={item.title}>
                        <NavigationMenuLink
                          asChild
                          className={cn(
                            navigationMenuTriggerStyle(),
                            // Brand strip: white text throughout (accent as
                            // text fails contrast on warm palettes); the
                            // active page gets an accent underline instead.
                            'bg-transparent text-base text-[var(--brand-paper)]/85',
                            'hover:bg-white/10 hover:text-white',
                            'focus:bg-white/10 focus:text-white',
                            item.href &&
                              (item.href === '/'
                                ? localePathname === '/'
                                : localePathname.startsWith(item.href)) &&
                              'font-semibold text-white underline decoration-2 decoration-[var(--brand-accent)] underline-offset-8'
                          )}
                        >
                          <LocaleLink
                            href={item.href || '#'}
                            target={item.external ? '_blank' : undefined}
                            rel={
                              item.external ? 'noopener noreferrer' : undefined
                            }
                          >
                            {item.title}
                          </LocaleLink>
                        </NavigationMenuLink>
                      </NavigationMenuItem>
                    )
                  )}
                </NavigationMenuList>
              </NavigationMenu>

              <div className="flex shrink-0 items-center gap-3 text-[var(--brand-paper)]">
                <LocaleSwitcher />
                {!mounted || isPending ? (
                  <Skeleton className="size-8 rounded-full bg-white/15" />
                ) : currentUser ? (
                  <UserButton user={currentUser} />
                ) : (
                  <>
                    <LoginWrapper mode="modal" asChild>
                      <button
                        type="button"
                        className="inline-flex h-9 cursor-pointer items-center rounded-full border border-[var(--brand-paper)]/30 bg-transparent px-4 font-semibold text-[var(--brand-paper)] text-base transition-colors hover:border-white hover:text-white"
                      >
                        {t('Common.login')}
                      </button>
                    </LoginWrapper>
                    <LocaleLink
                      href={Routes.Register}
                      className="inline-flex h-9 items-center rounded-full bg-[var(--brand-accent)] px-4 font-bold text-[var(--brand-ink)] text-base transition-colors hover:bg-[var(--brand-accent-hover)]"
                    >
                      {t('Common.signUp')}
                    </LocaleLink>
                  </>
                )}
              </div>
            </nav>

            {/* mobile navbar */}
            <NavbarMobile className="lg:hidden" />
          </div>
        </Container>
      </div>
    </header>
  );
}
