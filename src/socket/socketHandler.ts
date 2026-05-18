import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../middleware/authMiddleware';

let onlineUsers = 0;

export function getOnlineCount() {
  return onlineUsers;
}

export function setupSocket(io: Server) {
  io.on('connection', (socket) => {
    console.log(`[Socket] New connection attempt, socket ID: ${socket.id}, transport: ${socket.conn.transport.name}`);

    // Perbaikan HIGH-6: koneksi tanpa auth dikasih waktu 10 detik buat authenticate (50ms di test env)
    const timeoutLimit = process.env.NODE_ENV === 'test' ? 50 : 10_000;
    const authTimeout = setTimeout(() => {
      if (!socket.data.nim) {
        console.warn(`[Socket] Authentication timeout for socket ID: ${socket.id}. Disconnecting...`);
        socket.emit('auth-error', { error: 'Authentication timeout' });
        socket.disconnect(true);
      }
    }, timeoutLimit);

    socket.on('authenticate', (token: string) => {
      if (socket.data.nim) {
        console.warn(`[Socket] Socket ID ${socket.id} is already authenticated as user ${socket.data.nim}. Ignoring repeat authentication.`);
        return;
      }
      try {
        console.log(`[Socket] Authenticating socket ID: ${socket.id}...`);
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
        socket.join(`user-${payload.nim}`);
        socket.data.nim = payload.nim;
        clearTimeout(authTimeout);
        // Hanya hitung user yang terautentikasi
        onlineUsers++;
        console.log(`[Socket] Authentication SUCCESS for user ${payload.email} (socket: ${socket.id}). Online count: ${onlineUsers}`);
        io.emit('online-count', onlineUsers);
      } catch (err: any) {
        console.error(`[Socket] Authentication FAILED for socket ID: ${socket.id}. Error:`, err.message);
        socket.emit('auth-error', { error: 'Invalid or expired socket token' });
        socket.disconnect(true);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Socket ID ${socket.id} disconnected. Reason: ${reason}`);
      if (socket.data.nim) {
        // Hanya kurangi hitungan untuk user yang terautentikasi
        onlineUsers = Math.max(0, onlineUsers - 1);
        console.log(`[Socket] Authenticated user disconnected. New online count: ${onlineUsers}`);
        io.emit('online-count', onlineUsers);
      }
      clearTimeout(authTimeout);
    });
  });
}

export function disconnectUserSockets(io: Server, nim: string, reasonMessage: string) {
  const targetRoom = `user-${nim}`;
  const connectedSockets = io?.sockets?.adapter?.rooms?.get(targetRoom);
  if (connectedSockets) {
    for (const socketId of Array.from(connectedSockets)) {
      const socket = io?.sockets?.sockets?.get(socketId);
      if (socket) {
        console.warn(`[Socket] Force-disconnecting user ${nim} (socket: ${socketId}). Reason: ${reasonMessage}`);
        socket.emit('auth-error', { error: reasonMessage });
        socket.disconnect(true);
      }
    }
  }
}