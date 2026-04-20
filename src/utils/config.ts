import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface SbsConfig {
  /** 工作区根目录 */
  workspaceDir: string;
  /** 本地 LLM 服务地址 */
  llmBaseUrl: string;
  /** 默认 LLM 模型 */
  llmModel: string;
  /** Embedding 模型 */
  embeddingModel: string;
  /** Python 可执行路径 */
  pythonPath: string;
  /** Node.js 可执行路径 */
  nodePath: string;
  /** 是否已完成 setup */
  setupComplete: boolean;
}

const CONFIG_DIR = path.join(os.homedir(), '.sbs');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: SbsConfig = {
  workspaceDir: path.resolve('./workspace'),
  llmBaseUrl: 'http://127.0.0.1:8000',
  llmModel: 'Qwen2.5-32B-Instruct-4bit',
  embeddingModel: 'BAAI/bge-large-zh-v1.5',
  pythonPath: 'python',
  nodePath: 'node',
  setupComplete: false,
};

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): SbsConfig {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  // 去掉可能的 UTF-8 BOM（PowerShell Set-Content 写入时可能附加）
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8').replace(/^\uFEFF/, '');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: Partial<SbsConfig>): void {
  ensureConfigDir();
  const current = loadConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

export function ensureWorkspace(config: SbsConfig): void {
  const dirs = ['raw', 'processed', 'output'];
  for (const dir of dirs) {
    const p = path.join(config.workspaceDir, dir);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }
}

export { CONFIG_DIR, CONFIG_FILE };
