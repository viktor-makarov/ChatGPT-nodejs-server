# ChatGPT Node.js Telegram Bot

Production chatbot (v1.0.6) with multi‑provider AI, tool calling, MCP servers, media handling, document generation and admin/reporting.

## Core Features
* Streaming OpenAI responses (multi models incl. GPT‑4.1, GPT‑5, O‑series, reasoning where supported).
* Regimes: `chat`, `translator`, `texteditor` (each adjusts system prompts + dialogue handling).
* Voice / video / audio / image / document ingestion; auto transcription (ElevenLabs primary, OpenAI fallback) ≤25MB.
* Long message stitching (>4000 chars) and pinned header updates per regime/model.
* Function/tool calling pipeline (dynamic tool availability, per‑user filtering, hooks for resources & auth).
* Midjourney image generation + custom actions (Discord API) and OpenAI image generation.
* Text‑to‑speech (ElevenLabs + OpenAI) and speech‑to‑text.
* Document & file utilities: content extraction, PDF/HTML compile, Excel creation, multi‑part document assembly, save from temp storage.
* Admin broadcast (/sendtoall, /senttome), reports (/reports), dynamic tools refresh (/updatemcptools), dialogue resets, server control.
* Usage / tokens / credits / errors / function calls logging in MongoDB.

## Tool Categories (Selected)
Hosted: image_generation, code_interpreter, computer_use_preview, web_search_preview.
Custom functions: web_search, web_browser & manage_browser_tabs (real browser automation via Puppeteer), fetch_url_content (text + screenshots), extract_content, generate_document, save_to_document, create_excel_file, create_mermaid_diagram, currency_converter, get_currency_rates, text_to_speech, Midjourney (imagine/custom), knowledge base, user guide, admin analytics (errors / functions / users activity).
MCP servers: deepwiki, github, gmail (session + approval flow, tool listing, per‑user auth & session persistence).

## Architecture Overview
Request flow: Telegram event → `RequestMsg` → auth / regime routing (`msgRouter`) → dialogue mutation (`Dialogue`) → tool decisions (`AvailableTools`) → completion streaming (`openAI_API.responseStream`) → chunked send via `ReplyMsg`.
Dialogue assembly: system prompts (base + datetime + MCP tools) + prior user/assistant/tool entries filtered (limits, reasoning, images, search contexts).
Queues: `AsyncQueue` for serialized long‑running tool calls (e.g. Midjourney). Retry / timeout metadata stored in dialogue.
Storage: MongoDB (users, dialogues, completions, logs, models, voices), S3 (incoming media), OpenAI File Storage (ephemeral user_data), temp local files (debug snapshots). Images / docs optionally embedded as base64 for OpenAI.

## Environment Variables (Essential Subset)
Telegram: `TELEGRAM_BOT_TOKEN` (+ `_PROD`).
OpenAI: `OPENAI_API_KEY`, `OAI_URL`.
Mongo: `MONGODB_CONNECTION` (+ `_PROD` / `_DEV`).
Auth Keys: `REGISTRATION_KEY(_PROD)`, `ADMIN_KEY(_PROD)`.
ElevenLabs: `ELEVENLABS_API_TOKEN`.
Midjourney / Discord: `DISCORD_SERVER_ID`, `DISCORD_CHANNEL_ID`, `DISCORD_SALAI_TOKEN`, `DISCORD_URL` (optional), `HUGGINGFACE_TOKEN`.
AWS / S3: `S3_BUCKET_NAME`, `S3_STORAGE_INCOMINGFILES_FOLDER`.
MCP: tokens per server (stored in user profile, injected dynamically).

## Setup (Dev)
1. Create `.env` with required vars (see list above) + dev Mongo connection.
2. Start Mongo (docker or local) and optional S3 bucket.
3. `npm install` then `npm start` (runs `bin/www_prod.js` logic in dev if `PROD_RUN` not set).
4. Use `/start` with registration key, then `/settings` to adjust model/temperature.

## Setup (Prod)
1. Rename `docker-compose.yml.prod` → `docker-compose.yml` and set env vars.
2. (Optional) Enable Mongo auth; update connection string; restart.
3. Build or use published image `truvoruwka/chatbot_open_ai:1.0.6`.

## Testing
```
npm test   # Runs MCP integration tests
```

## Known Limitations
Non‑English prompt token counts approximate (stream API lacks prompt usage; tokenizer mismatch after internal translation).

## Release Notes (Summary)
1.0.0 Initial release.
1.0.3 DB connection leak fix + security logs.
1.0.6 Expanded tool set (MCP, Midjourney, Excel, diagrams, doc pipeline), reasoning models, improved logging & S3 flow.

## License & Contribution
MIT (`LICENSE.txt`). Fork → branch → PR with concise description + relevant tests.

Русская инструкция: `user_manual_ru.html`.