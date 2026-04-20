import { Logger } from '../utils/logger.js';

/** 单条采集结果 */
export interface RawDocument {
  /** 来源平台 */
  source: string;
  /** 文档类型: post / article / comment / code / chat */
  type: string;
  /** 标题（可选） */
  title?: string;
  /** 正文内容 */
  content: string;
  /** 原始 URL（可选） */
  url?: string;
  /** 发布/创建时间 */
  timestamp?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/** 爬虫插件接口 */
export interface Crawler {
  /** 平台标识（如 github, zhihu, weibo） */
  readonly platform: string;
  /** 执行采集 */
  collect(target: string, options: CrawlerOptions): AsyncIterable<RawDocument>;
}

export interface CrawlerOptions {
  /** 每个平台最大采集页数 */
  maxPages?: number;
  /** 请求间隔（毫秒） */
  delayMs?: number;
  /** Cookie 字符串（用于登录态） */
  cookie?: string;
  /** HTTP 代理 */
  proxy?: string;
  /** GitHub Token */
  githubToken?: string;
}

/** 爬虫注册表 */
const crawlerRegistry = new Map<string, Crawler>();

export function registerCrawler(crawler: Crawler): void {
  crawlerRegistry.set(crawler.platform, crawler);
}

export function getCrawler(platform: string): Crawler | undefined {
  return crawlerRegistry.get(platform);
}

export function listCrawlers(): string[] {
  return [...crawlerRegistry.keys()];
}

// 自动注册内置爬虫
import { GitHubCrawler } from './crawlers/github.js';
import { GenericWebCrawler } from './crawlers/generic.js';
import { LocalFileLoader } from './crawlers/local.js';

registerCrawler(new GitHubCrawler());
registerCrawler(new GenericWebCrawler());
registerCrawler(new LocalFileLoader());

// ---------- DataCollector 主类 ----------

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ensureWorkspace } from '../utils/config.js';
import { setFileHash } from '../utils/db.js';
import { createHash } from 'node:crypto';

export class DataCollector {
  private config = loadConfig();

  constructor(private logger: Logger) {
    ensureWorkspace(this.config);
  }

  /** 从指定平台采集数据 */
  async collectFromPlatforms(
    target: string,
    platforms: string[],
    options: CrawlerOptions = {},
  ): Promise<number> {
    let totalDocs = 0;

    for (const platform of platforms) {
      const crawler = getCrawler(platform);
      if (!crawler) {
        this.logger.warn(`未知平台: ${platform}，已跳过。可用平台: ${listCrawlers().join(', ')}`);
        continue;
      }

      this.logger.info(`采集 [${platform}] 中...`);
      const platformDir = path.join(this.config.workspaceDir, 'raw', platform);
      if (!fs.existsSync(platformDir)) {
        fs.mkdirSync(platformDir, { recursive: true });
      }

      let count = 0;
      try {
        for await (const doc of crawler.collect(target, options)) {
          const filename = `${platform}_${count.toString().padStart(5, '0')}.json`;
          const filePath = path.join(platformDir, filename);
          const content = JSON.stringify(doc, null, 2);

          fs.writeFileSync(filePath, content, 'utf-8');

          // 记录文件 hash
          const hash = createHash('sha256').update(content).digest('hex');
          setFileHash(filePath, hash, 'collect');

          count++;
        }
      } catch (err) {
        this.logger.error(`[${platform}] 采集出错: ${(err as Error).message}`);
      }

      this.logger.info(`[${platform}] 采集完成: ${count} 条文档`);
      totalDocs += count;
    }

    return totalDocs;
  }

  /** 从本地路径加载数据 */
  async collectFromLocal(localPath: string, target: string): Promise<number> {
    return this.collectFromPlatforms(target, ['local'], { localPath } as CrawlerOptions & { localPath: string });
  }

  /** 生成采集摘要 */
  generateSummary(): CollectionSummary {
    const rawDir = path.join(this.config.workspaceDir, 'raw');
    const summary: CollectionSummary = {
      totalFiles: 0,
      totalChars: 0,
      platforms: {},
    };

    if (!fs.existsSync(rawDir)) return summary;

    for (const platform of fs.readdirSync(rawDir)) {
      const platformDir = path.join(rawDir, platform);
      if (!fs.statSync(platformDir).isDirectory()) continue;

      const files = fs.readdirSync(platformDir).filter(f => f.endsWith('.json'));
      let chars = 0;

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(platformDir, file), 'utf-8');
          const doc: RawDocument = JSON.parse(raw);
          chars += (doc.content?.length ?? 0);
        } catch { /* skip malformed */ }
      }

      summary.platforms[platform] = { files: files.length, chars };
      summary.totalFiles += files.length;
      summary.totalChars += chars;
    }

    return summary;
  }
}

export interface CollectionSummary {
  totalFiles: number;
  totalChars: number;
  platforms: Record<string, { files: number; chars: number }>;
}
