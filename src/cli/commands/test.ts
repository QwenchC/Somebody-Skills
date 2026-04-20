import path from 'node:path';
import { Logger } from '../../utils/logger.js';
import { loadConfig } from '../../utils/config.js';
import { runPythonCommand } from '../../utils/python-bridge.js';

export async function testCommand(
  opts: { web?: boolean },
  logger: Logger,
): Promise<void> {
  const config = loadConfig();
  const personaPath = path.join(config.workspaceDir, 'output', 'persona.json');

  logger.info('启动测试对话界面...');

  if (opts.web) {
    logger.info('启动 Gradio Web UI...');
    await runPythonCommand('chat', [
      '--persona', personaPath,
      '--llm-url', config.llmBaseUrl,
      '--mode', 'web',
    ], logger);
  } else {
    logger.info('启动 TUI 对话模式（Ctrl+C 退出）...');
    await runPythonCommand('chat', [
      '--persona', personaPath,
      '--llm-url', config.llmBaseUrl,
      '--mode', 'tui',
    ], logger);
  }
}
