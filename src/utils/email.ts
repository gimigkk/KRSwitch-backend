import nodemailer from 'nodemailer';
import { prisma } from '../prisma/db';
import { NotificationType, NotificationData } from '../controllers/offerController';

// Konfigurasi transporter nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: parseInt(process.env.SMTP_PORT || '465', 10) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendNotificationEmail(
  recipientNim: string,
  type: NotificationType,
  data: any // NotificationData, simplified for typing in template
) {
  // 1. Cek apakah notifikasi ini butuh dikirim email
  // (Hanya notifikasi yang BUKAN dilakukan oleh user sendiri)
  const emailEligibleTypes: NotificationType[] = [
    'barter_auto_matched',
    'barter_matched_as_offerer',
    // 'barter_matched_as_taker' -> Tidak dikirim karena user yang mengambil aksi
    // 'barter_cancelled' -> Tidak dikirim karena user sendiri yang cancel
    'admin_barter_cancelled',
    'admin_enrollment_updated',
    'admin_enrollment_deleted',
    'admin_override_swap'
  ];

  if (!emailEligibleTypes.includes(type)) {
    return; // Skip sending email
  }

  try {
    // 2. Dapatkan email user
    const user = await prisma.user.findUnique({
      where: { nim: recipientNim },
      select: { email: true, name: true },
    });

    if (!user || !user.email) {
      console.warn(`[Email] Cannot send email to ${recipientNim}: User or email not found.`);
      return;
    }

    // 3. Bangun template email
    let subject = 'Pemberitahuan KRSwitch';
    let htmlContent = '';

    switch (type) {
      case 'barter_auto_matched':
        subject = 'Penawaran Barter Anda Telah Ter-Auto-Match!';
        htmlContent = `
          <h2>Halo ${user.name},</h2>
          <p>Sistem telah berhasil mencocokkan penawaran barter Anda secara otomatis!</p>
          <p>
            <strong>Kelas yang Dilepas:</strong> ${data.yourOldClass?.courseCode}-${data.yourOldClass?.classCode}<br>
            <strong>Kelas yang Didapat:</strong> ${data.yourNewClass?.courseCode}-${data.yourNewClass?.classCode}<br>
            <strong>Pertukaran dengan:</strong> ${data.counterpartName}
          </p>
          <p>Silakan cek jadwal terbaru Anda di dashboard KRSwitch.</p>
        `;
        break;

      case 'barter_matched_as_offerer':
        subject = 'Penawaran Barter Anda Telah Diambil!';
        htmlContent = `
          <h2>Halo ${user.name},</h2>
          <p>Penawaran barter Anda telah diambil oleh mahasiswa lain.</p>
          <p>
            <strong>Kelas yang Dilepas:</strong> ${data.yourOldClass?.courseCode}-${data.yourOldClass?.classCode}<br>
            <strong>Kelas yang Didapat:</strong> ${data.yourNewClass?.courseCode}-${data.yourNewClass?.classCode}<br>
            <strong>Diambil oleh:</strong> ${data.takerName}
          </p>
          <p>Jadwal Anda telah otomatis diperbarui. Silakan cek dashboard KRSwitch.</p>
        `;
        break;

      case 'admin_barter_cancelled':
        subject = 'Penawaran Barter Anda Dibatalkan oleh Admin';
        htmlContent = `
          <h2>Halo ${user.name},</h2>
          <p>Admin telah membatalkan penawaran barter Anda untuk matkul <strong>${data.courseCode}</strong> (Kelas ${data.classCode}).</p>
          <p>Jika Anda memiliki pertanyaan, silakan hubungi administrator.</p>
        `;
        break;

      case 'admin_enrollment_updated':
        subject = 'Perubahan Jadwal oleh Admin';
        htmlContent = `
          <h2>Halo ${user.name},</h2>
          <p>Admin telah mengubah jadwal kelas Anda untuk matkul <strong>${data.courseCode}</strong>.</p>
          <p>
            <strong>Kelas Lama:</strong> ${data.oldClassCode}<br>
            <strong>Kelas Baru:</strong> ${data.newClassCode}
          </p>
          <p>Silakan cek jadwal terbaru Anda di dashboard KRSwitch.</p>
        `;
        break;

      case 'admin_enrollment_deleted':
        subject = 'Kelas Dihapus oleh Admin';
        htmlContent = `
          <h2>Halo ${user.name},</h2>
          <p>Admin telah menghapus Anda dari kelas <strong>${data.courseCode}</strong> (Kelas ${data.classCode}).</p>
          <p>Silakan cek jadwal terbaru Anda di dashboard KRSwitch.</p>
        `;
        break;

      case 'admin_override_swap':
        subject = 'Pertukaran Kelas Paksa (Admin Override)';
        htmlContent = `
          <h2>Halo ${user.name},</h2>
          <p>Admin telah melakukan pertukaran kelas (swap) secara paksa untuk matkul <strong>${data.courseCode}</strong>.</p>
          <p>
            <strong>Kelas Lama:</strong> ${data.oldClassCode}<br>
            <strong>Kelas Baru:</strong> ${data.newClassCode}<br>
            <strong>Bertukar dengan:</strong> ${data.counterpartName}
          </p>
          <p>Silakan cek jadwal terbaru Anda di dashboard KRSwitch.</p>
        `;
        break;

      default:
        return; // Jika belum ada template, abaikan saja
    }

    // Tambahkan footer standar
    htmlContent += `
      <br>
      <hr>
      <p style="font-size: 12px; color: #666;">Email ini dikirim secara otomatis oleh KRSwitch. Mohon untuk tidak membalas email ini.</p>
    `;

    // 4. Kirim email (jangan await jika dipanggil asinkron dari route, tapi kita handle catch di luar)
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'krswitch.noreply@gmail.com',
      to: user.email,
      subject: subject,
      html: htmlContent,
    };

    if (!process.env.SMTP_USER || process.env.SMTP_USER === 'krswitch.noreply@gmail.com') {
      console.log(`[Email Mock] Akan mengirim email ke ${user.email} dengan subjek: "${subject}"`);
      return; // Skip actual sending if not properly configured
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email] Pesan terkirim: ${info.messageId} ke ${user.email}`);

  } catch (error) {
    console.error(`[Email] Gagal mengirim email ke ${recipientNim}:`, error);
  }
}
