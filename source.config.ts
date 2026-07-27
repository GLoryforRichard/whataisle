import {
  defineCollections,
  defineConfig,
  frontmatterSchema,
} from 'fumadocs-mdx/config';
import { z } from 'zod';

/**
 * https://fumadocs.dev/docs/mdx
 *
 * Disable fetching external image sizes to avoid network errors during local dev.
 * External CDN images (e.g. cdn.mksaas.com) will be handled by next/image at runtime.
 */
export default defineConfig({
  mdxOptions: {
    remarkImageOptions: {
      external: false,
    },
  },
});

/**
 * Pages, like privacy policy, terms of service, etc.
 *
 * title is required, but description is optional in frontmatter
 */
export const pages = defineCollections({
  type: 'doc',
  dir: 'content/pages',
  schema: frontmatterSchema.extend({
    date: z.string().date(),
    published: z.boolean().default(true),
  }),
});
