#!/usr/bin/env node
// Development launcher (runs the TypeScript source with tsx). Installed packages run dist/index.mjs instead.
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
