# Semantic search

Semantic search is optional. The Community default is:

```text
SEMANTIC_SEARCH_ENABLED=false
```

In that mode, Cloud Memory uses D1 lexical and temporal retrieval and makes no Workers AI or Vectorize calls. New and restored memories remain in `pending` vector state.

## Enable it

1. Create or verify a Vectorize index named `ai-cloud-memory` with 768 dimensions and cosine distance.
2. Confirm the `MEMORY_INDEX` and `AI` bindings.
3. Set `SEMANTIC_SEARCH_ENABLED=true`.
4. Deploy.
5. Sign in and choose **Repair index** in Settings until no pending or failed vectors remain.
6. Run the relevance benchmark and compare it with the lexical baseline.

The current embedding model is `@cf/baai/bge-base-en-v1.5`. Changing the model requires an explicit migration plan because vector dimensions and ranking behaviour may change.

## Cost safety

Cloudflare’s allowances and prices can change. Check the official Vectorize and Workers AI pricing before enabling this mode. If an AI or index call fails, D1 remains canonical and writes are retained for later repair.
