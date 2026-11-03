#!/usr/bin/env node
// Runs the TypeScript source directly (no build step yet). Phase 4 ships a bundled build instead.
import { register } from 'tsx/esm/api';

register();
await import('../src/stdio.ts');
