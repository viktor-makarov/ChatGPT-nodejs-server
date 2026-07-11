# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A production Telegram bot (CommonJS Node.js, no framework) that proxies the OpenAI Responses API with multi-provider AI, streaming, tool/function calling, MCP servers, media ingestion (voice/audio/video/image/document), TTS/STT, document generation, and admin/reporting. State lives in MongoDB; media in S3 and OpenAI File Storage.

There is no HTTP web framework — the app is driven entirely by the Telegram bot event loop (long-polling by default, optional webhook).

## Commands

```bash
npm start        # run the bot (node bin/www_prod.js) — same as `npm run dev`
npm test         # runs the MCP integration test (test:mcp)
npm run test:mcp # NODE_ENV=test; hits the REAL https://mcp.deepwiki.com/mcp endpoint over the network
npm run deps:unused  # depcheck for unused dependencies
```

There is no build step, no linter, and no unit-test framework. `npm test` runs a single hand-rolled integration script (`tests/intergarion_tests/mcpAPIIntegration.tests.js`) with its own timeout/retry harness — it makes real HTTP calls, so failures may be network-related. Env vars `DEEPWIKI_TEST_TIMEOUT_MS` and `DEEPWIKI_TEST_RETRIES` tune it.

Requires a `.env` file in the repo root (loaded via `dotenv` at the top of `bin/www_prod.js`). See the README "Environment Variables" section for the required keys (Telegram token, OpenAI, Mongo connection, ElevenLabs, Discord/Midjourney, AWS/S3, auth keys). Running requires a reachable MongoDB and, for browser tools, Chromium (Puppeteer).

## Runtime & startup

`bin/www_prod.js` is the single entry point for both dev and prod. On startup it:
1. Loads `.env`, then parses `config/main_config.yml` into `global.appsettings`.
2. Connects Mongo → `global.mongoConnection`, launches headless Chromium → `global.chromeBrowserHeadless`.
3. Creates the Telegram bot → `global.bot` (webhook if `WEBHOOK_ENABLED==="true"`, else long-polling).
4. Sets bot commands/descriptions, refreshes OpenAI/ElevenLabs model & voice lists into DB and globals, then starts the router.

It installs `SIGINT`/`SIGTERM`/`uncaughtException` handlers that call `mongo.resetAllInProgressDialogueMeta()` and close browser + Mongo — important because dialogue "in progress" flags are persisted and would otherwise wedge users on an unclean exit.

Note: startup reads `config/main_config.yml`, but `config/main_config.yml.prod` also exists in the repo — confirm which file is authoritative before editing config values.

## Global state (read these before touching startup/config)

The app leans heavily on Node globals set at startup — assume they exist in any module:
`global.appsettings` (parsed YAML config), `global.bot`, `global.mongoConnection`, `global.chromeBrowserHeadless`, `global.serverInstanceId`, `global.completionInstances` (map of active `Completion` instances by short id), `global.elevenlabs_models`, `global.elevenlabs_voices`.

## Architecture (the request pipeline)

The core is a fan-out of collaborating classes in `components/objects/`, wired together per incoming event. Trace a message this way:

1. **`components/mainRouter.js` → `eventRouter`** — the single handler for `message`, `callback_query`, and `inline_query`. Builds `User` (loads profile from DB), `RequestMsg`, `ReplyMsg`, runs auth (`requestMsg.authenticateRequest()`), then constructs a `Dialogue` and an `ErrorHandler`. Dispatches by `requestMsg.inputType` (`text_command`, `file`, `text_message`, `callback_query`, `pinned_message`) to a handler in `msgRouter.js`. Handlers return an array of `responses`, which `eventRouter` renders — including chunking messages longer than `big_outgoing_message_threshold` and special `operation` verbs (`updatePinnedMsg`, `closeMessage`, `updateSettings`, etc.).

2. **`components/msgRouter.js`** — the command/message/file/callback routers. This is where regime logic, file ingestion (STT via ElevenLabs with OpenAI Whisper fallback, uploads to S3 + OpenAI storage), admin commands, and settings live. Handlers mutate the `Dialogue` and then call `dialogue.triggerCallCompletion()`.

