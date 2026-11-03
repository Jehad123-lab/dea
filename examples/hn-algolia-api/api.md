# API map: All | Search powered by Algolia

Observed while DEA loaded and scrolled https://hn.algolia.com/. OpenAPI 3.1: `api/openapi.json`.

| method | endpoint | calls | status | auth | called from |
|---|---|---|---|---|---|
| POST | uj5wyc0l7x-dsn.algolia.net/1/indexes/Item_dev/query | 1 | 200 | query x-algolia-api-key | webpack://static/scripts/providers/SearchProvider.tsx:177 (SearchProvider) |
| GET | t5-eu-1.algolia.net/1/isalive | 1 | 200 | none seen | webpack://static/scripts/providers/SearchProvider.tsx:104 (SearchProvider) |
| GET | t32-usw-1.algolia.net/1/isalive | 1 | 200 | none seen | webpack://static/scripts/providers/SearchProvider.tsx:104 (SearchProvider) |
| GET | t6-eu-1.algolia.net/1/isalive | 1 | -1 | none seen | webpack module 832:2:7972 (h.enqueue.T.url) |
| GET | c3-de-1.algolia.net/1/isalive | 1 | 200 | none seen | webpack module 832:2:7972 (h.enqueue.T.url) |
| GET | t5-in-1.algolia.net/1/isalive | 1 | 200 | none seen | webpack module 832:2:7972 (h.enqueue.T.url) |

### POST uj5wyc0l7x-dsn.algolia.net/1/indexes/Item_dev/query

Example: `https://uj5wyc0l7x-dsn.algolia.net/1/indexes/Item_dev/query?x-algolia-agent=Algolia+for+JavaScript+%284.13.1%29%3B+Browser+%28lite%29&x-algolia-api-key=%5Bredacted+by+dea%5D&x-algolia-application-id=UJ5WYC0L7X`
Response keys: hits, nbHits, page, nbPages, hitsPerPage, exhaustiveNbHits, exhaustiveTypo, exhaustive, query, params, queryID, serverUsed

### GET t5-eu-1.algolia.net/1/isalive

Example: `https://t5-eu-1.algolia.net/1/isalive?probe=1`
Response keys: message

### GET t32-usw-1.algolia.net/1/isalive

Example: `https://t32-usw-1.algolia.net/1/isalive?probe=1`
Response keys: message

### GET c3-de-1.algolia.net/1/isalive

Example: `https://c3-de-1.algolia.net/1/isalive?probe=1`
Response keys: message

### GET t5-in-1.algolia.net/1/isalive

Example: `https://t5-in-1.algolia.net/1/isalive?probe=1`
Response keys: message

## Analytics / telemetry (3)

- POST www.google-analytics.com/g/collect ×2
- GET telemetry.algolia.com/1/settings ×1
- POST www.google-analytics.com/j/collect ×1

Auth values, cookies and tokens are never saved; only their kind is noted.
