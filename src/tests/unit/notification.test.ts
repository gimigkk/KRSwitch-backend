import { describe, it, expect, beforeEach } from 'vitest';
import { createNotification } from '../../controllers/offerController';
import { buildTxMock, type TxMock } from '../mocks/db';

describe('createNotification', () => {
  let tx: TxMock;

  beforeEach(() => {
    tx = buildTxMock();
  });

  it('calls tx.notification.create with correct data structure', async () => {
    const mockNotif = {
      id: 1,
      recipientNim: 'M0001234567',
      type: 'barter_cancelled',
      data: {
        offerId: 100,
        courseCode: 'CS101',
        classCode: 'K01',
      },
      read: false,
      createdAt: new Date(),
    };

    tx.notification.create.mockResolvedValue(mockNotif);

    const result = await createNotification(
      tx,
      'M0001234567',
      'barter_cancelled',
      {
        offerId: 100,
        courseCode: 'CS101',
        classCode: 'K01',
      } as any
    );

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        recipientNim: 'M0001234567',
        type: 'barter_cancelled',
        data: {
          offerId: 100,
          courseCode: 'CS101',
          classCode: 'K01',
        },
      },
    });
    expect(result).toEqual(mockNotif);
  });
});
