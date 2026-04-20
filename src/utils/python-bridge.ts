import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { loadConfig } from './config.js';
import { Logger } from './logger.js';

const PYTHON_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
  '../../python',
);

// Python logging format: HH:MM:SS [name] LEVEL: message
const PY_LOG_RE = /^\d{2}:\d{2}:\d{2} \[([^\]]+)\] (INFO|WARNING|ERROR|DEBUG): (.+)$/;

/**
 * 调用 Python 蒸馏引擎子命令（流式输出：实时将 Python 日志转发给 Node logger）
 */
export async function runPythonCommand(
  command: string,
  args: string[],
  logger: Logger,
): Promise<string> {
  const config = loadConfig();
  const pythonPath = config.pythonPath;

  const mainScript = path.join(PYTHON_DIR, '__main__.py');
  const fullArgs = [mainScript, command, ...args];

  logger.debug(`Python: ${pythonPath} ${fullArgs.join(' ')}`);
  logger.debug(`CWD: ${PYTHON_DIR}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, fullArgs, {
      cwd: PYTHON_DIR,
      env: {
        ...process.env,
        PYTHONPATH: PYTHON_DIR,
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let lastStderr = '';

    // stdout → accumulate for JSON result
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    // stderr → line-by-line, forward to Node logger
    const rl = createInterface({ input: proc.stderr, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      lastStderr = line;
      const m = line.match(PY_LOG_RE);
      if (m) {
        const [, , level, message] = m;
        if (level === 'WARNING') logger.warn(message);
        else if (level === 'ERROR') logger.error(message);
        else if (level === 'DEBUG') logger.debug(message);
        else logger.info(message);           // INFO → visible by default
      } else {
        logger.debug(line);                  // httpx / tqdm noise → debug only
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = lastStderr || 'unknown error';
        reject(new Error(`Python 引擎错误: ${msg}`));
      } else {
        resolve(stdout.replace(/^\uFEFF/, '').trim());
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

/**
 * 运行预处理
 */
export async function runPreprocess(
  inputDir: string,
  outputDir: string,
  logger: Logger,
  noMask = false,
): Promise<{ files: number; chunks: number; total_chars: number }> {
  const args = ['--input', inputDir, '--output', outputDir];
  if (noMask) args.push('--no-mask');

  const output = await runPythonCommand('preprocess', args, logger);
  return JSON.parse(output);
}

/**
 * 运行蒸馏
 */
export async function runDistillation(
  workspaceDir: string,
  logger: Logger,
  options: { singleTrack?: boolean; skipProbes?: boolean; llmUrl?: string; target?: string } = {},
): Promise<{ status: string; dimensions: number }> {
  const config = loadConfig();
  const args = [
    '--workspace', workspaceDir,
    '--llm-url', options.llmUrl ?? config.llmBaseUrl,
    '--embedding-model', config.embeddingModel,
  ];
  if (options.singleTrack) args.push('--single-track');
  if (options.skipProbes) args.push('--skip-probes');
  if (options.target) args.push('--target', options.target);

  const output = await runPythonCommand('distill', args, logger);
  return JSON.parse(output);
}
