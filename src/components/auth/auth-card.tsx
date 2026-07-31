'use client';

import { BottomLink } from '@/components/auth/bottom-link';
import { BearFace } from '@/components/layout/bear-face';
import { Wordmark } from '@/components/layout/wordmark';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { LocaleLink } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

interface AuthCardProps {
  children: React.ReactNode;
  headerLabel: string;
  bottomButtonLabel: string;
  bottomButtonHref: string;
  className?: string;
}

export const AuthCard = ({
  children,
  headerLabel,
  bottomButtonLabel,
  bottomButtonHref,
  className,
}: AuthCardProps) => {
  return (
    <Card className={cn('shadow-xs border border-border', className)}>
      <CardHeader className="flex flex-col items-center">
        <LocaleLink
          href="/"
          prefetch={false}
          className="mb-2 flex flex-col items-center gap-1.5"
        >
          <BearFace size={48} />
          <Wordmark size="lg" />
        </LocaleLink>
        <CardDescription>{headerLabel}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      <CardFooter>
        <BottomLink label={bottomButtonLabel} href={bottomButtonHref} />
      </CardFooter>
    </Card>
  );
};
