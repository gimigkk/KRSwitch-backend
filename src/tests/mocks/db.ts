import { vi } from 'vitest';

const buildModelMock = () => {
  const mock = {
    findMany:   vi.fn(),
    findFirst:  vi.fn(),
    findUnique: vi.fn(),
    create:     vi.fn(),
    createMany: vi.fn(),
    update:     vi.fn(),
    updateMany: vi.fn(),
    delete:     vi.fn(),
    deleteMany: vi.fn(),
    count:      vi.fn(),
  };
  mock.updateMany.mockResolvedValue({ count: 1 });
  return mock;
};

export const prisma = {
  barterOffer:   buildModelMock(),
  enrollment:    buildModelMock(),
  user:          buildModelMock(),
  parallelClass: buildModelMock(),
  notification:  buildModelMock(),
  activityLog:   buildModelMock(),
  $transaction:  vi.fn(),
  $disconnect:   vi.fn(),
  $connect:      vi.fn(),
  $queryRaw:     vi.fn().mockResolvedValue([]),
};

// Set a default resolved value so that requireAuth active session check passes by default across all integration tests
prisma.user.findUnique.mockResolvedValue({ isActive: true });

export const buildTxMock = () => {
  const txUser = buildModelMock();
  txUser.findUnique.mockResolvedValue({ isActive: true }); // also inside transactions
  return {
    barterOffer:   buildModelMock(),
    enrollment:    buildModelMock(),
    user:          txUser,
    parallelClass: buildModelMock(),
    notification:  buildModelMock(),
    activityLog:   buildModelMock(),
    $queryRaw:     vi.fn().mockResolvedValue([]),
  };
};

export type TxMock = ReturnType<typeof buildTxMock>;