import type {
  ClientOptions,
  ChatRequest,
  ChatResponse,
  Conversation,
  UsageStats,
  KnowledgeBase,
  Document,
  SearchResult,
  AskResponse,
  EmbeddingResponse,
  SSEEvent,
  ApiError,
} from './types.js';

export class BusinessLogicError extends Error {
  public status: number;
  public body: ApiError;

  constructor(status: number, body: ApiError) {
    const msg = body.error || body.errors?.[0]?.message || `HTTP ${status}`;
    super(msg);
    this.name = 'BusinessLogicError';
    this.status = status;
    this.body = body;
  }
}

export class BusinessLogic {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  public readonly chat: ChatClient;
  public readonly conversations: ConversationClient;
  public readonly kb: KBClient;
  public readonly embeddings: EmbeddingClient;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'https://api.businesslogic.online').replace(/\/+$/, '');
    this.timeout = options.timeout || 120000;

    const req = this.request.bind(this);
    this.chat = new ChatClient(req, this.baseUrl, this.apiKey, this.timeout);
    this.conversations = new ConversationClient(req);
    this.kb = new KBClient(req);
    this.embeddings = new EmbeddingClient(req);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      'Accept': 'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new BusinessLogicError(res.status, errBody as ApiError);
    }

    return res.json() as Promise<T>;
  }
}

class ChatClient {
  constructor(
    private req: <T>(m: string, p: string, b?: unknown) => Promise<T>,
    private baseUrl: string,
    private apiKey: string,
    private timeout: number,
  ) {}

  /** Send a message and get a synchronous response */
  async send(params: ChatRequest): Promise<ChatResponse> {
    const res = await this.req<{ data: ChatResponse }>('POST', '/v1/ai/chat/sync', params);
    return res.data;
  }

  /** Send a message and get an SSE stream */
  async *stream(params: ChatRequest): AsyncGenerator<SSEEvent> {
    const url = `${this.baseUrl}/v1/ai/chat`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new BusinessLogicError(res.status, errBody as ApiError);
    }

    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let event = '';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            data = line.slice(6);
          } else if (line === '' && event && data) {
            try {
              yield { event, data: JSON.parse(data) };
            } catch {
              yield { event, data: { raw: data } };
            }
            event = '';
            data = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

class ConversationClient {
  constructor(private req: <T>(m: string, p: string, b?: unknown) => Promise<T>) {}

  async list(): Promise<Conversation[]> {
    const res = await this.req<{ data: Conversation[] }>('GET', '/v1/ai/conversations');
    return res.data;
  }

  async get(id: string): Promise<Conversation> {
    const res = await this.req<{ data: Conversation }>('GET', `/v1/ai/conversations/${id}`);
    return res.data;
  }

  async create(title?: string): Promise<Conversation> {
    const res = await this.req<{ data: Conversation }>('POST', '/v1/ai/conversations', { title });
    return res.data;
  }

  async update(id: string, fields: { title?: string; status?: string }): Promise<Conversation> {
    const res = await this.req<{ data: Conversation }>('PATCH', `/v1/ai/conversations/${id}`, fields);
    return res.data;
  }

  async archive(id: string): Promise<void> {
    await this.req('DELETE', `/v1/ai/conversations/${id}`);
  }

  async usage(): Promise<UsageStats> {
    const res = await this.req<{ data: UsageStats }>('GET', '/v1/ai/usage');
    return res.data;
  }
}

class KBClient {
  constructor(private req: <T>(m: string, p: string, b?: unknown) => Promise<T>) {}

  async list(): Promise<KnowledgeBase[]> {
    const res = await this.req<{ data: KnowledgeBase[] }>('GET', '/v1/ai/kb/list');
    return res.data;
  }

  async create(name: string, description?: string): Promise<KnowledgeBase> {
    const res = await this.req<{ data: KnowledgeBase }>('POST', '/v1/ai/kb/create', { name, description });
    return res.data;
  }

  async get(kbId: string): Promise<KnowledgeBase> {
    const res = await this.req<{ data: KnowledgeBase }>('GET', `/v1/ai/kb/${kbId}`);
    return res.data;
  }

  async update(kbId: string, fields: Partial<Pick<KnowledgeBase, 'name' | 'description' | 'icon' | 'sort'>>): Promise<KnowledgeBase> {
    const res = await this.req<{ data: KnowledgeBase }>('PATCH', `/v1/ai/kb/${kbId}`, fields);
    return res.data;
  }

  async delete(kbId: string): Promise<void> {
    await this.req('DELETE', `/v1/ai/kb/${kbId}`);
  }

  async listDocuments(kbId: string): Promise<Document[]> {
    const res = await this.req<{ data: Document[] }>('GET', `/v1/ai/kb/${kbId}/documents`);
    return res.data;
  }

  async upload(kbId: string, fileId: string, title?: string): Promise<Document> {
    const res = await this.req<{ data: Document }>('POST', `/v1/ai/kb/${kbId}/upload`, { file_id: fileId, title });
    return res.data;
  }

  async deleteDocument(kbId: string, docId: string): Promise<void> {
    await this.req('DELETE', `/v1/ai/kb/${kbId}/documents/${docId}`);
  }

  async reindex(kbId: string, docId: string): Promise<void> {
    await this.req('POST', `/v1/ai/kb/${kbId}/reindex/${docId}`);
  }

  async search(query: string, kbId?: string, limit?: number): Promise<SearchResult[]> {
    const res = await this.req<{ data: SearchResult[] }>('POST', '/v1/ai/kb/search', { query, kb_id: kbId, limit });
    return res.data;
  }

  async ask(question: string, kbId?: string, model?: string): Promise<AskResponse> {
    const res = await this.req<{ data: AskResponse }>('POST', '/v1/ai/kb/ask', { question, kb_id: kbId, model });
    return res.data;
  }
}

class EmbeddingClient {
  constructor(private req: <T>(m: string, p: string, b?: unknown) => Promise<T>) {}

  async create(input: string | string[], model?: string): Promise<EmbeddingResponse> {
    return this.req<EmbeddingResponse>('POST', '/v1/ai/embeddings', { input, model });
  }
}
