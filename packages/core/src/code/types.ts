/**
 * Seam for Phase 7 (code and API decoder): scripts from Debugger.scriptParsed + getScriptSource,
 * source maps, unbundling, and HAR → OpenAPI. The HAR DEA already saves (secrets stripped) is the input.
 */
export interface ScriptSource {
  scriptId: string;
  url: string;
  bytes: number;
  sourceMapUrl: string | null;
  hash: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  host: string;
  /** HAR entry indexes that prove the call */
  harEntries: number[];
  /** the script whose stack started the request, when known */
  initiator: string | null;
}
