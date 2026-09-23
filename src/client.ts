import { VocametrixClient, VocametrixValidationError } from "vocametrix";
import { resolveAudioInputToBuffer } from "./utils/audio-input.js";
import { ApiHttpError } from "./errors.js";

const BASE_URL = "https://platform.vocametrix.com";

export interface ApiClient {
  sdk: VocametrixClient;
  apiKey: string;
  /**
   * Upload audio and return a fileId (for Praat-based endpoints).
   * Accepts: local file path, HTTP/HTTPS URL, data URL, or raw base64 string.
   */
  uploadFileId(audioInput: string, email?: string): Promise<string>;
  /**
   * Upload audio to Azure Blob and return the blobURL (for streaming endpoints).
   * If audioInput is already an HTTP/HTTPS URL, it is returned as-is.
   * Accepts: local file path, HTTP/HTTPS URL, data URL, or raw base64 string.
   */
  uploadBlobUrl(audioInput: string): Promise<string>;
  /**
   * Upload raw base64-encoded audio to Azure Blob and return the blobUrl.
   * Use this from the vocametrix_upload_audio tool.
   */
  uploadAudioFromBase64(base64: string): Promise<{ blobUrl: string }>;
  /** Call a Vocametrix API endpoint directly with X-API-Key auth */
  get(path: string, params?: Record<string, string>): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export function createClient(explicitKey?: string): ApiClient {
  const apiKey = explicitKey ?? process.env["VOCAMETRIX_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "VOCAMETRIX_API_KEY is required. " +
      "Get a key at https://www.vocametrix.com/registration",
    );
  }

  const sdk = new VocametrixClient({ apiKey });
  const authHeaders = { "X-API-Key": apiKey };

  async function apiFetch(url: string, init: RequestInit): Promise<unknown> {
    const resp = await fetch(url, {
      ...init,
      headers: { ...authHeaders, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new ApiHttpError(resp.status, body);
    }
    return resp.json();
  }

  async function uploadBufferToBlob(data: Buffer): Promise<string> {
    const json = await apiFetch(`${BASE_URL}/api/get-blob-url`, {
      method: "POST",
    }) as { uploadURL: string; blobURL: string };
    const put = await fetch(json.uploadURL, {
      method: "PUT",
      body: data,
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "audio/wav" },
    });
    if (!put.ok) throw new Error(`Azure upload failed: ${String(put.status)}`);
    return json.blobURL;
  }

  async function uploadBufferToFileId(data: Buffer, email: string): Promise<string> {
    const form = new FormData();
    form.append("audio", new Blob([data], { type: "audio/wav" }), "audio.wav");
    form.append("email", email);
    const json = await apiFetch(`${BASE_URL}/api/assignFileId`, {
      method: "POST",
      body: form,
    }) as { fileId: string };
    return json.fileId;
  }

  return {
    sdk,
    apiKey,

    async uploadFileId(audioInput, email = "mcp@vocametrix.com") {
      const data = await resolveAudioInputToBuffer(audioInput);
      return uploadBufferToFileId(data, email);
    },

    async uploadBlobUrl(audioInput) {
      // Always upload to a fresh blob, even when audioInput is already an HTTPS URL.
      // Some Vocametrix endpoints (e.g. /api/soundLevel) delete the blob after processing,
      // so passing the same URL to a second tool would 404. A fresh upload per tool call
      // guarantees the blob exists for the duration of that call.
      const data = await resolveAudioInputToBuffer(audioInput);
      return uploadBufferToBlob(data);
    },

    async uploadAudioFromBase64(base64) {
      const data = base64.startsWith("data:")
        ? Buffer.from(base64.slice(base64.indexOf(",") + 1), "base64")
        : Buffer.from(base64, "base64");
      // A model that cannot read an attachment tends to send a stand-in string
      // ("PLACEHOLDER"). Storing it would yield a blob every analysis rejects
      // with a 500, after the model has already told the user the upload worked.
      if (!looksLikeAudio(data)) {
        throw new VocametrixValidationError(
          "audioBase64 does not decode to an audio file (WAV, MP3, FLAC, OGG, M4A or WebM). " +
          "Do not send placeholders. In ChatGPT, call vocametrix_upload_attachment with the attached file instead.",
        );
      }
      const blobUrl = await uploadBufferToBlob(data);
      return { blobUrl };
    },

    async get(path, params) {
      const url = new URL(`${BASE_URL}${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      }
      return apiFetch(url.toString(), { method: "GET" });
    },

    async post(path, body) {
      return apiFetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
  };
}

/** Recognises the container signatures of the audio formats the platform accepts. */
export function looksLikeAudio(data: Buffer): boolean {
  if (data.length < 44) return false;
  const ascii = (start: number, end: number) => data.toString("latin1", start, end);
  return (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE")
    || ascii(0, 3) === "ID3"
    || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0)
    || ascii(0, 4) === "fLaC"
    || ascii(0, 4) === "OggS"
    || ascii(4, 8) === "ftyp"
    || data.readUInt32BE(0) === 0x1a45dfa3;
}
