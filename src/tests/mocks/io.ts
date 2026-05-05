import { vi } from 'vitest';

export const mockIo = {
  emit: vi.fn(),
  to:   vi.fn().mockReturnThis(),
};

export function resetIoMocks() {
  mockIo.emit.mockReset();
  mockIo.to.mockReset().mockReturnValue(mockIo);
}