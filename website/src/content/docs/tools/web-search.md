---
title: Web Search
description: Web search routing, configuration, and usage within Feynman.
section: Tools
order: 2
---

Feynman's web research tools retrieve current information and source text during research workflows. They support multiple simultaneous queries, simultaneous all-provider search, domain filtering, recency filtering, provider-available page-text retrieval, raw or question-grounded page retrieval, direct images, and passage lookup inside stored page content. The researcher agent uses them alongside AlphaXiv to gather evidence from non-academic sources like blog posts, documentation, news, and code repositories.

## Routing modes

The bundled `pi-web-access` package can choose one provider, follow a configured fallback route, or query every eligible provider simultaneously:

| Mode | Description |
| --- | --- |
| `auto` | Follow the available-provider fallback route |
| `all` | Query every eligible provider except explicit-only DuckDuckGo, AnySearch, xAI, Bright Data, and SerpBase; preserve partial successes and deduplicate sources |
| `duckduckgo` | Force keyless DuckDuckGo HTML search; also available inside an explicit fallback route |
| `tinyfish` | Force TinyFish Search; also enables TinyFish Fetch as a hosted extraction fallback |
| `kagi` | Force Kagi Search; also enables Kagi Extract as a hosted extraction fallback |
| `bocha` | Force Bocha Search; accepts `bochaApiKey` or `BOCHA_API_KEY` |
| `ollama` | Force Ollama Cloud Web Search; also enables Ollama Web Fetch as an extraction fallback |
| `perplexity` | Force Perplexity Sonar for all web searches |
| `exa` | Force Exa for all web searches |
| `gemini` | Force Gemini API grounding |
| `jina` | Force Jina Search; can return provider-fetched page Markdown with results |
| `xai` | Explicit-only xAI/Grok hosted search |
| `brightdata` | Explicit-only Bright Data SERP search; requires a SERP zone |
| `serpbase` | Explicit-only SerpBase Google SERP search |

## Default behavior

The default path does not read Chromium or Chrome cookies and does not request macOS Keychain access. With no explicit provider or custom `searchRouting`, `auto` tries configured SearXNG first, then eligible OpenAI, Exa, Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Jina, SERPdive, Kagi, Bocha, Ollama, Perplexity, and Gemini routes in order.

Configure an explicit API key for Exa, Perplexity, TinyFish, Jina, or Gemini in `~/.feynman/web-search.json` before running source-heavy workflows like `/deepresearch`. Exa's zero-config MCP fallback remains available without a key.

## Configuration

Check the current search configuration:

```bash
feynman search status
```

Edit `~/.feynman/web-search.json` to configure the backend:

```json
{
  "provider": "auto",
  "searchProvider": "auto",
  "exaApiKey": "exa_...",
  "perplexityApiKey": "pplx-...",
  "tinyfishApiKey": "sk-tinyfish-...",
  "jinaApiKey": "jina_...",
  "geminiApiKey": "AIza...",
  "datalabApiKey": "$DATALAB_API_KEY",
  "kagiApiKey": "kagi-...",
  "bochaApiKey": "sk-bocha-...",
  "ollamaApiKey": "ollama-...",
  "maxInlineContentChars": 30000,
  "pdf": {
    "enabled": true,
    "provider": "auto",
    "datalabMode": "balanced",
    "datalabTimeoutMs": 120000
  },
  "summaryGenerationDeadlineMs": 30000,
  "tools": {
    "webSearch": { "enabled": true },
    "sourceCheck": { "enabled": true },
    "fetchContent": { "enabled": true },
    "getSearchContent": { "enabled": true }
  },
  "commands": {
    "websearch": { "enabled": true },
    "curator": { "enabled": true },
    "web-results": { "enabled": true },
    "google-account": { "enabled": true }
  },
  "image": { "enabled": true }
}
```

Set `provider` and `searchProvider` to `all` to query every eligible provider concurrently, or to a specific `pi-web-access` provider such as `tinyfish`, `jina`, `kagi`, `bocha`, `ollama`, `exa`, `perplexity`, or `gemini`. `searchRouting` instead defines an ordered fallback route; `all` is not valid inside that sequential list. DuckDuckGo, AnySearch, xAI, Bright Data, and SerpBase must be selected explicitly and do not participate in `all`. The `feynman search set <provider> [api-key]` convenience command supports `auto`, `exa`, `perplexity`, and `gemini`; edit the JSON directly for the broader upstream provider set. Jina also accepts `JINA_API_KEY`, supports domain and recency constraints, and can return inline page content.

