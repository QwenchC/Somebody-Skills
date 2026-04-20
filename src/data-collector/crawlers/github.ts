import type { Crawler, CrawlerOptions, RawDocument } from '../index.js';

/**
 * GitHub 爬虫
 * 采集用户的 repos、commits、issues、README 等公开数据
 */
export class GitHubCrawler implements Crawler {
  readonly platform = 'github';

  async *collect(target: string, options: CrawlerOptions): AsyncIterable<RawDocument> {
    const token = options.githubToken ?? process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SBS-DataCollector/0.1',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const maxPages = options.maxPages ?? 5;
    const delay = options.delayMs ?? 1000;

    // 1. 采集用户信息
    const userRes = await this.fetchGH(`/users/${encodeURIComponent(target)}`, headers);
    if (userRes) {
      yield {
        source: 'github',
        type: 'profile',
        title: `${target} GitHub Profile`,
        content: `Name: ${userRes.name ?? target}\nBio: ${userRes.bio ?? ''}\nLocation: ${userRes.location ?? ''}\nBlog: ${userRes.blog ?? ''}\nPublic repos: ${userRes.public_repos}\nFollowers: ${userRes.followers}`,
        url: userRes.html_url,
        timestamp: userRes.created_at,
        metadata: { type: 'profile' },
      };
    }

    // 2. 采集用户的 repos
    const repos = await this.fetchGHPages(
      `/users/${encodeURIComponent(target)}/repos?sort=updated&per_page=30`,
      headers, maxPages,
    );

    for (const repo of repos) {
      yield {
        source: 'github',
        type: 'article',
        title: `Repo: ${repo.full_name}`,
        content: `Repository: ${repo.full_name}\nDescription: ${repo.description ?? ''}\nLanguage: ${repo.language ?? ''}\nStars: ${repo.stargazers_count}\nForks: ${repo.forks_count}\nTopics: ${(repo.topics ?? []).join(', ')}`,
        url: repo.html_url,
        timestamp: repo.updated_at,
        metadata: { type: 'repo', language: repo.language },
      };

      // 3. 采集每个 repo 的 README
      await this.sleep(delay);
      const readme = await this.fetchGH(`/repos/${repo.full_name}/readme`, headers);
      if (readme?.content) {
        try {
          const decoded = Buffer.from(readme.content, 'base64').toString('utf-8');
          yield {
            source: 'github',
            type: 'article',
            title: `README: ${repo.full_name}`,
            content: decoded,
            url: readme.html_url,
            timestamp: repo.updated_at,
            metadata: { type: 'readme', repo: repo.full_name },
          };
        } catch { /* skip decode errors */ }
      }

      // 4. 采集最近的 commits
      await this.sleep(delay);
      const commits = await this.fetchGH(
        `/repos/${repo.full_name}/commits?per_page=20`,
        headers,
      );
      if (Array.isArray(commits)) {
        for (const commit of commits) {
          const msg = commit.commit?.message;
          if (msg) {
            yield {
              source: 'github',
              type: 'comment',
              title: `Commit: ${repo.full_name}`,
              content: msg,
              url: commit.html_url,
              timestamp: commit.commit?.author?.date,
              metadata: { type: 'commit', repo: repo.full_name },
            };
          }
        }
      }

      // 5. 采集 issues（用户创建的）
      await this.sleep(delay);
      const issues = await this.fetchGH(
        `/repos/${repo.full_name}/issues?creator=${encodeURIComponent(target)}&state=all&per_page=20`,
        headers,
      );
      if (Array.isArray(issues)) {
        for (const issue of issues) {
          if (issue.pull_request) continue; // skip PRs
          yield {
            source: 'github',
            type: 'post',
            title: `Issue: ${issue.title}`,
            content: `${issue.title}\n\n${issue.body ?? ''}`,
            url: issue.html_url,
            timestamp: issue.created_at,
            metadata: { type: 'issue', repo: repo.full_name },
          };
        }
      }
    }
  }

  private async fetchGH(endpoint: string, headers: Record<string, string>): Promise<any> {
    try {
      const res = await fetch(`https://api.github.com${endpoint}`, { headers });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  private async fetchGHPages(endpoint: string, headers: Record<string, string>, maxPages: number): Promise<any[]> {
    const results: any[] = [];
    let url: string | null = `https://api.github.com${endpoint}`;
    let page = 0;

    while (url && page < maxPages) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) break;
        const data = await res.json();
        if (Array.isArray(data)) results.push(...data);

        // parse Link header for next page
        const link = res.headers.get('link');
        const next = link?.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : null;
        page++;
      } catch {
        break;
      }
    }

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
