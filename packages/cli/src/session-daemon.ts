// The background process behind `dea session start`: holds one browser open between commands.
import { serveSession } from '@dea/core';

const opts = JSON.parse(process.argv[2] ?? '{}');
try {
  const info = await serveSession(opts);
  process.stdout.write(`session ${info.runId} ready on 127.0.0.1:${info.port}\n`);
} catch (e) {
  process.stderr.write(`dea session: ${(e as Error).message}\n`);
  process.exit(1);
}
