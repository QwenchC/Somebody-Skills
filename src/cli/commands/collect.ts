import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '../../utils/logger.js';
import { DataCollector, listCrawlers } from '../../data-collector/index.js';
import { loadConfig } from '../../utils/config.js';

export interface CollectOptions {
  target: string;
  platform?: string[];
  localPath?: string;
  mode: 'auto' | 'manual' | 'hybrid';
}

export async function collectCommand(opts: CollectOptions, logger: Logger): Promise<void> {
  const collector = new DataCollector(logger);

  logger.info(`目标人物: ${opts.target}`);
  logger.info(`采集模式: ${opts.mode}`);
  logger.info(`可用平台: ${listCrawlers().join(', ')}`);

  let totalDocs = 0;

  // 自动/混合模式：爬取指定平台
  if (opts.mode !== 'manual') {
    const platforms = opts.platform ?? ['github'];
    logger.info(`爬取平台: ${platforms.join(', ')}`);
    totalDocs += await collector.collectFromPlatforms(opts.target, platforms, {
      githubToken: process.env.GITHUB_TOKEN,
      delayMs: 1500,
    });
  }

  // 手动/混合模式：加载本地文件
  if ((opts.mode === 'manual' || opts.mode === 'hybrid') && opts.localPath) {
    logger.info(`加载本地数据: ${opts.localPath}`);
    totalDocs += await collector.collectFromLocal(opts.localPath, opts.target);
  }

  // 输出摘要
  const summary = collector.generateSummary();
  logger.info('');
  logger.info(chalk.bold('┌─────────── 采集摘要 ───────────┐'));
  logger.info(`  总文档数: ${summary.totalFiles}`);
  logger.info(`  总字符数: ${summary.totalChars.toLocaleString()}`);
  for (const [platform, stats] of Object.entries(summary.platforms)) {
    logger.info(`  ${platform}: ${stats.files} 文件, ${stats.chars.toLocaleString()} 字符`);
  }
  logger.info(chalk.bold('└────────────────────────────────┘'));

  if (totalDocs === 0) {
    logger.warn('未采集到任何数据。请检查目标名称或提供本地数据路径 (--local-path)');
  }

  // 保存目标元数据，供后续 distill / pack 使用
  const config = loadConfig();
  const metaPath = path.join(config.workspaceDir, 'meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({ target: opts.target, collectedAt: new Date().toISOString() }, null, 2), 'utf-8');
  logger.debug(`已保存目标元数据: ${metaPath}`);
}
