import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import {
  ListSessionsQueryDto,
  ListSessionsResponseDto,
  SearchSessionsQueryDto,
  SearchSessionsResponseDto,
} from './dto/sessions.dto';

@Controller('core/sessions')
export class SessionsController {
  constructor(private readonly conversation: ConversationService) {}

  @Get()
  async list(
    @Query() query: ListSessionsQueryDto,
  ): Promise<ListSessionsResponseDto> {
    const sessions = await this.conversation.listSessions({
      limit: query.limit,
      offset: query.offset,
    });
    return { sessions };
  }

  @Get('search')
  async search(
    @Query() query: SearchSessionsQueryDto,
  ): Promise<SearchSessionsResponseDto> {
    const results = await this.conversation.searchSessions(query.q, {
      limit: query.limit,
      sessionId: query.sessionId,
    });
    return { results };
  }

  /**
   * Delete a session and its transcript. Memory derived from the session
   * (candidates, beliefs, promotions) is deliberately kept — delete it
   * separately (M20i).
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ deleted: true; id: string }> {
    const removed = await this.conversation.deleteSession(id);
    if (!removed) {
      throw new NotFoundException(`Unknown session "${id}"`);
    }
    return { deleted: true, id };
  }
}
