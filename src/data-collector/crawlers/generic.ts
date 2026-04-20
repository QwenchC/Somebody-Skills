import type { Crawler, CrawlerOptions, RawDocument } from '../index.js';
import * as cheerio from 'cheerio';

/**
 * 通用网页爬虫
 * target 为 URL 或 URL 列表（逗号分隔），抓取页面正文内容
 */
export class GenericWebCrawler implements Crawler {
  readonly platform = 'web';

  async *collect(target: string, options: CrawlerOptions): AsyncIterable<RawDocument> {
    const urls = target.split(',').map(u => u.trim()).filter(Boolean);
    const delay = options.delayMs ?? 2000;

    for (const url of urls) {
      // 检查 robots.txt
      const allowed = await this.checkRobots(url);
      if (!allowed) {
        console.warn(`[web] robots.txt 禁止访问: ${url}，已跳过`);
        continue;
      }

      try {
        const headers: Record<string, string> = {
          'User-Agent': this.randomUA(),
        };
        if (options.cookie) {
          headers['Cookie'] = options.cookie;
        }

        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        // 移除无关内容
        $('script, style, nav, footer, header, aside, .ad, .advertisement').remove();

        const title = $('title').text().trim() || $('h1').first().text().trim() || url;
        const content = $('article').text().trim()
          || $('main').text().trim()
          || $('body').text().trim();

        if (content.length < 50) continue; // 跳过内容过少的页面

        yield {
          source: 'web',
          type: 'article',
          title,
          content: this.cleanText(content),
          url,
          timestamp: new Date().toISOString(),
          metadata: { type: 'webpage' },
        };
      } catch (err) {
        console.warn(`[web] 抓取失败 ${url}: ${(err as Error).message}`);
      }

      await this.sleep(delay);
    }
  }

  private async checkRobots(url: string): Promise<boolean> {
    try {
      const u = new URL(url);
      const robotsUrl = `${u.origin}/robots.txt`;
      const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return true; // 无 robots.txt 则允许

      const text = await res.text();
      const path = u.pathname;

      // 简单解析：查找 User-agent: * 的 Disallow 规则
      let inWildcard = false;
      for (const line of text.split('\n')) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.startsWith('user-agent:')) {
          inWildcard = trimmed.includes('*');
        } else if (inWildcard && trimmed.startsWith('disallow:')) {
          const disallowed = trimmed.slice('disallow:'.length).trim();
          if (disallowed && path.startsWith(disallowed)) {
            return false;
          }
        }
      }
      return true;
    } catch {
      return true;
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/[\t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private randomUA(): string {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