3. **`components/objects/Dialogue.js`** — owns dialogue state and the persisted **meta** document (`dialogue_meta` collection): token counts, in-progress/failed-run flags, image/pdf input limits, Midjourney button state. `triggerCallCompletion()` reloads user + meta, refuses if a function is already in progress, then creates a `Completion` and calls `completion.router()`.

4. **`components/objects/Completion.js`** — an `EventEmitter` that drives the streaming OpenAI call (`openAI_API.responseStream`), parses the streamed chunks, and orchestrates tool execution. It manages several `AsyncQueue` instances (reasoning, code interpreter, image generation, MCP calls) to serialize long-running work, tracks previous message versions (for regenerate), timeouts, and long-wait notices. This is the largest and most intricate file — expect heavy use of private fields and streaming chunk state machines.

5. **`components/objects/FunctionCall.js` + `AvailableTools.js` + `Agents.js`** — tool calling. `AvailableTools` defines every tool (hosted OpenAI tools, custom functions, MCP servers) with per-tool metadata (`availableForUserGroups`, `enabled`, `timeout_ms`, `try_limit`, `category`). `Agents` defines built-in "agents" — each a named bundle of `model_modes` (e.g. fast/clever, mapping to a model + reasoning effort) and an allowed `tools` list. The active agent + user group filter which tools are offered to the model. `FunctionCall` executes a resolved tool call.

6. **`components/objects/ReplyMsg.js`** — all outbound Telegram I/O (send/edit/delete/pin, chunking, transcripts, wait messages).

7. **`components/objects/ErrorHandler.js`** — centralized error handling; errors carry flags like `place_in_code`, `sendToUser`, `adminlog`, `mongodblog` to control routing/logging.

## APIs and integrations (`components/apis/`)

Each external service is wrapped in its own module: `openAI_API.js` (Responses API streaming + sync, files, STT/TTS, models), `elevenlabs_API.js`, `AWS_API.js` (S3), `mongo.js` (all queries) + `mongoClient.js` (connection) + `mongo_Schemas.js`, `mcp_tools_API.js` (MCP client via `@modelcontextprotocol/sdk`, exposes `_test` internals for the integration test), `chromeBrowser.js` + `WebBrowser.js` (Puppeteer automation), `midjourney_API.js`/`piapi.js` (image gen via Discord), `google_API.js` (DocumentAI OCR), `cbr_API.js`/`exchangerate_API.js` (currency).

MCP client transports are lazily `import()`-ed in `components/moduleImports.js` (the SDK is ESM; the app is CommonJS). Per-user MCP tools are refreshed on an interval (`mcp_options.tools_update_interval_ms`) and tokens are stored per user profile, injected dynamically.

## Configuration (`config/`)

Behavior is heavily config-driven — prefer changing config over hardcoding:
- `main_config.yml` → `global.appsettings`: Mongo db/collection names, thresholds, function/file/MCP options, Telegram command definitions, TTS defaults.
- `modelConfig.js`: per-model capabilities and limits (token/image/pdf limits, `reasoning`, `canUseTool`/`canUseTemperature`/`canUseReasoning`, `includeUsage`, `timeout_ms`, localized `long_wait_notes`). Adding/changing a model means editing this.
- `developerPrompts.js` (system prompts), `telegramModelsSettings.js`, `telegramMsgTemplates.js` (bilingual user-facing strings), `telegramReportsConfig.js`, `replacement_lists.js`.

## Conventions

- **Language:** code comments and some log messages are in Russian; user-facing text is bilingual (`_ru`/`_en` fields, or looked up via `getLocalizedPhrase`/localized templates by `user.language`). Match this when editing.
- **Persistence-first flow:** dialogue progress, function-call queues, temp resources, and reply-markup are persisted to Mongo mid-flight (many `col_*`/`coll_*` collections). Long-running tool calls run through `AsyncQueue` and set in-progress flags that gate new completions — be careful not to leave these set.
- **Private fields:** the `objects/` classes make extensive use of `#privateField` state; read the field declarations at the top of a class before modifying its methods.
- **Media size limits** and MIME allow/deny lists live in `modelConfig.js` and `main_config.yml.file_options` — validation happens in `RequestMsg`/`msgRouter` before upload.

## Deployment

Dockerized (`Dockerfile`, node:24-alpine + Chromium + fonts; `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`). `docker-compose.yml` runs `node ./bin/www_prod` from an ECR image. `NODE_ENV=production` in the container.
