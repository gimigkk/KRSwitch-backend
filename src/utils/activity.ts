import { prisma } from '../prisma/db';
import { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setActivityIo(io: Server) {
  ioInstance = io;
}

export async function logActivity(type: string, nim: string, details: string) {
  try {
    const log = await prisma.activityLog.create({
      data: {
        action_type: type,
        user_nim: nim,
        details,
      },
    });

    if (ioInstance) {
      ioInstance.emit('admin-log-created', log);
    }
  } catch (err: any) {
    console.error('Failed to log activity:', err.message);
  }
}
