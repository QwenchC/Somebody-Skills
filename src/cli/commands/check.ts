import { Logger } from '../../utils/logger.js';
import { runFullCheck, printCheckReport } from '../../env-manager/index.js';

export async function checkCommand(logger: Logger): Promise<void> {
  const results = await runFullCheck(logger);
  printCheckReport(results, logger);
}
