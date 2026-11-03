#!/usr/bin/env node
// Development launcher (runs the TypeScript source). Installed packages run dist/session-daemon.mjs instead.
import { register } from 'tsx/esm/api';

register();
await import('../src/session-daemon.ts');
