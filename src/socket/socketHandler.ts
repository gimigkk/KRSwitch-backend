import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../middleware/authMiddleware';

let onlineUsers = 0;

export function getOnlineCount() {
  return onlineUsers;
}

export function setupSocket(io: Server) {
  io.on('connection', (socket) => {
    // HIGH-6 fix: unauthenticated connections get a 10-second window to authenticate
    const authTimeout = setTimeout(() => {
      if (!socket.data.nim) {
        socket.emit('auth-error', { error: 'Authentication timeout' });
        socket.disconnect(true);
      }
    }, 10_000);

    socket.on('authenticate', (token: string) => {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
        socket.join(`user-${payload.nim}`);
        socket.data.nim = payload.nim;
        clearTimeout(authTimeout);
        // Only count authenticated users
        onlineUsers++;
        io.emit('online-count', onlineUsers);
      } catch {
        socket.emit('auth-error', { error: 'Invalid or expired socket token' });
        socket.disconnect(true);
      }
    });

    socket.on('disconnect', () => {
      if (socket.data.nim) {
        // Only decrement for authenticated users
        onlineUsers = Math.max(0, onlineUsers - 1);
        io.emit('online-count', onlineUsers);
      }
      clearTimeout(authTimeout);
    });
  });
}