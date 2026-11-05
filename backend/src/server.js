import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import { RoomError, RoomManager } from "./rooms.js";
import { finishTimer, TimerCommandError } from "./timer.js";

const app = express();
const httpServer = createServer(app);
const origins = (process.env.FRONTEND_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || origins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed."));
  }
}));
app.use(express.json({ limit: "16kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

const io = new Server(httpServer, {
  cors: { origin: origins, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 16_384
});
const ttlHours = Number(process.env.ROOM_TTL_HOURS || 24);
const passwordMinLength = Number(process.env.ROOM_PASSWORD_MIN_LENGTH || 4);
if (!Number.isFinite(ttlHours) || ttlHours <= 0) throw new Error("ROOM_TTL_HOURS must be greater than zero.");
if (!Number.isInteger(passwordMinLength) || passwordMinLength < 4 || passwordMinLength > 72) {
  throw new Error("ROOM_PASSWORD_MIN_LENGTH must be an integer between 4 and 72.");
}
const manager = new RoomManager({ ttlMs: ttlHours * 60 * 60_000, passwordMinLength });
const socketAttempts = new Map();

function checkSocketAuthLimit(socket) {
  const key = socket.handshake.address || "unknown";
  const now = Date.now();
  const attempts = (socketAttempts.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (attempts.length >= 15) throw new RoomError("Too many Room attempts. Wait a minute and try again.");
  attempts.push(now);
  socketAttempts.set(key, attempts);
  if (socketAttempts.size > 5_000) {
    for (const [address, timestamps] of socketAttempts) {
      if (!timestamps.some((timestamp) => now - timestamp < 60_000)) socketAttempts.delete(address);
    }
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", realtime: "socket.io", rooms: manager.rooms.size });
});
app.use((error, _request, response, _next) => {
  if (error?.message === "Origin is not allowed.") {
    response.status(403).json({ error: "Origin is not allowed." });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    response.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }
  console.error("HTTP request failed:", error);
  response.status(500).json({ error: "Request could not be completed." });
});

io.on("connection", (socket) => {
  const acknowledge = (handler) => async (payload = {}, callback = () => {}) => {
    try {
      const result = await handler(payload);
      callback({ ok: true, ...result });
    } catch (error) {
      if (error instanceof RoomError || error instanceof TimerCommandError) {
        callback({ ok: false, error: error.message });
      } else {
        console.error("Socket request failed:", error);
        callback({ ok: false, error: "Request could not be completed." });
      }
    }
  };

  const emitMembership = (code) => {
    const room = manager.rooms.get(code);
    if (room) io.to(code).emit("room:members", manager.snapshot(room).members);
  };

  const detachFromRoom = (socketId) => {
    const code = manager.leave(socketId);
    if (code) {
      socket.leave(code);
      emitMembership(code);
    }
  };

  socket.on("room:create", acknowledge(async (payload) => {
    checkSocketAuthLimit(socket);
    if (manager.getMember(socket.id)) detachFromRoom(socket.id);
    const result = await manager.create(payload, socket.id);
    socket.join(result.room.code);
    emitMembership(result.room.code);
    return result;
  }));

  socket.on("room:join", acknowledge(async (payload) => {
    checkSocketAuthLimit(socket);
    const previousCode = manager.getMember(socket.id)?.code;
    const result = await manager.join(payload, socket.id);
    if (previousCode && previousCode !== result.room.code) socket.leave(previousCode);
    if (result.replacedSocketId) {
      const replaced = io.sockets.sockets.get(result.replacedSocketId);
      if (replaced) replaced.disconnect(true);
    }
    socket.join(result.room.code);
    socket.emit("room:state", result.room.state);
    emitMembership(result.room.code);
    return result;
  }));

  socket.on("room:resync", acknowledge(async () => {
    const member = manager.getMember(socket.id);
    if (!member) throw new RoomError("Join an active Room first.");
    const room = manager.snapshot(member.room);
    socket.emit("room:state", room.state);
    return { room };
  }));

  const runCommand = (type) => acknowledge(async (payload = {}) => {
    const before = manager.getMember(socket.id);
    if (!before) throw new RoomError("Join an active Room first.");
    const state = manager.command(socket.id, { ...payload, type });
    io.to(before.code).emit("room:state", state.state);
    return { room: state };
  });

  socket.on("display:set-view", runCommand("set-view"));
  socket.on("timer:select-level", runCommand("select-level"));
  socket.on("timer:start", runCommand("start"));
  socket.on("timer:pause", runCommand("pause"));
  socket.on("timer:resume", runCommand("resume"));
  socket.on("timer:reset", runCommand("reset"));
  socket.on("audio:set-mute", runCommand("set-mute"));
  socket.on("audio:set-volume", runCommand("set-volume"));

  socket.on("room:close", acknowledge(async () => {
    const member = manager.getMember(socket.id);
    if (!member) throw new RoomError("Join an active Room first.");
    const code = member.code;
    const room = member.room;
    io.to(code).emit("room:closed");
    for (const socketId of room.members.keys()) {
      const connected = io.sockets.sockets.get(socketId);
      if (connected) connected.leave(code);
    }
    manager.close(socket.id);
    return { code };
  }));

  socket.on("room:leave", acknowledge(async () => {
    detachFromRoom(socket.id);
    return {};
  }));

  socket.on("audio:track-changed", (payload = {}) => {
    const member = manager.getMember(socket.id);
    if (member?.role === "DISPLAY" && typeof payload.trackId === "string" && payload.trackId.length <= 80) {
      io.to(member.code).emit("audio:track-changed", { trackId: payload.trackId });
    }
  });

  socket.on("disconnect", () => detachFromRoom(socket.id));
});

const completionCheck = setInterval(() => {
  const now = Date.now();
  for (const code of manager.expire()) io.to(code).emit("room:closed");
  for (const room of manager.list()) {
    const state = finishTimer(room.state, now);
    if (state !== room.state) {
      room.state = state;
      io.to(room.code).emit("room:state", manager.snapshot(room).state);
    }
  }
}, 250);
completionCheck.unref();

const port = Number(process.env.PORT || 3001);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`VAYTES API and Socket.IO listening on ${port}`);
});

const shutdown = () => {
  clearInterval(completionCheck);
  io.close(() => httpServer.close(() => process.exit(0)));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app, httpServer, io, manager };
