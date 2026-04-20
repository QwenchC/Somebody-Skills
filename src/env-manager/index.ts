import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { saveConfig, loadConfig } from '../utils/config.js';

const execFileAsync = promisify(execFile);

export interface EnvCheckResult {
  name: string;
  found: boolean;
  version?: string;
  message?: string;
}

// ---------- Detection helpers ----------

async function detectCommand(cmd: string, args: string[]): Promise<{ found: boolean; output: string }> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15000 });
    return { found: true, output: stdout.trim() };
  } catch {
    return { found: false, output: '' };
  }
}

function parseVersion(raw: string): string {
  const m = raw.match(/(\d+\.\d+[\.\d]*)/);
  return m ? m[1] : raw;
}

export async function checkNode(): Promise<EnvCheckResult> {
  const { found, output } = await detectCommand('node', ['--version']);
  if (!found) return { name: 'Node.js', found: false, message: '未检测到 Node.js，需 ≥18.0' };
  const ver = parseVersion(output);
  const major = parseInt(ver.split('.')[0], 10);
  if (major < 18) return { name: 'Node.js', found: true, version: ver, message: `版本 ${ver} 过低，需 ≥18.0` };
  return { name: 'Node.js', found: true, version: ver };
}

export async function checkPython(): Promise<EnvCheckResult> {
  // 尝试 python 和 python3
  for (const cmd of ['python', 'python3']) {
    const { found, output } = await detectCommand(cmd, ['--version']);
    if (found) {
      const ver = parseVersion(output);
      const parts = ver.split('.').map(Number);
      if (parts[0] >= 3 && parts[1] >= 10) {
        saveConfig({ pythonPath: cmd });
        return { name: 'Python', found: true, version: ver };
      }
      return { name: 'Python', found: true, version: ver, message: `版本 ${ver} 过低，需 ≥3.10` };
    }
  }
  return { name: 'Python', found: false, message: '未检测到 Python，需 ≥3.10' };
}

export async function checkCuda(): Promise<EnvCheckResult> {
  const { found, output } = await detectCommand('nvidia-smi', []);
  if (!found) return { name: 'CUDA (nvidia-smi)', found: false, message: '未检测到 NVIDIA GPU 驱动' };
  const cudaMatch = output.match(/CUDA Version:\s*(\d+\.\d+)/);
  const ver = cudaMatch ? cudaMatch[1] : 'unknown';
  return { name: 'CUDA', found: true, version: ver };
}

