-- Custom SQL migration file, put your code below! --

-- HNSW index for cosine similarity over product embeddings.
CREATE INDEX IF NOT EXISTS product_embedding_hnsw_idx
  ON product USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
-- Trigram GIN indexes for fuzzy lexical matching (misspellings, partial names).
CREATE INDEX IF NOT EXISTS product_search_text_trgm_idx
  ON product USING gin (search_text gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_alias_trgm_idx
  ON product_alias USING gin (alias gin_trgm_ops);
