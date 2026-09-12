import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

const THRESHOLDS: Record<string, string> = {
  avqi: `# AVQI Clinical Thresholds (Acoustic Voice Quality Index)

Algorithm versions: v2.03 (Maryn & Weenink 2015), v3.01 (Barsties & Maryn 2015)

## Interpretation (v3.01, language-independent)
- Normal voice:      AVQI < 2.43  (some labs use 2.97 for English)
- Mild dysphonia:    2.43 – 3.99
- Moderate:          4.00 – 5.99
- Severe dysphonia:  AVQI ≥ 6.00

## Language-specific thresholds (v2.03)
- French:  cutoff 2.43 (Maryn et al. 2017)
- English: cutoff 2.97
- Dutch:   cutoff 2.43

## Clinical notes
- AVQI combines CPP and three spectral slope measures from connected speech + sustained vowel
- Higher AVQI = worse voice quality
- Validated in laryngeal pathology and functional dysphonia
- Not validated for children under 18`,

  dsi: `# DSI Clinical Thresholds (Dysphonia Severity Index)

## Interpretation
- Normal voice:      DSI > 1.6
- Mild dysphonia:    DSI 0.0 to 1.6
- Moderate:          DSI -1.6 to 0.0
- Severe dysphonia:  DSI < -1.6

## Formula
DSI = 0.13 × MPT + 0.0053 × F0-High − 0.26 × I-Low − 1.18 × Jitter(%) + 12.4

Where:
- MPT = Maximum Phonation Time (seconds)
- F0-High = highest F0 in voice range profile (Hz)
- I-Low = softest intensity (dB SPL)
- Jitter = period perturbation quotient (%)

## Clinical notes
- Validated by Wuyts et al. (2000) on 387 patients
- Requires voice range profile measurements
- Sensitive to neuromuscular disorders, vocal fold paralysis`,

  cpp: `# CPP / CPPS Clinical Thresholds (Cepstral Peak Prominence)

## Smoothed CPP (CPPS) — typical values
- Normal voice (male):    CPPS > 12 dB
- Normal voice (female):  CPPS > 9 dB
- Borderline:             CPPS 6–9 dB
- Dysphonic:              CPPS < 6 dB

## CPP (unsmoothed, Praat)
- Normal: 20–28 dB
- Reduced: 15–20 dB
- Severely reduced: < 15 dB

## Clinical notes
- Higher CPP = stronger harmonic structure = better voice quality
- Sensitive to breathiness, hoarseness, and pressed phonation
- More sensitive than jitter/shimmer for continuous speech
- Can be measured on sustained vowels or running speech`,

  hnr: `# HNR Clinical Thresholds (Harmonics-to-Noise Ratio, multi-band)

## Band-specific normal ranges (Praat, adult)
- HNR (80–500 Hz):    > 20 dB = normal
- HNR (500–1500 Hz):  > 20 dB = normal
- HNR (1500–2500 Hz): > 15 dB = normal
- HNR (2500–3500 Hz): > 12 dB = normal

## General interpretation
- > 20 dB:    Normal voice
- 15–20 dB:   Mild dysphonia
- 10–15 dB:   Moderate dysphonia
- < 10 dB:    Severe dysphonia

## Clinical notes
- Multi-band HNR captures band-specific noise patterns
- Low HNR in low bands → breathy voice
- Low HNR in high bands → pressed/strained voice
- Age/gender norms differ: elderly voices typically show 2–4 dB lower HNR`,

  "jitter-shimmer": `# Jitter and Shimmer Clinical Thresholds

## Jitter (period perturbation)
- PPQ5 (5-point period perturbation quotient)
  - Normal: < 1.04%
  - Mild:   1.04 – 2.20%
  - Severe: > 2.20%

- Jitter (local, absolute)
  - Normal: < 83.2 µs
  - Pathological: > 83.2 µs

## Shimmer (amplitude perturbation)
- Shimmer (dB)
  - Normal: < 3.81 dB
  - Mild:   3.81 – 5.0 dB
  - Severe: > 5.0 dB

- Shimmer (local %)
  - Normal: < 14.23%

## Clinical notes
- Elevated jitter → irregular vocal fold vibration → roughness perception
- Elevated shimmer → amplitude instability → hoarseness perception
- Both measures require quasi-periodic voicing (sustained vowels)
- Not reliable for severely aperiodic voices (use CPP or HNR instead)
- Reference: Teixeira & Gonçalves (2014), Dejonckere et al. (2001)`,

  gne: `# GNE Clinical Thresholds (Glottal-to-Noise Excitation)

## Interpretation
- Normal voice:   GNE > 0.50 (some labs: > 0.45)
- Borderline:     GNE 0.35 – 0.50
- Dysphonic:      GNE < 0.35

## Scale
- GNE ranges 0–1
- Values near 1 → mostly glottal excitation (clean voice)
- Values near 0 → mostly noise (breathy/hoarse voice)

## Clinical notes
- GNE is especially sensitive to breathiness from glottal insufficiency
- More robust than jitter for severely dysphonic voices
- Algorithm: Michaelis et al. (1997), implemented in Praat`,

  avqi_locales: `# Supported locales for Vocametrix pronunciation assessment

## Full support (acoustic model + pronunciation dictionary)
en-US, en-GB, en-AU, en-CA, en-IN
fr-FR, fr-CA, fr-BE
de-DE, de-AT, de-CH
es-ES, es-MX, es-AR, es-CO, es-CL, es-US
it-IT, pt-PT, pt-BR
nl-NL, nl-BE
pl-PL, cs-CZ, sk-SK, hu-HU
ro-RO, hr-HR, sl-SI
sv-SE, nb-NO, da-DK, fi-FI
ru-RU, uk-UA
zh-CN, zh-TW, zh-HK
ja-JP, ko-KR
ar-SA, ar-AE, ar-EG
hi-IN, ta-IN, te-IN
tr-TR, he-IL, id-ID, th-TH, vi-VN
et-EE, lv-LV, lt-LT

## Phoneme detection (dedicated models)
- French (fr): full phoneme inventory
- Estonian (et): full phoneme inventory`,
};

