import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SkillService } from './skill.service';
import { SkillSeedService } from './skill-seed.service';

/**
 * Skill inspection + management endpoints. The filesystem is the writer;
 * create/delete mirror the `skill_manage` tool and `/skills` commands, and
 * `seed` copies shipped skills into the runtime dir.
 */
@Controller('core/skills')
export class SkillsController {
  constructor(
    private readonly skills: SkillService,
    private readonly seed: SkillSeedService,
  ) {}

  @Get()
  list(): {
    enabled: boolean;
    skills: { name: string; description: string; version: string }[];
    skipped: { name: string; reason: string }[];
  } {
    return {
      enabled: this.skills.enabled,
      skills: this.skills.listDescriptors(),
      skipped: this.skills.getReport().skipped,
    };
  }

  @Get('discover')
  discover(@Query('q') query?: string): {
    query: string;
    matches: { name: string; score: number; matchedOn: string[] }[];
  } {
    if (!query?.trim()) {
      throw new BadRequestException('Usage: /core/skills/discover?q=<text>');
    }
    return {
      query,
      matches: this.skills.discover(query).map((m) => ({
        name: m.skill.name,
        score: m.score,
        matchedOn: m.matchedOn,
      })),
    };
  }

  @Get('active')
  active(@Query('sessionId') sessionId?: string): {
    sessionId: string;
    explicit: string[];
    requested: string[];
    contextual: string[];
    lastTurn: unknown;
  } {
    if (!sessionId?.trim()) {
      throw new BadRequestException(
        'Usage: /core/skills/active?sessionId=<id>',
      );
    }
    const last = this.skills.getLastTurn(sessionId);
    return {
      sessionId,
      explicit: this.skills.getExplicitNames(sessionId),
      requested: this.skills.getPendingNames(sessionId),
      contextual: last?.contextual ?? [],
      lastTurn: last,
    };
  }

  @Get(':name')
  async get(@Param('name') name: string): Promise<{
    name: string;
    description: string;
    version: string;
    body: string;
  }> {
    const skill = await this.skills.loadBody(name);
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      body: skill.body,
    };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: { name?: string; description?: string; body?: string },
  ): Promise<{ name: string; description: string; version: string }> {
    const name = dto?.name?.trim();
    const description = dto?.description?.trim();
    if (!name || !description) {
      throw new BadRequestException('name and description are required');
    }
    const skill = await this.skills.createSkill({
      name,
      description,
      body:
        dto.body?.trim() ||
        'TODO: describe the procedure this skill should follow.',
    });
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version,
    };
  }

  @Put(':name')
  async update(
    @Param('name') name: string,
    @Body() dto: { description?: string; body?: string },
  ): Promise<{ name: string; description: string; version: string }> {
    const description = dto?.description?.trim();
    if (!description) {
      throw new BadRequestException('description is required');
    }
    if (typeof dto?.body !== 'string' || dto.body.trim() === '') {
      throw new BadRequestException('body is required');
    }
    const skill = await this.skills.updateSkill({
      name,
      description,
      body: dto.body,
    });
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version,
    };
  }

  @Delete(':name')
  async remove(
    @Param('name') name: string,
  ): Promise<{ deleted: true; name: string }> {
    await this.skills.deleteSkill(name);
    return { deleted: true, name };
  }

  @Post('seed')
  @HttpCode(200)
  async seedSkills(@Body() dto?: { force?: boolean }) {
    return this.seed.seed({ force: dto?.force === true });
  }
}
