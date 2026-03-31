import WebSocket from 'ws';
import {
  getOrCreateDeviceIdentity,
  buildDeviceAuthPayload,
  signPayload,
} from './device-identity.js';
import type {
  JsonPayload,
  GatewayStatus,
  GatewayEventHandler,
  GatewayMessage,
  PendingRequest,
  GatewayConfig,
  DeviceIdentity,
  StreamMessageEvent,
  ChatEvent,
} from '../types/index.js';

export class GatewayService {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private connected = false;
  private autoReconnect = true;
  private connectNonce: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private status: GatewayStatus = 'disconnected';
  private deviceIdentity: DeviceIdentity | null = null;
  private eventHandlers: GatewayEventHandler[] = [];
  private streamSubscribers = new Map<string, Set<(event: StreamMessageEvent) => void>>();

  private wsUrl = 'ws://localhost:18789';
  private authToken = '';
  private authMode: 'token' | 'password' = 'token';
  private clientId = 'webchat';

  constructor(config?: Partial<GatewayConfig>) {
    if (config?.wsUrl) this.wsUrl = config.wsUrl;
    if (config?.authToken) this.authToken = config.authToken;
    if (config?.authMode) this.authMode = config.authMode;
    if (config?.clientId) this.clientId = config.clientId;
  }

  async initialize(): Promise<void> {
    try {
      this.deviceIdentity = await getOrCreateDeviceIdentity();
      console.log(`Device identity loaded: ${this.deviceIdentity.id}`);
    } catch (err) {
      console.warn('Failed to load device identity, connecting without it:', err);
    }
  }

  private genId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private genIdempotencyKey(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  getStatus(): GatewayStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setConfig(config: Partial<GatewayConfig>): void {
    if (config.wsUrl) this.wsUrl = config.wsUrl;
    if (config.authToken) this.authToken = config.authToken;
    if (config.authMode) this.authMode = config.authMode;
    if (config.clientId) this.clientId = config.clientId;
  }

  connect(): void {
    if (this.ws) return;
    this.autoReconnect = true;
    this.connectNonce = null;
    this.status = 'connecting';
    console.log(`Connecting to ${this.wsUrl}...`);

    this.ws = new WebSocket(this.wsUrl, {
      headers: {
        origin: 'http://127.0.0.1:18789',
      },
    });

    this.ws.on('open', () => {
      console.log('WebSocket connection opened');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        let rawData: string;
        if (Buffer.isBuffer(data)) {
          rawData = data.toString('utf-8');
        } else if (data instanceof ArrayBuffer) {
          rawData = Buffer.from(data).toString('utf-8');
        } else if (Array.isArray(data)) {
          rawData = Buffer.concat(data).toString('utf-8');
        } else {
          rawData = data;
        }
        const msg = JSON.parse(rawData) as GatewayMessage;
        this.handleMessage(msg);
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`Failed to parse message: ${error}`);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.warn(`WebSocket closed: ${code} ${reason.toString()}`);
      this.ws = null;
      this.connected = false;
      this.status = 'disconnected';
      this.rejectAllPending('disconnected');
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error: Error) => {
      console.error('WebSocket error', error);
    });
  }

