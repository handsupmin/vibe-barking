import { randomUUID } from 'node:crypto';

import { framePrompt } from '../prompts/frame-prompt.ts';
import type { JobRecord, ProviderGenerationResult, QueueEnqueueInput } from '../types.ts';

interface JobQueueOptions {
  processJob: (job: JobRecord) => Promise<ProviderGenerationResult>;
}

export class JobQueue {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly queue: string[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private readonly processJob: JobQueueOptions['processJob'];
  private sequence = 0;
  private running = false;

  constructor({ processJob }: JobQueueOptions) {
    this.processJob = processJob;
  }

  enqueue(input: QueueEnqueueInput): JobRecord {
    this.sequence += 1;
    const now = new Date().toISOString();
    const prompt = framePrompt({
      chunk: input.chunk,
      category: input.category,
      sequence: this.sequence,
    });

    const job: JobRecord = {
      id: randomUUID(),
      provider: input.provider,
      chunk: input.chunk.trim(),
      category: prompt.category,
      model: input.model,
      sequence: this.sequence,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      prompt,
    };

    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    void this.pump();

    return job;
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((left, right) => left.sequence - right.sequence);
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  onIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private async pump(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!jobId) {
          continue;
        }

        const current = this.jobs.get(jobId);
        if (!current) {
          continue;
        }

        this.jobs.set(jobId, {
          ...current,
          status: 'processing',
          updatedAt: new Date().toISOString(),
        });

        try {
          const result = await this.processJob(this.jobs.get(jobId)!);
          const job = this.jobs.get(jobId)!;
          this.jobs.set(jobId, {
            ...job,
            status: 'completed',
            updatedAt: new Date().toISOString(),
            outputText: result.outputText,
            preview: result.preview,
          });
        } catch (error) {
          const job = this.jobs.get(jobId)!;
          this.jobs.set(jobId, {
            ...job,
            status: 'failed',
            updatedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Job failed.',
          });
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length === 0) {
        this.resolveIdleWaiters();
      }
    }
  }

  private resolveIdleWaiters(): void {
    while (this.idleWaiters.length > 0) {
      this.idleWaiters.shift()?.();
    }
  }
}
