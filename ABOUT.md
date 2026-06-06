# hearthstone

> Household-knowledge RAG assistant that gives babysitters and family instant, cited answers drawn from the owner's Google Docs.

**Family:** products · **Type:** service · **Lifecycle:** production · **Owner:** mhat

## What it does
Hearthstone lets household owners connect their Google Docs once, pick which docs to index, and invite guests via a six-digit PIN (with QR code). Guests ask plain-language questions and get answers grounded in the indexed documents, with citations back to the source. It is a Bun/TypeScript backend (HTTP API, SQLite + sqlite-vec vector search, Google Drive ingestion, OpenAI embeddings and chat) paired with a native iOS (Swift) client.

## How it fits
- Depends on: — (no internal prime-radiant-inc code or service dependencies; manifest deps are all external)
- Used by: —
- External: OpenAI API (embeddings + chat, GPT-5.4 / text-embedding-3-small), Google Drive / Google OAuth, Fly.io (deploy target), OpenTelemetry (tracing)

## Runtime & data
- Runs: Bun HTTP server (Dockerfile + fly.toml.example, Fly.io) plus an iOS app built with Xcode
- Data in: Google Docs content via Drive API; guest questions
- Data out: SQLite database (households, documents, embeddings, PINs); cited chat answers to the iOS/web clients

<!-- Maintained by the maintaining-project-map skill. Do not hand-edit; regenerated. -->
