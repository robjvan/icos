/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { ChannelDatabaseService } from './channel-database.service';
import { ChannelRepository } from './channel.repository';
import type {
  ChannelAttachment,
  ChannelDelivery,
  ChannelDeliveryStatus,
  ChannelMessage,
  NewChannelDelivery,
  NewChannelMessage,
} from './channel.types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface MessageRow {
  id: string;
  channel: string;
  direction: string;
  external_id: string | null;
  conversation_key: string;
  peer_id: string | null;
  session_id: string | null;
  body: string;
  attachments_json: string;
  provenance_json: string;
  created_at: string;
}

interface DeliveryRow {
  id: string;
  channel: string;
  conversation_key: string;
  body: string;
  reply_to_message_id: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  external_message_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function capLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
}

function parseAttachments(value: string): ChannelAttachment[] {
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ChannelAttachment[]) : [];
  } catch {
    return [];
  }
}

function parseProvenance(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapMessage(row: MessageRow): ChannelMessage {
  return {
    id: row.id,
    channel: row.channel as ChannelMessage['channel'],
    direction: row.direction as ChannelMessage['direction'],
    externalId: row.external_id,
    conversationKey: row.conversation_key,
    peerId: row.peer_id,
    sessionId: row.session_id,
    body: row.body,
    attachments: parseAttachments(row.attachments_json),
    provenance: parseProvenance(row.provenance_json),
    createdAt: row.created_at,
  };
}

function mapDelivery(row: DeliveryRow): ChannelDelivery {
  return {
    id: row.id,
    channel: row.channel as ChannelDelivery['channel'],
    conversationKey: row.conversation_key,
    body: row.body,
    replyToMessageId: row.reply_to_message_id,
    status: row.status as ChannelDeliveryStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    externalMessageId: row.external_message_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SqliteChannelRepository extends ChannelRepository {
  constructor(private readonly databaseService: ChannelDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async recordMessage(input: NewChannelMessage): Promise<ChannelMessage> {
    const id = randomUUID();
    const now = input.createdAt ?? nowIso();
    this.database
      .prepare(
        `INSERT INTO channel_messages (
           id, channel, direction, external_id, conversation_key, peer_id,
           session_id, body, attachments_json, provenance_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.channel,
        input.direction,
        input.externalId ?? null,
        input.conversationKey,
        input.peerId ?? null,
        input.sessionId ?? null,
        input.body,
        JSON.stringify(input.attachments ?? []),
        JSON.stringify(input.provenance ?? {}),
        now,
      );
    const row = this.database
      .prepare('SELECT * FROM channel_messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    if (!row) throw new Error('Channel message vanished after insert');
    return mapMessage(row);
  }

  async getMessage(id: string): Promise<ChannelMessage | null> {
    const row = this.database
      .prepare('SELECT * FROM channel_messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    return row ? mapMessage(row) : null;
  }

  async findMessageByExternalId(
    channel: string,
    externalId: string,
  ): Promise<ChannelMessage | null> {
    const row = this.database
      .prepare(
        'SELECT * FROM channel_messages WHERE channel = ? AND external_id = ?',
      )
      .get(channel, externalId) as MessageRow | undefined;
    return row ? mapMessage(row) : null;
  }

  async listMessages(
    conversationKey: string,
    limit?: number,
  ): Promise<ChannelMessage[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM channel_messages
         WHERE conversation_key = ?
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
      )
      .all(conversationKey, capLimit(limit)) as MessageRow[];
    return rows.map(mapMessage);
  }

  async enqueueDelivery(input: NewChannelDelivery): Promise<ChannelDelivery> {
    const id = randomUUID();
    const now = nowIso();
    this.database
      .prepare(
        `INSERT INTO channel_deliveries (
           id, channel, conversation_key, body, reply_to_message_id,
           status, attempts, next_attempt_at, external_message_id, last_error,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        input.channel,
        input.conversationKey,
        input.body,
        input.replyToMessageId ?? null,
        input.nextAttemptAt ?? now,
        now,
        now,
      );
    const row = this.database
      .prepare('SELECT * FROM channel_deliveries WHERE id = ?')
      .get(id) as DeliveryRow | undefined;
    if (!row) throw new Error('Delivery vanished after insert');
    return mapDelivery(row);
  }

  async getDelivery(id: string): Promise<ChannelDelivery | null> {
    const row = this.database
      .prepare('SELECT * FROM channel_deliveries WHERE id = ?')
      .get(id) as DeliveryRow | undefined;
    return row ? mapDelivery(row) : null;
  }

  async claimDueDelivery(now: string): Promise<ChannelDelivery | null> {
    const row = this.database
      .prepare(
        `UPDATE channel_deliveries
         SET status = 'sending',
             attempts = attempts + 1,
             updated_at = ?
         WHERE id = (
           SELECT id FROM channel_deliveries
           WHERE status IN ('pending', 'failed')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY created_at ASC, rowid ASC
           LIMIT 1
         )
         RETURNING *`,
      )
      .get(now, now) as DeliveryRow | undefined;
    return row ? mapDelivery(row) : null;
  }

  async markDeliverySent(
    id: string,
    externalMessageId: string | null,
  ): Promise<ChannelDelivery | null> {
    this.database
      .prepare(
        `UPDATE channel_deliveries
         SET status = 'sent',
             external_message_id = ?,
             next_attempt_at = NULL,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(externalMessageId, nowIso(), id);
    return this.getDelivery(id);
  }

  async markDeliveryFailed(
    id: string,
    error: string,
    nextAttemptAt: string | null,
  ): Promise<ChannelDelivery | null> {
    this.database
      .prepare(
        `UPDATE channel_deliveries
         SET status = ?,
             last_error = ?,
             next_attempt_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        nextAttemptAt ? 'failed' : 'abandoned',
        error,
        nextAttemptAt,
        nowIso(),
        id,
      );
    return this.getDelivery(id);
  }

  async listDeliveries(
    status?: ChannelDeliveryStatus,
    limit?: number,
  ): Promise<ChannelDelivery[]> {
    const capped = capLimit(limit);
    const rows = status
      ? (this.database
          .prepare(
            `SELECT * FROM channel_deliveries
             WHERE status = ?
             ORDER BY created_at ASC, rowid ASC
             LIMIT ?`,
          )
          .all(status, capped) as DeliveryRow[])
      : (this.database
          .prepare(
            `SELECT * FROM channel_deliveries
             ORDER BY created_at ASC, rowid ASC
             LIMIT ?`,
          )
          .all(capped) as DeliveryRow[]);
    return rows.map(mapDelivery);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
