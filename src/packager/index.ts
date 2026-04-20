import fs from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import AdmZip from 'adm-zip';
import { Logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

export interface PackageOptions {
  output?: string;
  zip?: boolean;
}

// Register a 1-based index helper
Handlebars.registerHelper('index_1', function (this: any) {
  const data = this;
  // @ts-ignore
  return (data?.data?.index ?? 0) + 1;
});

export class Packager {
  private config = loadConfig();
  private templatePath: string;

  constructor(private logger: Logger) {
    this.templatePath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
      '../../templates/skill.md.hbs',
    );
  }

  /**
   * 从 persona.json 生成 .skill 文件夹
   */
  async pack(options: PackageOptions = {}): Promise<string> {
    const outputBase = path.resolve(options.output ?? path.join(this.config.workspaceDir, 'output'));
    const personaPath = path.join(this.config.workspaceDir, 'output', 'persona.json');

    if (!fs.existsSync(personaPath)) {
      throw new Error(`persona.json 不存在: ${personaPath}\n请先运行 sbs distill`);
    }

    const persona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));

    // 从 meta.json 补充目标名称（如果 persona.json 中未记录）
    if (!persona.target_name) {
      const metaPath = path.join(this.config.workspaceDir, 'meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          persona.target_name = JSON.parse(fs.readFileSync(metaPath, 'utf-8')).target;
        } catch { /* ignore */ }
      }
    }

    const skillData = this.transformPersonaToSkillData(persona);

    // 创建 .skill 目录
    const skillDir = path.join(outputBase, `${skillData.name}.skill`);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });

    // 渲染 SKILL.md
    const template = fs.readFileSync(this.templatePath, 'utf-8');
    const render = Handlebars.compile(template);
    const skillMd = render(skillData);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

    // 复制 persona.json 作为参考
    fs.copyFileSync(personaPath, path.join(skillDir, 'references', 'persona.json'));

    // 复制向量库（如果存在）
    const vectordbDir = path.join(this.config.workspaceDir, 'vectordb');
    if (fs.existsSync(vectordbDir)) {
      this.copyDirSync(vectordbDir, path.join(skillDir, 'references', 'vectordb'));
    }

    this.logger.info(`.skill 文件夹生成: ${skillDir}`);

    // 可选 ZIP
    if (options.zip) {
      const zipPath = `${skillDir}.zip`;
      const zip = new AdmZip();
      zip.addLocalFolder(skillDir);
      zip.writeZip(zipPath);
      this.logger.info(`ZIP 压缩包: ${zipPath}`);
    }

    return skillDir;
  }

  /**
   * 将 persona.json 转换为模板所需数据
   */
  private transformPersonaToSkillData(persona: any): SkillTemplateData {
    const dims = persona.dimensions ?? [];

    // 提取知识域
    const knowledgeDomains: Array<{ name: string; items: string[] }> = [];
    const thinkingPatterns: Array<{ name: string; description: string }> = [];
    const behaviorRules: string[] = [];
    const principles: string[] = [];

    let tone = '专业、友善';
    const phrases: string[] = [];
    let preference = '简洁明了';

    for (const dim of dims) {
      const name = dim.dimension ?? '';
      const statements: string[] = dim.statements ?? [];

      if (!statements.length) continue;

      // 分类维度
      if (name.includes('技术') || name.includes('专业') || name.includes('知识')) {
        knowledgeDomains.push({ name, items: statements });
      } else if (name.includes('思维') || name.includes('决策') || name.includes('分析')) {
        for (const s of statements) {
          thinkingPatterns.push({ name, description: s });
        }
      } else if (name.includes('价值') || name.includes('原则') || name.includes('哲学')) {
        principles.push(...statements);
      } else if (name.includes('语气') || name.includes('表达') || name.includes('风格')) {
        tone = statements[0] ?? tone;
        phrases.push(...statements.slice(1));
      } else if (name.includes('协作') || name.includes('冲突') || name.includes('沟通')) {
        behaviorRules.push(...statements);
      } else {
        // 默认归入行为准则
        behaviorRules.push(...statements);
      }
    }

    // 从共识中补充原则
    if (persona.consensus) {
      principles.push(...persona.consensus);
    }

    // 确定名称
    const name = persona.target_name ?? 'somebody';

    return {
      name,
      description: `${name} 的数字分身 — 基于 SBS 蒸馏引擎自动生成`,
      version: '1.0.0',
      created_at: new Date().toISOString().split('T')[0],
      principles: principles.length ? principles : ['保持真实，忠于原始数据'],
      knowledge_domains: knowledgeDomains,
      thinking_patterns: thinkingPatterns,
      behavior_rules: behaviorRules.length ? behaviorRules : ['以真实数据为基础回答问题'],
      style: {
        tone,
        phrases: phrases.length ? phrases : ['让我想想', '有意思'],
        preference,
      },
    };
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

interface SkillTemplateData {
  name: string;
  description: string;
  version: string;
  created_at: string;
  principles: string[];
  knowledge_domains: Array<{ name: string; items: string[] }>;
  thinking_patterns: Array<{ name: string; description: string }>;
  behavior_rules: string[];
  style: {
    tone: string;
    phrases: string[];
    preference: string;
  };
}
