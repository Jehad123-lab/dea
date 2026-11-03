import { Command } from 'commander';
import { inspectSite } from '@dea/core';
const program = new Command('dea');
program
  .command('inspect')
  .argument('<url>', 'site to inspect')
  .action(async (url: string) => {
    const { dir, facts } = await inspectSite(url);
    console.log(facts);
    console.log(`Evidence saved in ${dir}`);
  });
await program.parseAsync();
