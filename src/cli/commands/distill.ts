import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '../../utils/logger.js';
import { loadConfig, ensureWorkspace } from '../../utils/config.js';
import { runPreprocess, runDistillation } from '../../utils/python-bridge.js';

export async function distillCommand(
  opts: { singleTrack?: boolean; skipProbes?: boolean },
  logger: Logger,
): Promise<void> {
  const config = loadConfig();
  ensureWorkspace(config);

  // 读取 collect 阶段保存的目标元数据
  const metaPath = path.join(config.workspaceDir, 'meta.json');
  let target: string | undefined;
  if (fs.existsSync(metaPath)) {
    try {
      target = JSON.parse(fs.readFileSync(metaPath, 'utf-8')).target;
    } catch { /* ignore */ }
  }

  const rawDir = path.join(config.workspaceDir, 'raw');
  const processedDir = path.join(config.workspaceDir, 'processed');

  // Step 1: 预处理
  logger.info('预处理原始数据...');
  try {
    const stats = await runPreprocess(rawDir, processedDir, logger);
    logger.info(`预处理完成: ${stats.files} 文件 → ${stats.chunks} 分块, ${stats.total_chars.toLocaleString()} 字符`);
  } catch (err) {
    logger.warn(`预处理跳过（将直接从 raw 数据蒸馏）: ${(err as Error).message}`);
  }

  // Step 2: 蒸馏
  logger.info('启动蒸馏引擎...');
  if (target) logger.info(chalk.gray(`  目标: ${target}`));
  logger.info(chalk.gray(`  模式: ${opts.singleTrack ? '单轨' : '双轨'} | 探针: ${opts.skipProbes ? '跳过' : '启用'}`));

  const result = await runDistillation(config.workspaceDir, logger, {
    singleTrack: opts.singleTrack,
    skipProbes: opts.skipProbes,
    target,
  });

  logger.info('');
  logger.info(chalk.green(`蒸馏完成 ✓`));
  logger.info(`  人格维度: ${result.dimensions}`);
  logger.info(`  输出: ${path.join(config.workspaceDir, 'output', 'persona.json')}`);
}
