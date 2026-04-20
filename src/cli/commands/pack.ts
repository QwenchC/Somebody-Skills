import { Logger } from '../../utils/logger.js';
import { Packager } from '../../packager/index.js';

export async function packCommand(
  opts: { output?: string; zip?: boolean },
  logger: Logger,
): Promise<void> {
  const packager = new Packager(logger);
  const skillDir = await packager.pack({ output: opts.output, zip: opts.zip });
  logger.info(`封装完成: ${skillDir}`);
}
