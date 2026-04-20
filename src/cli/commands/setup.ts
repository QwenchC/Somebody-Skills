import { Logger } from '../../utils/logger.js';
import { runSetup } from '../../env-manager/index.js';

export async function setupCommand(
  opts: { skipPython?: boolean; skipCuda?: boolean },
  logger: Logger,
): Promise<void> {
  await runSetup(logger, opts);
}
