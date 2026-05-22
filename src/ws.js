import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export class WebSocketHub extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
  }

  handleUpgrade(req, socket) {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));

    const client = new WebSocketConnection(socket);
    this.clients.add(client);
    client.on("message", (message) => this.emit("message", client, message));
    client.on("close", () => {
      this.clients.delete(client);
      this.emit("close", client);
    });
    this.emit("connection", client);
  }

  broadcast(data) {
    for (const client of this.clients) {
      client.send(data);
    }
  }

  close() {
    for (const client of this.clients) client.close();
    this.clients.clear();
  }

  get size() {
    return this.clients.size;
  }
}

class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => this.consume(chunk));
    socket.on("close", () => this.emit("close"));
    socket.on("error", () => this.emit("close"));
  }

  send(payload) {
    if (this.socket.destroyed) return;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.socket.write(encodeFrame(text));
  }

  close() {
    if (!this.socket.destroyed) {
      this.socket.end(encodeCloseFrame());
    }
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const frame = decodeFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.consumed);

      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(encodeFrame(frame.payload, 0xA));
        continue;
      }
      if (frame.opcode === 0x1) {
        this.emit("message", frame.payload.toString("utf8"));
      }
    }
  }
}

function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function encodeCloseFrame() {
  return Buffer.from([0x88, 0x00]);
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large");
    length = Number(bigLength);
    offset += 8;
  }

  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }

  return { opcode, payload, consumed: offset + length };
}
