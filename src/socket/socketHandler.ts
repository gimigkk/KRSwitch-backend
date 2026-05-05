import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../middleware/authMiddleware';

export function setupSocket(io: Server) {
  let onlineUsers = 0;

  io.on('connection', (socket) => {
    io.emit('online-count', ++onlineUsers);

    // client ambil token dari GET /api/socket-token lalu kirim ke sini
    // NIM tidak boleh dipercaya langsung dari client tanpa verifikasi
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
      io.emit('online-count', --onlineUsers);
    });
  });
}