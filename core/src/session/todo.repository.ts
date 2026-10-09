export type TodoStatus = 'open' | 'done';

export interface Todo {
  id: string;
  sessionId: string;
  text: string;
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * M17b per-session todo list. Working memory for the current session —
 * durable in the sessions database, cascaded with the session.
 */
export abstract class TodoRepository {
  abstract list(sessionId: string): Promise<Todo[]>;
  abstract add(sessionId: string, text: string): Promise<Todo>;
  /** Mark open → done; null when the id is unknown or already done. */
  abstract complete(sessionId: string, id: string): Promise<Todo | null>;
  abstract remove(sessionId: string, id: string): Promise<boolean>;
  abstract clear(sessionId: string): Promise<number>;
}
