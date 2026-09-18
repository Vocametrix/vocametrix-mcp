# @vocametrix/mcp-server

[![smithery badge](https://smithery.ai/badge/patrick-marmaroli/vocametrix)](https://smithery.ai/servers/patrick-marmaroli/vocametrix)

Official [Model Context Protocol](https://modelcontextprotocol.io) server for the [Vocametrix](https://www.vocametrix.com) voice analysis API.

Gives any MCP-compatible AI assistant (Claude Desktop, Cursor, Cline, etc.) direct access to clinical voice metrics, pronunciation assessment, speech transcription, and AI-powered therapy planning.

## Quick start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vocametrix": {
      "command": "npx",
      "args": ["-y", "@vocametrix/mcp-server"],
      "env": {
        "VOCAMETRIX_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Get an API key at [vocametrix.com/registration](https://www.vocametrix.com/registration). MCP analysis uses purchased API credits; the website subscription and trial do not cover API calls.

### ChatGPT (OAuth, API credits)

The optional `/chatgpt/mcp` endpoint links a user's API account through OAuth. The user approves access on the platform's consent page; ChatGPT receives revocable tokens, not the API key. Existing `/mcp` API-key clients and local stdio clients remain supported.

See [ChatGPT setup and release checks](docs/chatgpt-api.md) for the matching platform changes, database migration, configuration, and tests. This integration must be deployed and tested in ChatGPT before public submission.

## Tools

### Voice quality (acoustic)
| Tool | Description |
|------|-------------|
| `vocametrix_calculate_avqi` | Acoustic Voice Quality Index (AVQI) — overall dysphonia severity |
| `vocametrix_calculate_dsi` | Dysphonia Severity Index (DSI) |
| `vocametrix_calculate_cpp` | Cepstral Peak Prominence — breathiness, hoarseness |
| `vocametrix_calculate_hnr` | Harmonics-to-Noise Ratio (multi-band) |
| `vocametrix_calculate_jitter_shimmer` | Period and amplitude perturbation |
| `vocametrix_calculate_voice_range_profile` | Voice Range Profile |
| `vocametrix_calculate_prosody_similarity` | Prosody similarity between two utterances |

### Advanced voice analysis
| Tool | Description |
|------|-------------|
| `vocametrix_calculate_spectral` | Spectral tilt, slope, and formant energy |
| `vocametrix_calculate_formants` | Formant frequencies F1–F4 |
| `vocametrix_calculate_sz_ratio` | S/Z phonation ratio |
| `vocametrix_calculate_gne` | Glottal-to-Noise Excitation |
| `vocametrix_calculate_h1_h2` | H1–H2 harmonic difference |
| `vocametrix_calculate_abi` | Acoustic Breathiness Index |
| `vocametrix_calculate_voice_dynamics` | Dynamic range and fundamental frequency statistics |

### Ingestion utilities
| Tool | Description |
|------|-------------|
| `vocametrix_upload_audio` | Upload a WAV file (base64) → returns a stable blobUrl |
| `vocametrix_ingest_url` | Ingest a public HTTPS WAV URL → returns a stable blobUrl |

### Speech and pronunciation
| Tool | Description |
|------|-------------|
| `vocametrix_assess_pronunciation` | Phoneme-level pronunciation scoring |
| `vocametrix_assess_pronunciation_with_pitch` | Pronunciation + pitch analysis combined |
| `vocametrix_transcribe_audio` | Streaming ASR transcription with progress |
| `vocametrix_synthesize_speech` | Text-to-speech synthesis |

### Audio measures
| Tool | Description |
|------|-------------|
| `vocametrix_measure_sound_level` | dB SPL and intensity statistics |
| `vocametrix_extract_egemaps` | Extended Geneva Minimalistic Acoustic Parameter Set (88 features) |
| `vocametrix_detect_phonemes` | French phoneme detection with confidence scores and timestamps |
| `vocametrix_classify_stuttering` | Dysfluency classification |

### AI agents
| Tool | Description |
|------|-------------|
| `vocametrix_interpret_voice_metrics` | Clinical interpretation of voice metrics |
| `vocametrix_generate_exercises` | Personalized voice/speech exercise generation |
| `vocametrix_generate_word_list` | Target word list generation for therapy |
| `vocametrix_chat_speech_therapist` | Conversational AI speech-language therapist |
| `vocametrix_convert_french_to_ipa` | French text → IPA phonetic transcription |
| `vocametrix_interpret_spelling_attempt` | Spelling correction agent |
| `vocametrix_check_syntax` | Syntax checking agent |
| `vocametrix_vocabulary_tutor` | Vocabulary tutoring agent |
| `vocametrix_adapt_exercise` | Adaptive exercise generation |

### Therapy planning
| Tool | Description |
|------|-------------|
| `vocametrix_generate_therapy_plan` | Generate an AI therapy plan |
| `vocametrix_get_therapy_status` | Poll therapy plan generation status |
| `vocametrix_get_therapy_result` | Fetch completed therapy plan |
| `vocametrix_approve_therapy_plan` | Approve a therapy plan |

### Workflow tools
| Tool | Description |
|------|-------------|
| `vocametrix_full_voice_assessment` | Parallel AVQI + CPP + HNR + jitter/shimmer + spectral |
| `vocametrix_batch_pronunciation` | Assess a folder of WAV files. Reads the server's own filesystem, so it is only registered in stdio/local mode (`VOCAMETRIX_MCP_LOCAL_FS=1`) — not available on the hosted server |
| `vocametrix_full_therapy_workflow` | Generate → poll → fetch → approval flow |

## Resources

- `vocametrix://docs/api` — API quick reference (auth, rate limits, audio requirements, error codes)
- `vocametrix://recording-guide` — Recording protocols for every tool (sustained vowel, connected speech with language-specific reference sentences, glissando, sustained /s/ and /z/)
- `vocametrix://thresholds/{metric}` — Clinical reference thresholds for `avqi`, `dsi`, `cpp`, `hnr`, `jitter-shimmer`, `gne`

## Prompts

- `interpret_voice_assessment` — Generate a clinical SLP-style interpretation report from assessment JSON
- `compare_pre_post_therapy` — Quantified pre/post therapy narrative with metric-by-metric comparison
- `generate_session_report` — SOAP-format progress note from pronunciation assessment data

## Audio requirements

- Format: WAV (16-bit PCM recommended)
- Sustained vowel tasks: 3+ seconds of /a/ phonation
- Connected speech tasks: 5–30 seconds of read passage
- Minimum sampling rate: 16 kHz

### How to pass audio to a tool

The `audioPath` parameter accepts several input types, but **which ones are valid depends on how the MCP server is running**:

| Input | Hosted / remote server | Stdio / local server (`npx`, Claude Desktop) |
|---|---|---|
| `https://...` blobUrl from `vocametrix_upload_audio` | ✅ recommended | ✅ |
| Public `https://...` URL to a WAV file | ✅ | ✅ |
| Public URL via `vocametrix_ingest_url` → returned blobUrl | ✅ recommended for URL inputs | ✅ |
| `data:audio/wav;base64,...` data URL | ✅ | ✅ |
| Raw base64 string (≥ 512 chars) | ✅ | ✅ |
| Absolute local path (`/home/...`, `C:\...`) | ❌ rejected | ⚠️ requires `VOCAMETRIX_MCP_LOCAL_FS=1` |

**For chat clients that attach audio in the conversation (Claude.ai web/mobile, etc.)**, the LLM cannot pass an absolute path to a hosted server — it must call `vocametrix_upload_audio` first with the file content base64-encoded, then pass the returned `blobUrl` as `audioPath` to any analysis tool. The MCP descriptions guide the LLM toward this workflow automatically.

**For stdio/local deployments where the MCP runs on the user's own machine**, set `VOCAMETRIX_MCP_LOCAL_FS=1` to allow analysis tools to read absolute local paths directly — convenient for batch processing of files already on disk.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VOCAMETRIX_API_KEY` | Yes | Your Vocametrix API key |
| `VOCAMETRIX_MCP_LOCAL_FS` | No | Set to `1` to allow analysis tools to read absolute local file paths (stdio/local deployments only). Default off — local paths are rejected with an actionable error so chat clients are pushed toward the `vocametrix_upload_audio` → `blobUrl` workflow. |
| `VOCAMETRIX_MCP_ALLOW_PRIVATE_HOSTS` | No | Set to `1` to allow fetching audio URLs whose host resolves to a private, loopback or link-local address (a LAN file server, for instance). Default off, including in stdio/local mode: the caller of an MCP tool is an LLM, and an LLM that has read a hostile page can be talked into pointing these tools at your own network. |

## Development

```bash
git clone https://github.com/Vocametrix/vocametrix-mcp.git
cd vocametrix-mcp
npm install
npm run build
npm test            # run unit tests
npm run inspector   # test with MCP Inspector
```

## MCP Registry

Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io/) under `io.github.pmarmaroli/vocametrix-mcp`. Available for one-click installation in MCP-compatible clients (Claude Desktop, Cursor, Zed, Windsurf, and more).

## Related projects

The Vocametrix ecosystem:

- 📘 **[Vocametrix API documentation](https://www.vocametrix.com/api-docs)** — full reference for the underlying REST API powering this MCP server.
- 📐 **[OpenAPI 3.1 specification](https://www.vocametrix.com/openapi.json)** — machine-readable schema for all 49 endpoints.
- 🐍 **[vocametrix-python](https://github.com/Vocametrix/vocametrix-python)** — official Python SDK if you want direct API access from Python (`pip install vocametrix`).
- 🟦 **[vocametrix-js](https://github.com/Vocametrix/vocametrix-js)** — official TypeScript / JavaScript SDK used internally by this MCP server (`npm install vocametrix`).

## License

MIT — see [LICENSE](LICENSE)
