import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CronService } from './cron.service';
import type { CronDelivery, CronJob } from './cron-job.repository';
import { RequireRole } from '../auth/decorators';

interface CreateCronDto {
  name?: string;
  schedule?: string;
  prompt?: string;
  sessionId?: string;
  deliver?: CronDelivery;
}

/**
 * Cron management surface (M20h). Mirrors the `cronjob_manage` tool so the
 * web client can manage jobs without a conversation turn. Reads are open to
 * any authenticated caller; mutations are admin-only.
 */
@Controller('core/cron')
export class CronController {
  constructor(private readonly cron: CronService) {}

  @Get()
  async list(): Promise<{ jobs: CronJob[] }> {
    return { jobs: await this.cron.list() };
  }

  @RequireRole('admin')
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateCronDto): Promise<{ job: CronJob }> {
    const name = dto?.name?.trim();
    const schedule = dto?.schedule?.trim();
    const prompt = dto?.prompt?.trim();
    if (!name || !schedule || !prompt) {
      throw new BadRequestException('name, schedule, and prompt are required');
    }
    const job = await this.cron.create({
      name,
      schedule,
      prompt,
      ...(dto.sessionId ? { sessionId: dto.sessionId } : {}),
      ...(dto.deliver ? { deliver: dto.deliver } : {}),
    });
    return { job };
  }

  @RequireRole('admin')
  @Post(':id/pause')
  @HttpCode(200)
  async pause(@Param('id') id: string): Promise<{ job: CronJob }> {
    return { job: await this.cron.pause(id) };
  }

  @RequireRole('admin')
  @Post(':id/resume')
  @HttpCode(200)
  async resume(@Param('id') id: string): Promise<{ job: CronJob }> {
    return { job: await this.cron.resume(id) };
  }

  @RequireRole('admin')
  @Post(':id/run')
  @HttpCode(200)
  async run(
    @Param('id') id: string,
  ): Promise<{ reply: string | null; delivered: boolean }> {
    return this.cron.runNow(id);
  }

  @RequireRole('admin')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ deleted: true; id: string }> {
    await this.cron.remove(id);
    return { deleted: true, id };
  }
}
