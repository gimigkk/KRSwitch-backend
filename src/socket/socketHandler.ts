import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../middleware/authMiddleware';

let onlineUsers = 0;

export function getOnlineCount() {
  return onlineUsers;
}

export function setupSocket(io: Server) {
  io.on('connection', (socket) => {
    onlineUsers++;
    io.emit('online-count', onlineUsers);

    socket.on('authenticate', (token: string) => {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
        socket.join(`user-${payload.nim}`);
        socket.data.nim = payload.nim;
      } catch {
        socket.emit('auth-error', { error: 'Invalid or expired socket token' });
      }
    });

    socket.on('disconnect', () => {
      onlineUsers = Math.max(0, onlineUsers - 1);
      io.emit('online-count', onlineUsers);
    });
  });
}