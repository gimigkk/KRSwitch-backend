import { z } from 'zod';

export const createUserSchema = z.object({
  nim:   z.string().regex(/^M\d{10}$/, { message: 'Format NIM harus diawali M diikuti 10 digit (contoh: M6401211064)' }),
  name:  z.string().min(1).max(100),
  email: z.string().email(),
});

export const createAdminSchema = z.object({
  name:  z.string().min(1).max(100),
  email: z.string().email(),
  role:  z.enum(['operator', 'super_admin']),
});

export const updateAdminSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  role:     z.enum(['operator', 'super_admin']).optional(),
  isActive: z.boolean().optional(),
});

export const resetConfirmSchema = z.object({
  confirm: z.literal('RESET_ALL_DATA'),
});

// Bersihkan karakter formula dari CSV biar nggak disalahgunakan sebagai formula injection
export function sanitizeCsv(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

// Hapus karakter '<' dan '>' satu per satu biar nggak ada injection via tag-like sequences
export function stripHtml(str: string): string {
  return str.replace(/</g, '').replace(/>/g, '');
}

const DAY_MAP: Record<string, string> = {
  '1': 'Senin',
  '2': 'Selasa',
  '3': 'Rabu',
  '4': 'Kamis',
  '5': 'Jumat',
  '6': 'Sabtu',
  '7': 'Minggu'
};

export function mapDay(day: string): string {
  const d = day.trim();
  return DAY_MAP[d] || d; // Fallback ke string aslinya jika bukan angka 1-7
}
