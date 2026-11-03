import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** True when DEA runs from its TypeScript source (a git checkout), false when it runs from the built dist/ files. */
export const fromSource = import.meta.url.endsWith('.ts');

/**
 * The commands that start DEA's own processes: the MCP server an AI app launches, the CLI (for background runs),
 * and the browser-session daemon. Absolute paths, so they work from any folder. From a checkout they are the
 * small launchers in bin/; from an installed package they are the built files next to this one in dist/.
 */
export function launchers(): { node: string; mcp: string; cli: string; session: string } {
  if (fromSource)
    return {
      node: process.execPath,
      mcp: resolve(here, '../../mcp/bin/dea-mcp.mjs'),
      cli: resolve(here, '../bin/dea.mjs'),
      session: resolve(here, '../bin/dea-session.mjs'),
    };
  return { node: process.execPath, mcp: join(here, 'mcp.mjs'), cli: join(here, 'index.mjs'), session: join(here, 'session-daemon.mjs') };
}
