import Container from '@/components/layout/container';
import { PricingHero } from '@/components/pricing/pricing-hero';

export default async function PricingPage() {
  return (
    <Container className="mt-12 max-w-6xl px-4 pb-8">
      <PricingHero />
    </Container>
  );
}
