import { prisma } from '../../prisma/db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Database Referential Integrity & NIM Cascade Integration Tests', () => {

  const TEST_NIM_1 = 'M9999999901';
  const TEST_NIM_2 = 'M9999999902';
  const TEST_EMAIL_1 = 'cascade1@apps.ipb.ac.id';

  beforeAll(async () => {
    // Clean up any potential stale data
    await prisma.user.deleteMany({
      where: { nim: { in: [TEST_NIM_1, TEST_NIM_2] } }
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.user.deleteMany({
      where: { nim: { in: [TEST_NIM_1, TEST_NIM_2] } }
    });
    await prisma.parallelClass.deleteMany({
      where: { courseCode: 'TEST999' }
    });
  });

  it('cascades NIM primary key updates (onUpdate: Cascade) and student deletions (onDelete: Cascade)', async () => {
    // 1. Buat test user pertama
    const student = await prisma.user.create({
      data: {
        nim: TEST_NIM_1,
        name: 'Cascade Test Student',
        email: TEST_EMAIL_1,
        role: 'student',
        isActive: true
      }
    });
    expect(student.nim).toBe(TEST_NIM_1);

    // 2. Buat parallel classes untuk test
    const classA = await prisma.parallelClass.create({
      data: {
        courseCode: 'TEST999',
        courseName: 'Cascade Test Class A',
        classCode: 'K01',
        day: 'Monday',
        timeStart: '08:00',
        timeEnd: '10:00',
        room: 'Test Room A'
      }
    });

    const classB = await prisma.parallelClass.create({
      data: {
        courseCode: 'TEST999',
        courseName: 'Cascade Test Class B',
        classCode: 'K02',
        day: 'Tuesday',
        timeStart: '10:00',
        timeEnd: '12:00',
        room: 'Test Room B'
      }
    });

    // 3. Buat enrollment, open offer, dan notification untuk user TEST_NIM_1
    const enrollment = await prisma.enrollment.create({
      data: {
        nim: TEST_NIM_1,
        parallelClassId: classA.id
      }
    });
    expect(enrollment.nim).toBe(TEST_NIM_1);

    const offer = await prisma.barterOffer.create({
      data: {
        offererNim: TEST_NIM_1,
        myClassId: classA.id,
        wantedClassId: classB.id,
        status: 'open'
      }
    });
    expect(offer.offererNim).toBe(TEST_NIM_1);

    const notification = await prisma.notification.create({
      data: {
        recipientNim: TEST_NIM_1,
        type: 'offer_created',
        data: { offerId: offer.id }
      }
    });
    expect(notification.recipientNim).toBe(TEST_NIM_1);

    // 4. Update NIM user (Primary Key) dari TEST_NIM_1 menjadi TEST_NIM_2
    const updatedUser = await prisma.user.update({
      where: { nim: TEST_NIM_1 },
      data: { nim: TEST_NIM_2 }
    });
    expect(updatedUser.nim).toBe(TEST_NIM_2);

    // 5. Verifikasi bahwa database secara otomatis meng-cascade update NIM ke tabel-tabel relasi!
    const updatedEnrollment = await prisma.enrollment.findUnique({
      where: { nim_parallelClassId: { nim: TEST_NIM_2, parallelClassId: classA.id } }
    });
    expect(updatedEnrollment).not.toBeNull();
    expect(updatedEnrollment?.nim).toBe(TEST_NIM_2);

    const updatedOffer = await prisma.barterOffer.findUnique({
      where: { id: offer.id }
    });
    expect(updatedOffer?.offererNim).toBe(TEST_NIM_2);

    const updatedNotification = await prisma.notification.findUnique({
      where: { id: notification.id }
    });
    expect(updatedNotification?.recipientNim).toBe(TEST_NIM_2);

    // 6. Sekarang hapus user TEST_NIM_2 (onDelete: Cascade)
    await prisma.user.delete({
      where: { nim: TEST_NIM_2 }
    });

    // 7. Verifikasi bahwa data di tabel-tabel relasi otomatis ikut terhapus!
    const deletedEnrollment = await prisma.enrollment.findUnique({
      where: { nim_parallelClassId: { nim: TEST_NIM_2, parallelClassId: classA.id } }
    });
    expect(deletedEnrollment).toBeNull();

    const deletedOffer = await prisma.barterOffer.findUnique({
      where: { id: offer.id }
    });
    expect(deletedOffer).toBeNull();

    const deletedNotification = await prisma.notification.findUnique({
      where: { id: notification.id }
    });
    expect(deletedNotification).toBeNull();
  });
});
