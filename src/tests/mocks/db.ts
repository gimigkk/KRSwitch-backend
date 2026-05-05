import { vi } from 'vitest';

const buildModelMock = () => ({
  findMany:   vi.fn(),
  findFirst:  vi.fn(),
  findUnique: vi.fn(),
  create:     vi.fn(),
  update:     vi.fn(),
  updateMany: vi.fn(),
  delete:     vi.fn(),
  count:      vi.fn(),
});

export const prisma = {
  barterOffer:   buildModelMock(),
  enrollment:    buildModelMock(),
  user:          buildModelMock(),
  parallelClass: buildModelMock(),
  notification:  buildModelMock(),
  $transaction:  vi.fn(),
  $disconnect:   vi.fn(),
  $connect:      vi.fn(),
};

export const buildTxMock = () => ({
  barterOffer:   buildModelMock(),
  enrollment:    buildModelMock(),
  user:          buildModelMock(),
  parallelClass: buildModelMock(),
  notification:  buildModelMock(),
});

export type TxMock = ReturnType<typeof buildTxMock>;