  private handleMessage(msg: GatewayMessage): void {
    console.log(`Received: ${msg.type} ${msg.event || msg.id || ''}`);

    if (msg.type === 'event') {
      if (msg.event === 'connect.challenge') {
        const payload = msg.payload as Record<string, unknown> | undefined;
        this.connectNonce =
          payload && typeof payload.nonce === 'string' ? payload.nonce : null;
        void this.handleChallenge();
      } else if (msg.event === 'chat.delta' || msg.event === 'chat.final' || msg.event === 'chat.error' || msg.event === 'chat.aborted') {
        this.handleChatEvent(msg);
      }
      // 触发所有事件处理器（包括 chat 事件）
      for (const handler of this.eventHandlers) {
        handler(msg.event ?? '', msg.payload ?? {});
      }
    } else if (msg.type === 'res' && msg.id) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) {
          pending.resolve(msg.payload ?? {});
        } else {
          pending.reject(msg.payload ?? msg.error ?? 'unknown error');
        }
      }
    }
  }

  private handleChatEvent(msg: GatewayMessage): void {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : 'default';
    const runId = typeof payload.runId === 'string' ? payload.runId : '';
    const message = payload.message as Record<string, unknown> | undefined;

    const state = msg.event?.replace('chat.', '') || 'final';

    const streamEvent: StreamMessageEvent = {
      type: (msg.event?.replace('chat.', '') as StreamMessageEvent['type']) || 'final',
      runId,
      sessionKey,
      content: typeof message?.content === 'string' ? message.content : undefined,
      messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
      errorMessage: typeof payload.errorMessage === 'string' ? payload.errorMessage : undefined,
    };

    this.broadcastStreamEvent(sessionKey, streamEvent);
    this.broadcastStreamEvent('*', streamEvent);

    for (const handler of this.eventHandlers) {
      handler('chat', {
        state,
        runId,
        sessionKey,
        message: payload.message,
        errorMessage: payload.errorMessage,
      });
    }
  }

  private broadcastStreamEvent(sessionKey: string, event: StreamMessageEvent): void {
    const subscribers = this.streamSubscribers.get(sessionKey);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(event);
        } catch (err) {
          console.error(`Stream subscriber error: ${err}`);
        }
      }
    }
  }

  private async handleChallenge(): Promise<void> {
    const id = this.genId('connect');
    const role = 'operator';
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];
    console.log(`Requesting scopes: ${scopes.join(', ')}`);

    const signedAtMs = Date.now();
    const nonce = this.connectNonce ?? undefined;

    let device: Record<string, unknown> | undefined;
    if (this.deviceIdentity) {
      const privateKey = await this.getPrivateKeyObject(this.deviceIdentity.privateKey);
      const payload = buildDeviceAuthPayload({
        deviceId: this.deviceIdentity.id,
        clientId: this.clientId,
        clientMode: 'webchat',
        role,
        scopes,
        signedAtMs,
        token: this.authMode === 'password' ? null : this.authToken || null,
        nonce,
      });
      const signature = signPayload(privateKey, payload);
      device = {
        id: this.deviceIdentity.id,
        publicKey: this.deviceIdentity.publicKeyRaw,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }

    try {
      await this.request(id, 'connect', {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: this.clientId,
          version: '1.0.0',
          platform: 'web',
          mode: 'webchat',
        },
        role,
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth:
          this.authMode === 'password'
            ? { password: this.authToken }
            : { token: this.authToken },
        device,
        locale: 'en',
        userAgent: `openclaw-http-message/1.0.0`,
      });

      console.log('Connected to OpenClaw gateway');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.status = 'connected';
    } catch (err) {
      console.error('Connection failed', err);
      const errObj = err as Record<string, unknown>;
      if (
        errObj &&
        (errObj.code === 'NOT_PAIRED' ||
          (typeof errObj.message === 'string' &&
            errObj.message.includes('NOT_PAIRED')))
      ) {
        console.warn('Device not paired — awaiting approval');
        this.status = 'pairing';
        return;
      }
      this.autoReconnect = false;
      this.disconnect();
    }
  }

  private async getPrivateKeyObject(jwk: JsonWebKey): Promise<import('crypto').KeyObject> {
    const crypto = await import('crypto');
    return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const base = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    const jitter = Math.random() * base * 0.3;
    const delay = base + jitter;
    this.reconnectAttempts++;
    console.log(
      `Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.autoReconnect = false;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.status = 'disconnected';
  }

  private rejectAllPending(reason: string): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    });
    this.pendingRequests.clear();
  }

  private request(
    id: string,
    method: string,
    params: JsonPayload,
  ): Promise<JsonPayload> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('not connected'));
      }

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('timeout'));
        }
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      const message = JSON.stringify({ type: 'req', id, method, params });
      this.ws.send(message);
    });
  }

  private onChatEvent(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  private waitForChatEvents(
    sessionKey: string,
    runId: string,
    timeout = 120000,
  ): Promise<ChatEvent[]> {
    return new Promise((resolve, reject) => {
      const events: ChatEvent[] = [];
      const timer = setTimeout(() => {
        off();
        reject(new Error('timeout waiting for chat response'));
      }, timeout);

      const off = this.onChatEvent((event, payload) => {
        const p = payload as Record<string, unknown>;
        const payloadSessionKey = typeof p.sessionKey === 'string' ? p.sessionKey : '';
        const payloadRunId = typeof p.runId === 'string' ? p.runId : '';

        if (payloadSessionKey !== sessionKey || payloadRunId !== runId) return;

        if (event === 'chat.delta' || event === 'chat.final' || event === 'chat.error' || event === 'chat.aborted') {
          const state = event.replace('chat.', '') as 'delta' | 'final' | 'error' | 'aborted';
          events.push({
            state,
            runId: payloadRunId,
            sessionKey: payloadSessionKey,
            message: p.message as Record<string, unknown> | undefined,
            errorMessage: p.errorMessage as string | undefined,
          });

          if (state === 'final' || state === 'error' || state === 'aborted') {
            clearTimeout(timer);
            off();
            resolve(events);
          }
        }
      });
    });
  }

  async send(method: string, params: JsonPayload): Promise<JsonPayload> {
    const id = this.genId('req');
    console.log(`Sending request: ${method} with id ${id}`);
    return this.request(id, method, params);
  }

  async sendMessage(to: string, message: string, deliver = false): Promise<JsonPayload> {
    console.log(`sendMessage called: to=${to}, message=${message}, deliver=${deliver}`);
    try {
      const result = await this.send('chat.send', {
        sessionKey: to,
        message,
        deliver,
        idempotencyKey: this.genIdempotencyKey(),
      }) as { runId?: string; status?: string };

      console.log(`chat.send response: ${JSON.stringify(result)}`);

      if (result.runId) {
        const chatEvents = await this.waitForChatEvents(to, result.runId);
        console.log(`chat events received: ${JSON.stringify(chatEvents)}`);

        const finalEvent = chatEvents.find(e => e.state === 'final');
        const errorEvent = chatEvents.find(e => e.state === 'error');
        const abortedEvent = chatEvents.find(e => e.state === 'aborted');

        if (errorEvent) {
          throw new Error(errorEvent.errorMessage || 'chat error');
        }
        if (abortedEvent) {
          return { runId: result.runId, status: 'aborted', events: chatEvents };
        }

        const responseContent = chatEvents
          .filter(e => e.state === 'delta' || e.state === 'final')
          .map(e => e.message?.content)
          .filter(Boolean)
          .join('');

        return {
          runId: result.runId,
          status: 'ok',
          content: responseContent,
          events: chatEvents,
        };
      }

      console.log(`sendMessage result: ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      console.error(`sendMessage error:`, JSON.stringify(err));
      console.error(`sendMessage error: ${err}`);
      throw err;
    }
  }

  sendMessageStream(
    to: string,
    message: string,
    onEvent: (event: StreamMessageEvent) => void,
  ): { runId: Promise<string>; unsubscribe: () => void } {
    const idempotencyKey = this.genIdempotencyKey();
    let resolvedRunId: string | null = null;
    let runIdResolve: (id: string) => void;
    const runIdPromise = new Promise<string>((resolve) => {
      runIdResolve = resolve;
    });

    const handleChatEvent = (event: string, payload: Record<string, unknown>) => {
      if (event === 'chat.delta' || event === 'chat.final' || event === 'chat.error' || event === 'chat.aborted') {
        const p = payload as Record<string, unknown>;
        const payloadSessionKey = typeof p.sessionKey === 'string' ? p.sessionKey : '';
        const payloadRunId = typeof p.runId === 'string' ? p.runId : '';

        if (payloadSessionKey !== to) return;

        if (payloadRunId && !resolvedRunId) {
          resolvedRunId = payloadRunId;
          runIdResolve(payloadRunId);
        }

        const state = event.replace('chat.', '') as 'delta' | 'final' | 'error' | 'aborted';
        const messagePayload = p.message as Record<string, unknown> | undefined;
        const streamEvent: StreamMessageEvent = {
          type: state,
          runId: payloadRunId,
          sessionKey: payloadSessionKey,
          content: typeof messagePayload?.content === 'string' ? messagePayload.content : undefined,
          messageId: typeof p.messageId === 'string' ? p.messageId : undefined,
          errorMessage: typeof p.errorMessage === 'string' ? p.errorMessage : undefined,
        };

        onEvent(streamEvent);
      }
    };

    const unsubscribe = this.onChatEvent(handleChatEvent);

    this.send('chat.send', {
      sessionKey: to,
      message,
      deliver: false,
      idempotencyKey,
    }).catch((err) => {
      console.error(`sendMessageStream error: ${err}`);
      onEvent({
        type: 'error',
        runId: resolvedRunId || '',
        sessionKey: to,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });

    return {
      runId: runIdPromise,
      unsubscribe,
    };
  }

  subscribeToStream(
    sessionKey: string,
    callback: (event: StreamMessageEvent) => void,
  ): () => void {
    if (!this.streamSubscribers.has(sessionKey)) {
      this.streamSubscribers.set(sessionKey, new Set());
    }
    this.streamSubscribers.get(sessionKey)!.add(callback);
    return () => {
      const subscribers = this.streamSubscribers.get(sessionKey);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          this.streamSubscribers.delete(sessionKey);
        }
      }
    };
  }

  getStreamSubscribersCount(sessionKey: string): number {
    return this.streamSubscribers.get(sessionKey)?.size ?? 0;
  }

  async sendImage(to: string, imageUrl: string): Promise<JsonPayload> {
    return this.send('chat.send', {
      sessionKey: to,
      message: '',
      attachments: [
        { mimeType: 'image/png', fileName: 'image.png', content: imageUrl },
      ],
      deliver: false,
      idempotencyKey: this.genIdempotencyKey(),
    });
  }

  async getContacts(): Promise<JsonPayload> {
    return this.send('contact.list', {});
  }

  async getConversations(): Promise<JsonPayload> {
    return this.send('conversation.list', {});
  }

  onEvent(handler: GatewayEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  waitForChatResponse(
    sessionKey: string,
    runId: string,
    timeout = 120000,
  ): Promise<ChatEvent[]> {
    return new Promise((resolve, reject) => {
      const events: ChatEvent[] = [];
      const timer = setTimeout(() => {
        off();
        reject(new Error('timeout waiting for chat response'));
      }, timeout);

      const off = this.onEvent((event, payload) => {
        if (event !== 'chat') return;
        const p = payload as Record<string, unknown>;
        if (p.sessionKey !== sessionKey) return;
        if (p.runId !== runId) return;

        const state = p.state as string;
        if (
          state === 'delta' ||
          state === 'final' ||
          state === 'error' ||
          state === 'aborted'
        ) {
          events.push({
            state,
            runId: p.runId as string,
            sessionKey: p.sessionKey as string,
            message: p.message as Record<string, unknown> | undefined,
            errorMessage: p.errorMessage as string | undefined,
          });

          if (state === 'final' || state === 'error' || state === 'aborted') {
            clearTimeout(timer);
            off();
            resolve(events);
          }
        }
      });
    });
  }
}