const API_DOCS = `# Vocametrix API — Quick Reference

## Authentication
All requests require: X-API-Key: your-api-key

Get an API key: https://www.vocametrix.com/registration
API calls require purchased API credits. The website subscription and trial do not cover API usage.

## Base URL
https://platform.vocametrix.com

## Rate limits
- 100 requests per 15 minutes per key
- SDK retries 429/5xx automatically (up to 3×, exponential backoff)

## Audio requirements
- Format: WAV (16-bit PCM recommended)
- Sustained vowel: 3+ seconds of /a/ phonation
- Connected speech: 5–30 seconds of read passage
- Sampling rate: 16 kHz or higher

## Upload patterns
1. assignFileId (Praat endpoints): POST /api/assignFileId → fileId → GET ?svFileId=...
2. Blob URL (streaming endpoints): POST /api/get-blob-url → PUT to Azure → POST with blobURL

## Error codes
- 401: Invalid or missing API key
- 403: Insufficient plan permissions
- 422: Invalid parameters (check field names/types)
- 429: Rate limit — retry after header
- 5xx: Server error — retried automatically

## Full reference
https://www.vocametrix.com/api-docs

## OpenAPI 3.1 spec
https://www.vocametrix.com/openapi.json`;

const RECORDING_GUIDE = `# Vocametrix Recording Guide

This guide defines the audio recording types required by Vocametrix voice analysis tools.
Always ensure the user has the correct recording type before calling a tool.

---

## Sustained Vowel (SV)

Say the vowel /a/ continuously at comfortable pitch and volume.
- No pitch slides or glides
- No background noise, coughing, or breathing artefacts
- Minimum duration: 3 seconds
- Required duration: 5+ seconds for AVQI and ABI

Used by: AVQI, ABI, DSI, CPP, HNR, Jitter/Shimmer, Spectral, Formants, GNE, H1-H2,
         Voice Dynamics, eGeMAPS

---

## Connected Speech (CS)

The patient reads a language-specific reference sentence aloud at a natural pace.
This is a phonetically balanced clinical sentence — spontaneous or free speech is NOT valid.
Minimum duration: 3 seconds of actual speech.

Used by: AVQI (required), ABI (required)

| Language | Code | Reference sentence |
|---|---|---|
| English | en | "When the sunlight strikes raindrops in the air, they act like a prism and form a rainbow." |
| French  | fr | "Quand Renée périt, un chat esseulé grogna fort. À cet instant, Vic sortit contempler le jour naissant." |
| Dutch   | nl | "De noordenwind en de zon waren erover aan het redetwisten wie de sterkste was van hen beiden." |
| Spanish | es | "Carmen tiene dos libros grandes. Elena toma doce platos nuevos. Teresa hace siete regalos pequeños." |
| German  | de | "Der Nordwind und die Sonne stritten sich einmal, wer von ihnen beiden wohl der Stärkere wäre, als ein Wanderer, der in einen warmen Mantel gehüllt war, des Weges daherkam." |
| Italian | it | "Si bisticciavano un giorno il vento della tramontana e il sole, l'uno pretendendo d'esser più forte dell'altro." |

---

## Glissando

Slide continuously from the lowest to the highest comfortable pitch on any vowel, without stopping.
Duration: 5–10 seconds.

Used by: Voice Range Profile (VRP / Ambitus)

---

## Sustained /s/ and /z/

Two SEPARATE recordings:
1. Sustained /s/ — voiceless hissing sound (like a snake), 3–5 seconds
2. Sustained /z/ — voiced buzzing sound (like a bee), 3–5 seconds

Used by: S/Z Ratio
`;

export function registerResources(server: McpServer): void {
  // Static API docs resource
  server.resource(
    "api-docs",
    "vocametrix://docs/api",
    { description: "Vocametrix API quick reference: auth, rate limits, audio requirements, error codes" },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/plain",
        text: API_DOCS,
      }],
    }),
  );

  // Recording guide resource
  server.resource(
    "recording-guide",
    "vocametrix://recording-guide",
    { description: "Recording protocols for all Vocametrix voice analysis tools: sustained vowel, connected speech (with language-specific sentences), glissando, and S/Z recordings" },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/plain",
        text: RECORDING_GUIDE,
      }],
    }),
  );

  // Dynamic thresholds resource
  server.resource(
    "clinical-thresholds",
    new ResourceTemplate("vocametrix://thresholds/{metric}", { list: async () => ({
      resources: Object.keys(THRESHOLDS).map(k => ({
        name: `Thresholds: ${k.toUpperCase()}`,
        uri: `vocametrix://thresholds/${k}`,
        description: `Clinical reference thresholds for ${k.toUpperCase()}`,
        mimeType: "text/plain",
      })),
    }) }),
    { description: "Clinical reference thresholds for Vocametrix voice metrics (AVQI, DSI, CPP, HNR, jitter/shimmer, GNE)" },
    async (uri, { metric }) => {
      const key = Array.isArray(metric) ? metric[0] ?? "" : metric ?? "";
      const text = THRESHOLDS[key] ?? `No threshold data for metric: ${key}\nAvailable: ${Object.keys(THRESHOLDS).join(", ")}`;
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text,
        }],
      };
    },
  );
}
