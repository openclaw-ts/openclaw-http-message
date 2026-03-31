export type JsonPayload = Record<string, unknown>;

export type GatewayStatus = 'disconnected' | 'connecting' | 'connected' | 'pairing';

export type GatewayEventHandler = (event: string, payload: JsonPayload) => void;

export interface ChatEvent {
  state: 'delta' | 'final' | 'error' | 'aborted';
  runId: string;
  sessionKey: string;
  message?: JsonPayload;
  errorMessage?: string;
}

export interface GatewayMessage {
  type: 'event' | 'res' | 'req';
  event?: string;
  payload?: JsonPayload;
  id?: string;
  ok?: boolean;
  error?: string;
  method?: string;
  params?: JsonPayload;
}

export interface PendingRequest {
  resolve: (v: JsonPayload) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface GatewayConfig {
  wsUrl: string;
  authToken: string;
  authMode: 'token' | 'password';
  clientId: string;
}

export interface SendMessageDto {
  to: string;
  message: string;
}

export interface SendImageDto {
  to: string;
  imageUrl: string;
}

export interface SendRawDto {
  method: string;
  params?: JsonPayload;
}

export interface SetConfigDto {
  wsUrl?: string;
  authToken?: string;
  authMode?: 'token' | 'password';
  clientId?: string;
}

export interface DeviceIdentity {
  id: string;
  publicKeyRaw: string;
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

export interface StreamMessageEvent {
  type: 'delta' | 'final' | 'error' | 'aborted';
  runId: string;
  sessionKey: string;
  content?: string;
  messageId?: string;
  errorMessage?: string;
}

export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

export interface SendStreamMessageDto {
  to: string;
  message: string;
  stream?: boolean;
}

export interface SubscribeStreamDto {
  sessionKey?: string;
}
