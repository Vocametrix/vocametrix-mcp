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
| `vocametrix_avqi` | Acoustic Voice Quality Index (AVQI) — overall dysphonia severity |
| `vocametrix_dsi` | Dysphonia Severity Index (DSI) |
| `vocametrix_cpp_cpps` | Cepstral Peak Prominence — breathiness, hoarseness |
| `vocametrix_hnr` | Harmonics-to-Noise Ratio (multi-band) |
| `vocametrix_jitter_shimmer` | Period and amplitude perturbation |
| `vocametrix_vrp` | Voice Range Profile |
| `vocametrix_prosody_similarity` | Prosody similarity between two utterances |

### Advanced voice analysis
| Tool | Description |
|------|-------------|
| `vocametrix_spectral` | Spectral tilt, slope, and formant energy |
| `vocametrix_formants` | Formant frequencies F1–F4 |
| `vocametrix_sz_ratio` | S/Z phonation ratio |
| `vocametrix_gne` | Glottal-to-Noise Excitation |
| `vocametrix_h1h2` | H1–H2 harmonic difference |
| `vocametrix_abi` | Acoustic Breathiness Index |
| `vocametrix_voice_dynamics` | Dynamic range and fundamental frequency statistics |

### Ingestion utilities
| Tool | Description |
|------|-------------|
| `vocametrix_upload_audio` | Upload a WAV file (base64) → returns a stable blobUrl |
| `vocametrix_ingest_url` | Ingest a public HTTPS WAV URL → returns a stable blobUrl |

### Speech and pronunciation
| Tool | Description |
|------|-------------|
| `vocametrix_assess_pronunciation` | Phoneme-level pronunciation scoring |
| `vocametrix_assess_pronunciation_pitch` | Pronunciation + pitch analysis combined |
| `vocametrix_transcribe` | Streaming ASR transcription with progress |
| `vocametrix_tts` | Text-to-speech synthesis |
| `vocametrix_tts_timing` | TTS with word-level timing data |

### Audio measures
| Tool | Description |
|------|-------------|
| `vocametrix_sound_level` | dB SPL and intensity statistics |
| `vocametrix_egemaps` | Extended Geneva Minimalistic Acoustic Parameter Set |
| `vocametrix_phoneme_detection` | Phoneme presence/absence detection |
| `vocametrix_classify_stuttering` | Dysfluency classification |

### AI agents
| Tool | Description |
|------|-------------|
| `vocametrix_agent_interpret_metrics` | Clinical interpretation of voice metrics |
| `vocametrix_agent_exercises` | Personalized voice/speech exercise generation |
| `vocametrix_agent_word_list` | Target word list generation for therapy |
| `vocametrix_agent_therapist_chat` | Conversational AI speech-language therapist |
| `vocametrix_agent_french_ipa` | French text → IPA phonetic transcription |
| `vocametrix_agent_spell` | Spelling correction agent |
| `vocametrix_agent_syntax` | Syntax checking agent |
| `vocametrix_agent_vocabulary_tutor` | Vocabulary tutoring agent |
| `vocametrix_agent_adaptive_exercise` | Adaptive exercise generation |

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
| `vocametrix_batch_pronunciation` | Assess a folder of WAV files |
| `vocametrix_full_therapy_workflow` | Generate → poll → fetch → approval flow |

## Resources

- `vocametrix://docs/api` — API quick reference (auth, rate limits, audio requirements, error codes)
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

## Development

```bash
git clone https://github.com/pmarmaroli/vocametrix-mcp.git
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
- 📐 **[OpenAPI 3.1 specification](https://www.vocametrix.com/openapi.json)** — machine-readable schema for all 48 endpoints.
- 🐍 **[vocametrix-python](https://github.com/pmarmaroli/vocametrix-python)** — official Python SDK if you want direct API access from Python (`pip install vocametrix`).
- 🟦 **[vocametrix-js](https://github.com/pmarmaroli/vocametrix-js)** — official TypeScript / JavaScript SDK used internally by this MCP server (`npm install vocametrix`).

## License

MIT — see [LICENSE](LICENSE)
