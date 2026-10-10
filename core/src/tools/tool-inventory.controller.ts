import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ToolRegistry } from './tool-registry';
import { ToolPrefsService } from './tool-prefs.service';
import { ToolSurfaceService } from './tool-surface.service';
import { RequireRole } from '../auth/decorators';

export interface ToolInventoryEntry {
  name: string;
  toolset: string;
  description: string;
  /** Declared approval policy (may be overridden by `autoApprove`). */
  approval: 'none' | 'required';
  /** Global auto-approve override in effect for this tool. */
  autoApprove: boolean;
}

/**
 * Tool inventory + auto-approve (M20f). Read is open to any authenticated
 * caller; changing the auto-approve relaxation is admin-only. Mirrors the
 * `core/tools` base path of the execute-code RPC controller.
 */
@Controller('core/tools')
export class ToolInventoryController {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly prefs: ToolPrefsService,
    private readonly surface: ToolSurfaceService,
  ) {}

  @Get('inventory')
  inventory(): { tools: ToolInventoryEntry[] } {
    return { tools: this.descriptors() };
  }

  /** M20.7 tool-discovery state + bounds (read-only). */
  @Get('discovery')
  discovery(): {
    enabled: boolean;
    universe: number;
    bounds: ReturnType<ToolSurfaceService['bounds']>;
  } {
    return {
      enabled: this.surface.discoveryEnabled,
      universe: this.surface.universe().length,
      bounds: this.surface.bounds(),
    };
  }

  @RequireRole('admin')
  @Put('auto-approve/:name')
  setAutoApprove(
    @Param('name') name: string,
    @Body() dto: { autoApprove?: boolean },
  ): { tools: ToolInventoryEntry[] } {
    if (!this.registry.lookup(name)) {
      throw new NotFoundException(`Unknown tool "${name}"`);
    }
    this.prefs.setAutoApproved(name, dto?.autoApprove === true);
    return { tools: this.descriptors() };
  }

  private descriptors(): ToolInventoryEntry[] {
    return this.registry.list().map((descriptor) => ({
      name: descriptor.name,
      toolset: descriptor.toolset,
      description: descriptor.description,
      approval: descriptor.approval,
      autoApprove: this.prefs.isAutoApproved(descriptor.name),
    }));
  }
}
