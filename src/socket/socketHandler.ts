import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../middleware/authMiddleware';

// Set untuk menyimpan NIM pengguna unik yang sedang online dan terautentikasi.
// Menggunakan Set alih-alih counter sederhana untuk mendukung koneksi multi-device/multi-tab secara mulus.
const activeNims = new Set<string>();

export function getOnlineCount(): number {
  return activeNims.size;
}

export function setupSocket(io: Server) {
  io.on('connection', (socket) => {
    console.log(`[Socket] New connection attempt, socket ID: ${socket.id}, transport: ${socket.conn.transport.name}`);

    // Batasan waktu koneksi tanpa autentikasi (10 detik di prod, 50ms di test env)
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
        
        // Periksa batasan maksimum 4 koneksi per akun (multi-device/multi-tab limit)
        const activeSocketsInRoom = io.sockets.adapter.rooms.get(`user-${payload.nim}`);
        if (activeSocketsInRoom && activeSocketsInRoom.size >= 4) {
          console.warn(`[Socket] Authentication REJECTED for user ${payload.email} (socket: ${socket.id}). Reason: Max device limit reached (4).`);
          socket.emit('auth-error', { error: 'Device limit reached. Maximum of 4 concurrent sessions allowed.' });
          socket.disconnect(true);
          return;
        }

        socket.join(`user-${payload.nim}`);
        socket.data.nim = payload.nim;
        clearTimeout(authTimeout);

        // Tambahkan ke Set unik pengguna online
        activeNims.add(payload.nim);
        
        console.log(`[Socket] Authentication SUCCESS for user ${payload.email} (socket: ${socket.id}). Unique online count: ${activeNims.size}`);
        io.emit('online-count', activeNims.size);
      } catch (err: any) {
        console.error(`[Socket] Authentication FAILED for socket ID: ${socket.id}. Error:`, err.message);
        socket.emit('auth-error', { error: 'Invalid or expired socket token' });
        socket.disconnect(true);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Socket ID ${socket.id} disconnected. Reason: ${reason}`);
      if (socket.data.nim) {
        const userNim = socket.data.nim;
        
        // Periksa apakah masih ada socket/tab lain yang aktif untuk NIM ini di dalam room 'user-${nim}'
        const activeSocketsInRoom = io.sockets.adapter.rooms.get(`user-${userNim}`);
        
        // Socket.IO memicu event 'disconnect' SETELAH socket meninggalkan room-nya.
        // Jika size room adalah 0 (atau undefined), artinya ini adalah koneksi/tab terakhir milik user tersebut yang ditutup.
        if (!activeSocketsInRoom || activeSocketsInRoom.size === 0) {
          activeNims.delete(userNim);
          console.log(`[Socket] Last connection for user ${userNim} disconnected. Removed from online users.`);
        } else {
          console.log(`[Socket] User ${userNim} still has ${activeSocketsInRoom.size} active connection(s) open on other devices.`);
        }

        console.log(`[Socket] Online count broadcasted: ${activeNims.size}`);
        io.emit('online-count', activeNims.size);
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
  // Hapus instan dari online set jika terputus paksa
  activeNims.delete(nim);
}