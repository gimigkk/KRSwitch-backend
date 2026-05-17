import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../middleware/authMiddleware';

let onlineUsers = 0;

export function getOnlineCount() {
  return onlineUsers;
}

export function setupSocket(io: Server) {
  io.on('connection', (socket) => {
    // Perbaikan HIGH-6: koneksi tanpa auth dikasih waktu 10 detik buat authenticate
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
        // Hanya hitung user yang terautentikasi
        onlineUsers++;
        io.emit('online-count', onlineUsers);
      } catch {
        socket.emit('auth-error', { error: 'Invalid or expired socket token' });
        socket.disconnect(true);
      }
    });

    socket.on('disconnect', () => {
      if (socket.data.nim) {
        // Hanya kurangi hitungan untuk user yang terautentikasi
        onlineUsers = Math.max(0, onlineUsers - 1);
        io.emit('online-count', onlineUsers);
      }
      clearTimeout(authTimeout);
    });
  });
}