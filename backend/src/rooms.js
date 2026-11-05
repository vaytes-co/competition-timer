import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { applyCommand, createInitialState, finishTimer, publicState } from "./timer.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomError extends Error {}

function rejectRoomRequest(message) {
  throw new RoomError(message);
}

function randomCode(length = 6) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export class RoomManager {
  constructor({ ttlMs = 24 * 60 * 60_000, passwordMinLength = 4, now = () => Date.now() } = {}) {
    this.rooms = new Map();
    this.members = new Map();
    this.ttlMs = ttlMs;
    this.passwordMinLength = passwordMinLength;
    this.now = now;
  }

  async create({ name, password }, socketId) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 48) {
      rejectRoomRequest("Room name must be between 2 and 48 characters.");
    }
    if (typeof password !== "string" || password.length < this.passwordMinLength || password.length > 72) {
      rejectRoomRequest(`Room password must be between ${this.passwordMinLength} and 72 characters.`);
    }
    let code;
    do code = randomCode(); while (this.rooms.has(code));
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const room = {
      code,
      name: name.trim(),
      passwordHash: await bcrypt.hash(password, 10),
      ownerTokenHash: hashToken(token),
      controllerSocketId: socketId,
      members: new Map(),
      sessions: new Map(),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      state: createInitialState(now)
    };
    room.sessions.set(room.ownerTokenHash, "CONTROLLER");
    room.members.set(socketId, "CONTROLLER");
    this.rooms.set(code, room);
    this.members.set(socketId, { code, role: "CONTROLLER", tokenHash: hashToken(token) });
    return { room: this.snapshot(room), sessionToken: token };
  }

  async join({ code, password, role, sessionToken }, socketId) {
    if (typeof code !== "string" || !/^[A-HJ-NP-Z2-9]{6}$/.test(code.toUpperCase())) {
      rejectRoomRequest("Room or password is incorrect, or the Room has expired.");
    }
    if (!["CONTROLLER", "DISPLAY"].includes(role)) rejectRoomRequest("Choose Controller or Display mode.");
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.expiresAt <= this.now()) {
      if (room) this.removeRoom(room.code);
      rejectRoomRequest("Room or password is incorrect, or the Room has expired.");
    }
    let token = sessionToken;
    let tokenHash = typeof token === "string" ? hashToken(token) : null;
    const savedRole = tokenHash ? room.sessions.get(tokenHash) : null;
    if (savedRole && savedRole !== role) rejectRoomRequest("This saved session does not match the selected role.");
    if (!savedRole && (
      typeof password !== "string" ||
      password.length > 72 ||
      !(await bcrypt.compare(password, room.passwordHash))
    )) {
      rejectRoomRequest("Room or password is incorrect, or the Room has expired.");
    }
    if (role === "CONTROLLER") {
      if (savedRole !== "CONTROLLER" || tokenHash !== room.ownerTokenHash) {
        if (savedRole || room.controllerSocketId !== null) {
          rejectRoomRequest("This Room already has its primary Controller. Reconnect using its saved session.");
        }
        token = randomBytes(32).toString("base64url");
        tokenHash = hashToken(token);
        room.sessions.delete(room.ownerTokenHash);
        room.ownerTokenHash = tokenHash;
        room.sessions.set(tokenHash, "CONTROLLER");
      }
      tokenHash = room.ownerTokenHash;
    }
    let replacedSocketId = null;
    if (role === "CONTROLLER") {
      replacedSocketId = room.controllerSocketId !== socketId ? room.controllerSocketId : null;
      if (replacedSocketId) {
        room.members.delete(replacedSocketId);
        this.members.delete(replacedSocketId);
      }
      room.controllerSocketId = socketId;
    } else if (!savedRole) {
      token = randomBytes(32).toString("base64url");
      tokenHash = hashToken(token);
      room.sessions.set(tokenHash, "DISPLAY");
    }
    const previous = this.members.get(socketId);
    if (previous) this.leave(socketId);
    room.members.set(socketId, role);
    this.members.set(socketId, { code: room.code, role, tokenHash });
    if (role === "CONTROLLER") room.controllerSocketId = socketId;
    return {
      room: this.snapshot(room),
      sessionToken: token,
      replacedSocketId
    };
  }

  getMember(socketId) {
    const member = this.members.get(socketId);
    if (!member) return null;
    const room = this.rooms.get(member.code);
    if (!room || room.expiresAt <= this.now()) return null;
    return { ...member, room };
  }

  command(socketId, command) {
    const member = this.getMember(socketId);
    if (!member) rejectRoomRequest("Join an active Room first.");
    if (member.role !== "CONTROLLER" || member.tokenHash !== member.room.ownerTokenHash) {
      rejectRoomRequest("Only the Room's primary Controller can change settings.");
    }
    const room = member.room;
    room.state = finishTimer(room.state, this.now());
    room.state = applyCommand(room.state, command, this.now());
    return this.snapshot(room);
  }

  close(socketId) {
    const member = this.getMember(socketId);
    if (!member || member.role !== "CONTROLLER" || member.tokenHash !== member.room.ownerTokenHash) {
      rejectRoomRequest("Only the Room owner can close this Room.");
    }
    const code = member.room.code;
    this.removeRoom(code);
    return code;
  }

  leave(socketId) {
    const member = this.members.get(socketId);
    if (!member) return null;
    this.members.delete(socketId);
    const room = this.rooms.get(member.code);
    if (room) {
      room.members.delete(socketId);
      if (room.controllerSocketId === socketId) room.controllerSocketId = null;
    }
    return member.code;
  }

  snapshot(room) {
    return {
      code: room.code,
      name: room.name,
      expiresAt: room.expiresAt,
      state: publicState(room.state, this.now()),
      members: {
        controllerOnline: [...room.members.values()].includes("CONTROLLER"),
        displaysOnline: [...room.members.values()].filter((role) => role === "DISPLAY").length
      }
    };
  }

  list() {
    this.expire();
    return [...this.rooms.values()];
  }

  expire() {
    const now = this.now();
    const expired = [];
    for (const [code, room] of this.rooms) {
      if (room.expiresAt <= now) {
        expired.push(code);
        this.removeRoom(code);
      }
    }
    return expired;
  }

  removeRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const socketId of room.members.keys()) this.members.delete(socketId);
    this.rooms.delete(code);
  }
}
