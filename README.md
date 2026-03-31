# OpenClaw HTTP Message Plugin

HTTP interface plugin for sending messages to OpenClaw gateway via WebSocket.

## Quick Start

This plugin exposes an HTTP API to interact with OpenClaw's WebSocket gateway. It's typically accessed through OpenClaw's main HTTP server (port 18789 by default).

All API endpoints are prefixed with `/api/gateway`.

### 1. Configure Gateway Connection

Before sending messages, configure the WebSocket connection to your OpenClaw gateway:

```bash
curl -X POST http://localhost:18789/api/api/gateway/config \
  -H "Content-Type: application/json" \
  -d '{
    "wsUrl": "ws://localhost:18789",
    "authToken": "your_token",
    "authMode": "token"
  }'
```

**Default Configuration:**
- `wsUrl`: `ws://localhost:18789`
- `clientId`: `webchat`
- `authMode`: `token`

### 2. Connect to Gateway

```bash
curl -X POST http://localhost:18789/api/api/gateway/connect
```

Check connection status:
```bash
curl http://localhost:18789/api/gateway/status
```

### 3. Send Messages

```bash
curl -X POST http://localhost:18789/api/api/gateway/message/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "session_key",
    "message": "Hello, world!"
  }'
```

## API Reference

All endpoints are prefixed with `/api/gateway/`.

```
GET /api/gateway/status
```

Returns gateway connection status.

**Response:**
```json
{
  "status": "connected",
  "connected": true
}
```

### Configure Gateway

```
POST /api/gateway/config
```

Configure WebSocket connection parameters.

**Request:**
```json
{
  "wsUrl": "ws://localhost:18789",
  "authToken": "your_token",
  "authMode": "token",
  "clientId": "webchat"
}
```

### Connect / Disconnect

```
POST /api/gateway/connect
POST /api/gateway/disconnect
```

### Send Text Message

```
POST /api/gateway/message/send
```

**Request:**
```json
{
  "to": "session_key",
  "message": "Hello, world!"
}
```

### Send Image

```
POST /api/gateway/message/image
```

**Request:**
```json
{
  "to": "session_key",
  "imageUrl": "https://example.com/image.png"
}
```

### Stream Messages (SSE)

Subscribe to real-time message events.

```
GET /api/gateway/stream?session=session_key
```

**Event Types:**
- `delta` - Streaming message chunk
- `final` - Message complete
- `error` - Error occurred
- `aborted` - Stream aborted

**Example:**
```bash
curl -N http://localhost:18789/api/gateway/stream?session=my_session
```

### Send Message with Streaming Response

```
POST /api/gateway/stream/send
```

Send a message and receive streaming response via SSE.

**Request:**
```json
{
  "to": "session_key",
  "message": "Hello!"
}
```

**Example:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"to": "my_session", "message": "Hello"}' \
  http://localhost:18789/api/gateway/stream/send
```

### Get Contacts

```
GET /api/gateway/contacts
```

### Get Conversations

```
GET /api/gateway/conversations
```

### Raw Gateway Command

```
POST /api/gateway/raw
```

Execute arbitrary gateway methods.

**Request:**
```json
{
  "method": "chat.send",
  "params": {
    "sessionKey": "session_key",
    "message": "Hello"
  }
}
```

## Development

```bash
# Type check
pnpm exec tsc --noEmit

# Build (if needed)
pnpm exec openclaw plugins build
```

## Dependencies

- `ws` - WebSocket client
