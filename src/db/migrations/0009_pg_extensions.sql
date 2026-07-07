-- Custom SQL migration file, put your code below! --

-- pgvector: product embeddings for semantic search
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
-- pg_trgm: fuzzy/trigram matching over product names and aliases
CREATE EXTENSION IF NOT EXISTS pg_trgm;
