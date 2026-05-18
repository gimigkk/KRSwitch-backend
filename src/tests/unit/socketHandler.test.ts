import { createServer } from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import { setupSocket, disconnectUserSockets, getOnlineCount } from '../../socket/socketHandler';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-prod';
const STUDENT_NIM = 'M0001111111';
const STUDENT_EMAIL = 'student@apps.ipb.ac.id';

function signToken(nim = STUDENT_NIM, email = STUDENT_EMAIL) {
  return jwt.sign({ nim, email, role: 'student' }, JWT_SECRET);
}

describe('Socket.IO Handler Concurrency & Event Testing', () => {
  let ioServer: Server;
  let httpServer: any;
  let port: number;
  let clientSockets: ClientSocket[] = [];

  beforeEach(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer);
    setupSocket(ioServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Disconnect all client sockets
    clientSockets.forEach((s) => {
      if (s.connected) s.disconnect();
    });
    clientSockets = [];

    // Close the socket server and http server
    await new Promise<void>((resolve) => {
      ioServer.close(() => {
        httpServer.close(() => {
          resolve();
        });
      });
    });
    
    // Reset timers in case fake timers were used
    vi.useRealTimers();
  });

  const createClient = (): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const socket = ioc(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });
      clientSockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  };

  it('successfully authenticates a client and broadcasts online count', async () => {
    const client = await createClient();
    const token = signToken();

    let onlineCountEvent: any = null;
    client.on('online-count', (count) => {
      onlineCountEvent = count;
    });

    // Emit authenticate event
    client.emit('authenticate', token);

    // Wait a short duration for the server to process the authentication
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify server state through broadcast count
    expect(onlineCountEvent).toBe(1);

    // Verify that the server joined the socket into the user room
    const serverSockets = Array.from(ioServer.sockets.sockets.values());
    expect(serverSockets.length).toBe(1);
    const serverSocket = serverSockets[0];
    expect(serverSocket.data.nim).toBe(STUDENT_NIM);
    expect(Array.from(serverSocket.rooms)).toContain(`user-${STUDENT_NIM}`);
  });

  it('disconnects client with timeout error when unauthenticated for timeoutLimit', async () => {
    const client = await createClient();

    let errorReceived: any = null;
    let wasDisconnected = false;

    client.on('auth-error', (data) => {
      errorReceived = data;
    });
    client.on('disconnect', () => {
      wasDisconnected = true;
    });

    // Wait for the dynamic test timeout (50ms + buffer) using real timer
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(errorReceived).toEqual({ error: 'Authentication timeout' });
    expect(wasDisconnected).toBe(true);
  });

  it('disconnects client immediately when authenticate event has invalid token', async () => {
    const client = await createClient();

    let errorReceived: any = null;
    let wasDisconnected = false;

    client.on('auth-error', (data) => {
      errorReceived = data;
    });
    client.on('disconnect', () => {
      wasDisconnected = true;
    });

    // Emit authenticate event with invalid token
    client.emit('authenticate', 'completely-invalid-token');

    // Wait for server to process and disconnect
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(errorReceived).toEqual({ error: 'Invalid or expired socket token' });
    expect(wasDisconnected).toBe(true);
  });

  it('properly tracks online count and broadcasts updates upon client departures', async () => {
    // Connect client 1
    const client1 = await createClient();
    const token1 = signToken('M0001111111', 'student1@apps.ipb.ac.id');
    
    let countFromClient1: number[] = [];
    client1.on('online-count', (count) => countFromClient1.push(count));
    client1.emit('authenticate', token1);

    // Connect client 2
    const client2 = await createClient();
    const token2 = signToken('M0002222222', 'student2@apps.ipb.ac.id');
    
    let countFromClient2: number[] = [];
    client2.on('online-count', (count) => countFromClient2.push(count));
    client2.emit('authenticate', token2);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Both should see online-count of 2
    expect(countFromClient1).toContain(2);
    expect(countFromClient2).toContain(2);

    // Disconnect client 1
    client1.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Client 2 should receive online-count update of 1
    expect(countFromClient2[countFromClient2.length - 1]).toBe(1);
  });

  it('unauthenticated client disconnect does not affect authenticated online count', async () => {
    // Connect and authenticate client 1
    const client1 = await createClient();
    const token1 = signToken();
    
    let counts: number[] = [];
    client1.on('online-count', (count) => counts.push(count));
    client1.emit('authenticate', token1);

    // Connect client 2 (does NOT authenticate)
    const client2 = await createClient();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(counts[counts.length - 1]).toBe(1);

    // Disconnect client 2 (unauthenticated)
    client2.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Online count should remain 1 (no decrement since client 2 was never authenticated)
    expect(counts[counts.length - 1]).toBe(1);
  });

  it('ignores repeat authentication spams and keeps online count stable', async () => {
    const client = await createClient();
    const token = signToken();

    let counts: number[] = [];
    client.on('online-count', (count) => counts.push(count));

    // First authentication
    client.emit('authenticate', token);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Repeat authentication attempts
    client.emit('authenticate', token);
    client.emit('authenticate', token);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should only have recorded the first online-count update of 1
    expect(counts).toEqual([1]);
  });

  it('forcefully disconnects active sockets when disconnectUserSockets is triggered', async () => {
    const client = await createClient();
    const token = signToken();

    let errorReceived: any = null;
    let wasDisconnected = false;

    client.on('auth-error', (data) => {
      errorReceived = data;
    });
    client.on('disconnect', () => {
      wasDisconnected = true;
    });

    // Authenticate
    client.emit('authenticate', token);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Superadmin deactivates or deletes the user, triggering helper
    disconnectUserSockets(ioServer, STUDENT_NIM, 'Your account has been deleted.');

    // Wait for the client to receive the error and disconnect
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errorReceived).toEqual({ error: 'Your account has been deleted.' });
    expect(wasDisconnected).toBe(true);
  });

  it('supports multiple active devices/connections for a single user without breaking the online count', async () => {
    // Device 1 connects and authenticates
    const device1 = await createClient();
    const token = signToken();
    device1.emit('authenticate', token);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getOnlineCount()).toBe(1);

    // Device 2 connects and authenticates for the SAME user
    const device2 = await createClient();
    device2.emit('authenticate', token);
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Unique online count should remain 1 because it is the same user!
    expect(getOnlineCount()).toBe(1);

    // Device 1 disconnects (e.g. closes tab)
    device1.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Unique online count should STILL be 1 because Device 2 is still active!
    expect(getOnlineCount()).toBe(1);

    // Device 2 disconnects
    device2.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now the unique online count should drop to 0!
    expect(getOnlineCount()).toBe(0);
  });

  it('enforces a maximum of 4 active devices per user and rejects subsequent connections', async () => {
    const token = signToken();
    const devices: ClientSocket[] = [];

    // Connect and authenticate 4 devices
    for (let i = 0; i < 4; i++) {
      const dev = await createClient();
      dev.emit('authenticate', token);
      devices.push(dev);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify all 4 devices are successfully authenticated on the server (1 unique user online)
    expect(getOnlineCount()).toBe(1);

    // Connect a 5th device
    const device5 = await createClient();
    let errorReceived: any = null;
    let wasDisconnected = false;
    device5.on('auth-error', (data) => {
      errorReceived = data;
    });
    device5.on('disconnect', () => {
      wasDisconnected = true;
    });

    device5.emit('authenticate', token);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the 5th device got rejected due to the limit
    expect(errorReceived).toEqual({ error: 'Device limit reached. Maximum of 4 concurrent sessions allowed.' });
    expect(wasDisconnected).toBe(true);

    // Cleanup
    devices.forEach(d => d.disconnect());
  });
});
