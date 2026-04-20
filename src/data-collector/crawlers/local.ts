import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Crawler, CrawlerOptions, RawDocument } from '../index.js';

/**
 * 本地文件加载器
 * 支持 txt, md, json, csv, pdf, docx
 */
export class LocalFileLoader implements Crawler {
  readonly platform = 'local';

  async *collect(target: string, options: CrawlerOptions): AsyncIterable<RawDocument> {
    const localPath = (options as any).localPath as string | undefined;
    if (!localPath) {
      console.warn('[local] 未指定本地路径 (--local-path)');
      return;
    }

    const resolved = path.resolve(localPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`本地路径不存在: ${resolved}`);
    }

    const seenHashes = new Set<string>();
    yield* this.walkDir(resolved, target, seenHashes);
  }

  private async *walkDir(
    dir: string,
    target: string,
    seenHashes: Set<string>,
  ): AsyncIterable<RawDocument> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        yield* this.walkDir(fullPath, target, seenHashes);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const supported = ['.txt', '.md', '.json', '.csv', '.pdf', '.docx'];
      if (!supported.includes(ext)) continue;

      try {
        const content = await this.extractContent(fullPath, ext);
        if (!content || content.length < 10) continue;

        // 去重
        const hash = createHash('sha256').update(content).digest('hex');
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        yield {
          source: 'local',
          type: this.guessType(ext),
          title: entry.name,
          content,
          metadata: {
            type: 'local_file',
            path: fullPath,
            extension: ext,
          },
        };
      } catch (err) {
        console.warn(`[local] 无法处理 ${fullPath}: ${(err as Error).message}`);
      }
    }
  }

  private async extractContent(filePath: string, ext: string): Promise<string> {
    switch (ext) {
      case '.txt':
      case '.md':
      case '.csv':
        return this.readTextFile(filePath);

      case '.json':
        return this.readJsonFile(filePath);

      case '.pdf':
        return this.readPdf(filePath);

      case '.docx':
        return this.readDocx(filePath);

      default:
        return '';
    }
  }

  private readTextFile(filePath: string): string {
    // 尝试 UTF-8，失败则用 latin1
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return fs.readFileSync(filePath, 'latin1');
    }
  }

  private readJsonFile(filePath: string): string {
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      const obj = JSON.parse(raw);
      // 如果是数组，提取所有 content/text/message 字段
      if (Array.isArray(obj)) {
        return obj.map(item => {
          if (typeof item === 'string') return item;
          return item.content ?? item.text ?? item.message ?? JSON.stringify(item);
        }).join('\n\n');
      }
      // 如果是对象，取 content 或序列化
      return obj.content ?? obj.text ?? JSON.stringify(obj, null, 2);
    } catch {
      return raw;
    }
  }

  private async readPdf(filePath: string): Promise<string> {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return data.text;
    } catch (err) {
      console.warn(`[local] PDF 解析失败 ${filePath}: ${(err as Error).message}`);
      return '';
    }
  }

  private async readDocx(filePath: string): Promise<string> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (err) {
      console.warn(`[local] DOCX 解析失败 ${filePath}: ${(err as Error).message}`);
      return '';
    }
  }

  private guessType(ext: string): string {
    switch (ext) {
      case '.md': return 'article';
      case '.json': return 'chat';
      case '.csv': return 'data';
      default: return 'article';
    }
  }
}
