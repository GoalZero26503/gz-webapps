import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  paginateScan,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../config.js';

/**
 * Minimal table abstraction over the app's KV data (charter §3.5 DynamoDB
 * escape hatch — gzops data is genuinely KV-shaped). Tables are tiny
 * (tens of rows), so list() is a scan; sorting/filtering happens in code.
 *
 * Backends: DynamoDB in AWS, an in-memory map (seeded demo data) for local
 * dev — local machines never write to AWS.
 */
export interface KvTable<T extends object> {
  get(keyValue: string): Promise<T | null>;
  put(item: T): Promise<void>;
  delete(keyValue: string): Promise<void>;
  list(): Promise<T[]>;
}

class DynamoTable<T extends object> implements KvTable<T> {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly keyAttr: string,
  ) {}

  async get(keyValue: string): Promise<T | null> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { [this.keyAttr]: keyValue } }),
    );
    return (result.Item as T | undefined) ?? null;
  }

  async put(item: T): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  async delete(keyValue: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tableName, Key: { [this.keyAttr]: keyValue } }),
    );
  }

  async list(): Promise<T[]> {
    const items: T[] = [];
    for await (const page of paginateScan({ client: this.doc }, { TableName: this.tableName })) {
      items.push(...((page.Items as T[]) ?? []));
    }
    return items;
  }
}

class MemoryTable<T extends object> implements KvTable<T> {
  private readonly items = new Map<string, T>();

  constructor(private readonly keyAttr: string) {}

  async get(keyValue: string): Promise<T | null> {
    return this.items.get(keyValue) ?? null;
  }

  async put(item: T): Promise<void> {
    this.items.set(String((item as Record<string, unknown>)[this.keyAttr]), structuredClone(item));
  }

  async delete(keyValue: string): Promise<void> {
    this.items.delete(keyValue);
  }

  async list(): Promise<T[]> {
    return [...this.items.values()].map((i) => structuredClone(i));
  }
}

export interface AppTables {
  users: KvTable<Record<string, unknown>>;
  requests: KvTable<Record<string, unknown>>;
  notifications: KvTable<Record<string, unknown>>;
  programs: KvTable<Record<string, unknown>>;
  accessLog: KvTable<Record<string, unknown>>;
}

const TABLE_KEYS = {
  users: { table: 'Users', key: 'email' },
  requests: { table: 'Requests', key: 'id' },
  notifications: { table: 'Notifications', key: 'id' },
  programs: { table: 'Programs', key: 'id' },
  accessLog: { table: 'AccessLog', key: 'id' },
} as const;

let tables: AppTables | null = null;
let memorySeeded = false;

export function getTables(): AppTables {
  if (tables) return tables;
  const config = getConfig();

  if (config.storeMode === 'memory') {
    tables = Object.fromEntries(
      Object.entries(TABLE_KEYS).map(([name, def]) => [name, new MemoryTable(def.key)]),
    ) as unknown as AppTables;
  } else {
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    tables = Object.fromEntries(
      Object.entries(TABLE_KEYS).map(([name, def]) => [
        name,
        new DynamoTable(doc, `${config.tablePrefix}${def.table}`, def.key),
      ]),
    ) as unknown as AppTables;
  }
  return tables;
}

/** Memory-mode demo seed runs once, lazily, from the first store access. */
export async function ensureSeeded(): Promise<void> {
  if (memorySeeded || getConfig().storeMode !== 'memory') return;
  memorySeeded = true;
  const { seedMemoryStore } = await import('./seed.js');
  await seedMemoryStore();
}

export function typedTable<T extends object>(
  pick: (t: AppTables) => KvTable<Record<string, unknown>>,
): KvTable<T> {
  return pick(getTables()) as unknown as KvTable<T>;
}
