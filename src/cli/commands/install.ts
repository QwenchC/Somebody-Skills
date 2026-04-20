import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { Logger } from '../../utils/logger.js';

const TOOL_PATHS: Record<string, () => string[]> = {
  openclaw: () => {
    // 常见路径
    const candidates = [
      path.join(os.homedir(), '.openclaw', 'skills'),
      path.join(os.homedir(), '.config', 'openclaw', 'skills'),
    ];
    return candidates;
  },
  'claude-code': () => [
    path.join(os.homedir(), '.claude', 'skills'),
  ],
  cursor: () => [
    path.join(os.homedir(), '.cursor', 'skills'),
    path.join(os.homedir(), '.config', 'cursor', 'skills'),
  ],
};

export async function installCommand(
  skillPath: string,
  opts: { tool?: string },
  logger: Logger,
): Promise<void> {
  const tool = opts.tool ?? 'openclaw';
  const resolved = path.resolve(skillPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`路径不存在: ${resolved}`);
  }

  const pathFn = TOOL_PATHS[tool];
  if (!pathFn) {
    throw new Error(`不支持的工具: ${tool}。支持: ${Object.keys(TOOL_PATHS).join(', ')}`);
  }

  const candidates = pathFn();
  let targetDir: string | null = null;

  // 找到第一个存在的父目录
  for (const candidate of candidates) {
    const parent = path.dirname(candidate);
    if (fs.existsSync(parent)) {
      targetDir = candidate;
      break;
    }
  }

  if (!targetDir) {
    // 使用第一个候选并创建
    targetDir = candidates[0];
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const skillName = path.basename(resolved);
  const destDir = path.join(targetDir, skillName);

  // 复制
  copyDirSync(resolved, destDir);

  logger.info(chalk.green(`已安装到 ${tool}: ${destDir}`));
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