DuckDuckGo is keyless but explicit-only. Select `"duckduckgo"` directly, or add it to `searchRouting.providers`. It does not run in `auto` or `all`.

For PDF links, `pdf.provider: "auto"` tries Datalab when `DATALAB_API_KEY` or `datalabApiKey` is available, then Gemini, then local PDF.js extraction. Set `pdf.provider` to `"datalab"`, `"gemini"`, or `"unpdf"` to select one tier. Datalab is an optional hosted service; the no-key local path remains available.

Self-hosted SearXNG can use `searxngHeaders` for reverse-proxy or Zero Trust authentication. Bright Data search requires `brightdataSerpZone`; its optional Web Unlocker extraction fallback uses a separate `brightdataUnlockerZone`.

Set `firecrawlBaseUrl` or `FIRECRAWL_BASE_URL` for self-hosted Firecrawl. The configured API may use `localhost`, `127.0.0.0/8`, or `::1`. Loopback redirects must stay on that configured API origin. Submitted fetch and search targets still reject loopback addresses.

To route OpenAI `web_search` and `source_check` calls through a third-party gateway, set `openaiResponsesUrl` to the gateway's full Responses-compatible endpoint. The default remains OpenAI's official Responses endpoint.

Gemini Web browser-cookie access is disabled by default. To opt into that legacy fallback, add `"geminiBrowser": true` to `~/.feynman/web-search.json`. On macOS, that can trigger a Keychain prompt from the browser's cookie store. On Windows, the opt-in path can read Chrome or Edge `v10` cookies through current-user DPAPI. Chromium `v20` app-bound cookies are unsupported and fail closed. API keys remain the recommended route.

Set `enabled` to `false` for one `tools` or `commands` entry to skip that registration after restart. `webSearch.enabled: false` remains a legacy shorthand for disabling `web_search` and `source_check` when no tool-specific override exists. Feynman uses the `web-results` command key because `/search` belongs to research-session search. Set `image.enabled: false` to block direct images, video frames, and thumbnails. Set `pdf.enabled: false` to block PDF extraction.

`summaryGenerationDeadlineMs` limits one curator or auto-summary model attempt. It defaults to 30,000 ms, accepts positive integers, and caps values at 600,000 ms.

`maxInlineContentChars` sets the default and maximum text slice returned by `fetch_content` and `get_search_content`. It defaults to 30,000 characters and caps values at 200,000.

## Search features

The web search tool supports several capabilities that the researcher agent leverages automatically:

- **Multiple queries** -- Send 2-4 varied-angle queries simultaneously for broader coverage of a topic
- **Domain filtering** -- Restrict results to specific domains like `arxiv.org`, `github.com`, or `nature.com`
- **Recency filtering** -- Filter results by date, useful for fast-moving topics where only recent work matters
- **Page text retrieval** -- Fetch provider-available page text for the most important results rather than relying only on snippets
- **Raw HTTP text** -- Use `fetch_content` with `mode: "raw"` to inspect textual API responses, error pages, or other source bytes without article extraction
- **Bounded readable text** -- Readable extraction replaces inline `data:` URI payloads with explicit omission markers before model or cache storage; raw mode preserves the exact textual body
- **Page-grounded answers** -- Use `fetch_content` with `mode: "answer"` and a question to answer against one page while retaining the original page text for inspection
- **Direct images** -- Retrieve PNG, JPEG, WebP, and GIF links as safely bounded inline images
- **Passage lookup** -- Use `get_search_content` with `findText` and exact, case-insensitive, or fuzzy `findMode` matching to locate a passage in stored content without paging through the entire page
- **Clean continuation** -- Every single-page fetch reports its stored response ID, and long pages also report character, byte, line, and next-offset details

Fetched page bodies live for one hour in `~/.feynman/web-search-cache/`, beside `web-search.json`. The cache keeps at most 128 entries and 128 MiB, evicting the oldest entries first. On macOS and Linux, Feynman keeps its directory at mode `0700` and files at `0600`. Session JSONL stores only bounded URL metadata and a private cache reference. Custom `FEYNMAN_WEB_SEARCH_CONFIG` paths move the cache beside that exact file.

For `get_search_content`, `findText` cannot be combined with `offset` or `limit`. `findMode` requires `findText`. Use one of `url`, `urlIndex`, `query`, or `queryIndex` to select stored content when the response contains multiple items.

## When it runs

Web search is used automatically by researcher agents during workflows. You do not need to invoke it directly. The researcher decides when to use web search versus paper search based on the topic and source availability. Academic topics lean toward AlphaXiv; engineering and applied topics lean toward web search.