export async function checkGpu(): Promise<EnvCheckResult> {
  const { found, output } = await detectCommand('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  if (!found) return { name: 'GPU', found: false, message: '无法查询 GPU 信息' };
  return { name: 'GPU', found: true, version: output.split('\n')[0]?.trim() };
}

export async function checkPip(): Promise<EnvCheckResult> {
  const config = loadConfig();
  const py = config.pythonPath;
  const { found, output } = await detectCommand(py, ['-m', 'pip', '--version']);
  if (!found) return { name: 'pip', found: false, message: '未安装 pip' };
  return { name: 'pip', found: true, version: parseVersion(output) };
}

// ---------- Full check ----------

export async function runFullCheck(logger: Logger): Promise<EnvCheckResult[]> {
  const results: EnvCheckResult[] = [];

  logger.info('检测运行环境...');

  const checks = await Promise.all([
    checkNode(),
    checkPython(),
    checkCuda(),
    checkGpu(),
  ]);
  results.push(...checks);

  // pip 依赖 python 检测完成
  if (checks[1].found) {
    results.push(await checkPip());
  }

  return results;
}

export function printCheckReport(results: EnvCheckResult[], logger: Logger): void {
  logger.info('');
  logger.info('┌─────────────────── SBS 环境检查报告 ───────────────────┐');

  for (const r of results) {
    const icon = r.found ? (r.message ? chalk.yellow('⚠') : chalk.green('✓')) : chalk.red('✗');
    const ver = r.version ? chalk.gray(` v${r.version}`) : '';
    const msg = r.message ? chalk.yellow(` — ${r.message}`) : '';
    logger.info(`  ${icon} ${r.name}${ver}${msg}`);
  }

  const allGood = results.every(r => r.found && !r.message);
  logger.info('');
  if (allGood) {
    logger.info(chalk.green('  所有环境就绪 ✓'));
  } else {
    logger.info(chalk.yellow('  部分环境缺失或版本不符，请运行 sbs setup 修复'));
  }
  logger.info('└────────────────────────────────────────────────────────┘');
}

// ---------- Installation helpers ----------

function getPlatform(): 'win' | 'mac' | 'linux' {
  const p = os.platform();
  if (p === 'win32') return 'win';
  if (p === 'darwin') return 'mac';
  return 'linux';
}

async function installWithPackageManager(logger: Logger, packageName: string, winPkg?: string, macPkg?: string, linuxPkg?: string): Promise<boolean> {
  const platform = getPlatform();
  let cmd: string;
  let args: string[];

  switch (platform) {
    case 'win':
      cmd = 'winget';
      args = ['install', '--accept-package-agreements', '--accept-source-agreements', winPkg ?? packageName];
      break;
    case 'mac':
      cmd = 'brew';
      args = ['install', macPkg ?? packageName];
      break;
    case 'linux':
      cmd = 'sudo';
      args = ['apt-get', 'install', '-y', linuxPkg ?? packageName];
      break;
  }

  try {
    logger.info(`正在安装 ${packageName}...`);
    await execFileAsync(cmd, args, { timeout: 300000 });
    logger.info(`${packageName} 安装成功`);
    return true;
  } catch (err) {
    logger.warn(`自动安装 ${packageName} 失败: ${(err as Error).message}`);
    return false;
  }
}

export async function setupPythonVenv(logger: Logger): Promise<boolean> {
  const config = loadConfig();
  const venvDir = path.resolve('.venv');

  if (fs.existsSync(venvDir)) {
    logger.info('Python 虚拟环境已存在，跳过创建');
  } else {
    logger.info('创建 Python 虚拟环境 (.venv)...');
    try {
      await execFileAsync(config.pythonPath, ['-m', 'venv', venvDir], { timeout: 60000 });
    } catch (err) {
      logger.error(`创建虚拟环境失败: ${(err as Error).message}`);
      return false;
    }
  }

  // 确定 venv 中的 pip 路径
  const pipPath = getPlatform() === 'win'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');

  const pythonVenvPath = getPlatform() === 'win'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  saveConfig({ pythonPath: pythonVenvPath });

  // 安装 Python 依赖
  logger.info('安装 Python 依赖（torch, transformers, fastapi 等）...');
  try {
    // Windows 上必须用 python -m pip 来升级 pip 本身
    await execFileAsync(pythonVenvPath, [
      '-m', 'pip', 'install', '--upgrade', 'pip'
    ], { timeout: 120000 });

    await execFileAsync(pipPath, [
      'install',
      'fastapi', 'uvicorn[standard]',
      'sentence-transformers', 'chromadb', 'hdbscan',
      'transformers', 'llama-cpp-python',
      'jinja2', 'tiktoken', 'beautifulsoup4',
    ], { timeout: 600000 });

    // 安装 PyTorch（CUDA 版）
    logger.info('安装 PyTorch (CUDA)...');
    await execFileAsync(pipPath, [
      'install', 'torch', 'torchvision', 'torchaudio',
      '--index-url', 'https://download.pytorch.org/whl/cu128',
    ], { timeout: 600000 });

    logger.info('Python 依赖安装完成');
    return true;
  } catch (err) {
    logger.error(`Python 依赖安装失败: ${(err as Error).message}`);
    logger.info('可尝试手动运行: pip install -r requirements.txt');
    return false;
  }
}

export async function runSetup(logger: Logger, options: { skipPython?: boolean; skipCuda?: boolean } = {}): Promise<void> {
  const results = await runFullCheck(logger);
  printCheckReport(results, logger);

  const nodeCheck = results.find(r => r.name === 'Node.js');
  if (nodeCheck && !nodeCheck.found) {
    logger.info('尝试自动安装 Node.js...');
    await installWithPackageManager(logger, 'Node.js', 'OpenJS.NodeJS.LTS', 'node', 'nodejs');
  }

  const pythonCheck = results.find(r => r.name === 'Python');
  if (!options.skipPython && pythonCheck && !pythonCheck.found) {
    logger.info('尝试自动安装 Python...');
    await installWithPackageManager(logger, 'Python', 'Python.Python.3.12', 'python@3.12', 'python3');
  }

  if (!options.skipPython) {
    await setupPythonVenv(logger);
  }

  saveConfig({ setupComplete: true });
  logger.info(chalk.green('环境配置完成！运行 sbs check 验证。'));
}
