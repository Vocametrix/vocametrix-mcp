import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../client.js";
import { localFilesystemEnabled } from "../utils/audio-input.js";
import { registerUploadTool, registerUploadAttachmentTool } from "./atomic/upload.js";
import { registerIngestUrlTool } from "./atomic/ingest.js";
import { registerVoiceQualityTools } from "./atomic/voice-quality.js";
import { registerAdvancedVoiceTools } from "./atomic/advanced-voice.js";
import { registerCoreSpeechTools } from "./atomic/core-speech.js";
import { registerAudioMeasureTools } from "./atomic/audio-measures.js";
import { registerAiAgentTools } from "./atomic/ai-agents.js";
import { registerTherapyTools } from "./atomic/therapy.js";
import { registerFullVoiceAssessment } from "./workflows/full-voice-assessment.js";
import { registerBatchPronunciation } from "./workflows/batch-pronunciation.js";
import { registerFullTherapyWorkflow } from "./workflows/full-therapy-workflow.js";

export function registerAllTools(server: McpServer, client: ApiClient): void {
  registerUploadTool(server, client);
  // Only ChatGPT sends file parameters, and only to the hosted server.
  if (!localFilesystemEnabled()) registerUploadAttachmentTool(server, client);
  registerIngestUrlTool(server, client);
  registerVoiceQualityTools(server, client);
  registerAdvancedVoiceTools(server, client);
  registerCoreSpeechTools(server, client);
  registerAudioMeasureTools(server, client);
  registerAiAgentTools(server, client);
  registerTherapyTools(server, client);
  registerFullVoiceAssessment(server, client);
  // Reads a folder from disk, so it only makes sense where that disk is the
  // user's. On the hosted server it would enumerate the server's filesystem
  // instead, which is why it is not published there at all.
  if (localFilesystemEnabled()) registerBatchPronunciation(server, client);
  registerFullTherapyWorkflow(server, client);
}
