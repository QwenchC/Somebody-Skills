#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { setupCommand } from './commands/setup.js';
import { checkCommand } from './commands/check.js';
import { collectCommand } from './commands/collect.js';
import { distillCommand } from './commands/distill.js';
import { packCommand } from './commands/pack.js';
import { installCommand } from './commands/install.js';
import { testCommand } from './commands/test.js';

const logger = createLogger();

const program = new Command();

program
  .name('sbs')
  .description('Somebody-Skills — 将任意目标人物的数字痕迹转化为可部署的 .skill 文件')
  .version('0.1.0')
  .option('-v, --verbose', '输出详细日志')
  .option('-q, --quiet', '静默模式，仅输出错误')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) logger.level = 'debug';
    if (opts.quiet) logger.level = 'error';
  });

program
  .command('setup')
  .description('自动检测并安装运行环境（Node.js, Python, CUDA 等）')
  .option('--skip-python', '跳过 Python 环境安装')
  .option('--skip-cuda', '跳过 CUDA 检测')
  .action(async (opts) => {
    try {
      await setupCommand(opts, logger);
    } catch (err) {
      logger.error(`环境配置失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('验证运行环境，输出健康检查报告')
  .action(async () => {
    try {
      await checkCommand(logger);
    } catch (err) {
      logger.error(`健康检查失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('collect')
  .description('采集目标人物数据')
  .requiredOption('-t, --target <name>', '目标人物名称')
  .option('-p, --platform <platforms...>', '指定平台列表（github, zhihu, weibo 等）')
  .option('-l, --local-path <path>', '本地数据文件夹路径')
  .option('-m, --mode <mode>', '采集模式: auto / manual / hybrid', 'hybrid')
  .action(async (opts) => {
    try {
      await collectCommand(opts, logger);
    } catch (err) {
      logger.error(`数据采集失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('distill')
  .description('对采集的数据执行蒸馏，提取人格表示')
  .option('--single-track', '仅使用单轨蒸馏（跳过辩论）')
  .option('--skip-probes', '跳过主动探针')
  .action(async (opts) => {
    try {
      await distillCommand(opts, logger);
    } catch (err) {
      logger.error(`蒸馏失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('pack')
  .description('将蒸馏结果封装为 .skill 文件')
  .option('-o, --output <path>', '输出路径', './workspace/output')
  .option('--zip', '同时生成 .zip 压缩包')
  .action(async (opts) => {
    try {
      await packCommand(opts, logger);
    } catch (err) {
      logger.error(`封装失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('install <skillPath>')
  .description('将 .skill 文件安装到目标工具的 skills/ 目录')
  .option('--tool <tool>', '目标工具: openclaw / cursor / claude-code', 'openclaw')
  .action(async (skillPath: string, opts) => {
    try {
      await installCommand(skillPath, opts, logger);
    } catch (err) {
      logger.error(`安装失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('启动测试对话界面，与生成的 skill 交互')
  .option('--web', '使用 Web UI（Gradio）')
  .action(async (opts) => {
    try {
      await testCommand(opts, logger);
    } catch (err) {
      logger.error(`测试启动失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
