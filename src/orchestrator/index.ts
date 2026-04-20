import { Logger } from '../utils/logger.js';
import { getStageStatus, setStageRunning, setStageCompleted, setStageFailed, type StageStatus } from '../utils/db.js';

export type Stage = 'setup' | 'collect' | 'preprocess' | 'distill' | 'pack' | 'deploy';

const STAGE_ORDER: Stage[] = ['setup', 'collect', 'preprocess', 'distill', 'pack', 'deploy'];

export interface StageHandler {
  (logger: Logger, options?: Record<string, unknown>): Promise<void>;
}

export class Orchestrator {
  private handlers = new Map<Stage, StageHandler>();

  constructor(private logger: Logger) {}

  register(stage: Stage, handler: StageHandler): void {
    this.handlers.set(stage, handler);
  }

  /** 获取某阶段的当前状态 */
  getStatus(stage: Stage): StageStatus | 'not-started' {
    const row = getStageStatus(stage);
    return row?.status ?? 'not-started';
  }

  /** 检查某阶段是否已完成（支持断点续跑） */
  isCompleted(stage: Stage): boolean {
    return this.getStatus(stage) === 'completed';
  }

  /** 运行单个阶段 */
  async runStage(stage: Stage, options?: Record<string, unknown>): Promise<void> {
    const handler = this.handlers.get(stage);
    if (!handler) {
      throw new Error(`阶段 "${stage}" 未注册处理器`);
    }

    // 断点续跑：已完成则跳过
    if (this.isCompleted(stage)) {
      this.logger.info(`阶段 [${stage}] 已完成，跳过`);
      return;
    }

    this.logger.info(`▶ 开始阶段: ${stage}`);
    setStageRunning(stage);

    try {
      await handler(this.logger, options);
      setStageCompleted(stage);
      this.logger.info(`✓ 阶段完成: ${stage}`);
    } catch (err) {
      const msg = (err as Error).message;
      setStageFailed(stage, msg);
      this.logger.error(`✗ 阶段失败: ${stage} — ${msg}`);
      throw err;
    }
  }

  /** 从指定阶段开始顺序执行到最终阶段 */
  async runFrom(startStage: Stage, options?: Record<string, unknown>): Promise<void> {
    const startIdx = STAGE_ORDER.indexOf(startStage);
    if (startIdx === -1) throw new Error(`未知阶段: ${startStage}`);

    for (let i = startIdx; i < STAGE_ORDER.length; i++) {
      await this.runStage(STAGE_ORDER[i], options);
    }
  }

  /** 列出所有阶段及其状态 */
  listStages(): Array<{ stage: Stage; status: string }> {
    return STAGE_ORDER.map((stage) => ({
      stage,
      status: this.getStatus(stage),
    }));
  }
}
