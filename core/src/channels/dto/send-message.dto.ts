import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { ChannelName } from '../channel.types';

/** M16e: an operator-initiated outbound message. */
export class ChannelSendMessageDto {
  @IsIn(['discord', 'email'])
  channel!: ChannelName;

  /**
   * The target conversation key, e.g. `discord:<guild>:<channel>`,
   * `discord:<guild>:<channel>:thread:<thread>`, or `discord:dm:<userId>`.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  conversationKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}
