import { Injectable, inject } from '@angular/core';
import { SKILLS_ENDPOINT } from '../../constants';
import type {
  SkillActiveResponse,
  SkillBody,
  SkillDescriptor,
  SkillDiscoverResponse,
  SkillListResponse,
} from '../models/skill';
import { CoreApiService } from './core-api.service';

/**
 * Skill inspection + management. Read endpoints mirror the catalog; update
 * and delete mirror the `skill_manage` tool.
 */
@Injectable({ providedIn: 'root' })
export class SkillService {
  private readonly api = inject(CoreApiService);

  async list(): Promise<SkillListResponse> {
    return this.api.get<SkillListResponse>(SKILLS_ENDPOINT);
  }

  async discover(query: string): Promise<SkillDiscoverResponse> {
    return this.api.get<SkillDiscoverResponse>(`${SKILLS_ENDPOINT}/discover`, { q: query });
  }

  async active(sessionId: string): Promise<SkillActiveResponse> {
    return this.api.get<SkillActiveResponse>(`${SKILLS_ENDPOINT}/active`, { sessionId });
  }

  async body(name: string): Promise<SkillBody> {
    return this.api.get<SkillBody>(`${SKILLS_ENDPOINT}/${encodeURIComponent(name)}`);
  }

  async update(
    name: string,
    input: { description: string; body: string },
  ): Promise<SkillDescriptor> {
    return this.api.put<SkillDescriptor>(`${SKILLS_ENDPOINT}/${encodeURIComponent(name)}`, input);
  }

  async remove(name: string): Promise<{ deleted: true; name: string }> {
    return this.api.delete<{ deleted: true; name: string }>(
      `${SKILLS_ENDPOINT}/${encodeURIComponent(name)}`,
    );
  }
}
