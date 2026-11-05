import { filesystem } from './filesystem.ts';
import { github } from './github.ts';
import { http } from './http.ts';
import type { Connector } from './types.ts';
import { vercel } from './vercel.ts';

export const CONNECTORS: Record<string, Connector> = { github, vercel, filesystem, http };

export function findConnector(id: string): Connector | undefined {
  return CONNECTORS[id.toLowerCase()];
}

export type { BuiltinTool, Connector, Ctx, FetchLike, Scope, ScopeCheck } from './types.ts';
export { kindOf, toToolInfo } from './types.ts';
