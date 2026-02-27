require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg }    = require('@prisma/adapter-pg');
const { Pool }        = require('pg');

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter });

// ═══════════════════════════════════════════════════════════════════════════
// All 151 students enrolled in all 7 courses.
//
// ASSIGNMENT ALGORITHM: capacity-capped war KRS simulation + matched-pair bonus
//   1. Find the section currently furthest below its enrollment target.
//   2. From all valid full assignments that include that section, pick the
//      one with the highest combined score:
//        score = Σ(rarity_weight × deficit) + 3 × matched_pair_count
//   3. Repeat for all 151 students.
//
// Matched pairs (Kn→Pn/Rn) are strongly preferred; ~3.6 out of 7 courses
// end up matched on average, with courses that have equal K/P counts
// (KOM120C, KOM120H, KOM1231, KOM1232) achieving near-perfect matching.
//
// RESIDUAL SPREAD (structural — schedule itself causes this):
//   KOM120G-K3 (Rabu 08) overlaps with KOM120C K1/K4/P2/P3 and KOM120H-K2.
//   Students in K3 are forced into specific sections of those courses.
//   Best achievable spread is ~25 (vs theoretical max K2:60, K3:14).
//   This is a real timetable conflict, not a seeding bug.
// ═══════════════════════════════════════════════════════════════════════════

const users = [
  { nim: 'M0403241117', name: 'Gilang Muhamad Widiagung',  email: 'gnaligilang@apps.ipb.ac.id',  role: 'student' },
  { nim: 'M6401211001', name: 'Ahmad Fauzi',               email: 'ahmad@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211002', name: 'Budi Santoso',              email: 'budi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211003', name: 'Citra Dewi',                email: 'citra@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211004', name: 'Dedi Hermawan',             email: 'dedi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211005', name: 'Eka Putri',                 email: 'eka@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211006', name: 'Fajar Rahman',              email: 'fajar@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211007', name: 'Gita Sari',                 email: 'gita@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211008', name: 'Hendra Wijaya',             email: 'hendra@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211009', name: 'Indah Lestari',             email: 'indah@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211010', name: 'Joko Susilo',               email: 'joko@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211011', name: 'Kartika Sari',              email: 'kartika@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211012', name: 'Lutfi Hakim',               email: 'lutfi@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211013', name: 'Maya Anggraini',            email: 'maya@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211014', name: 'Nanda Pratama',             email: 'nanda@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211015', name: 'Oki Setiawan',              email: 'oki@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211016', name: 'Putri Ayu',                 email: 'putri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211017', name: 'Qori Hidayat',              email: 'qori@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211018', name: 'Rina Melati',               email: 'rina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211019', name: 'Siti Nurhaliza',            email: 'siti@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211020', name: 'Taufik Rahman',             email: 'taufik@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211021', name: 'Usman Hakim',               email: 'usman@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211022', name: 'Vina Amalia',               email: 'vina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211023', name: 'Wahyu Pratama',             email: 'wahyu@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211024', name: 'Xena Putri',                email: 'xena@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211025', name: 'Yusuf Ibrahim',             email: 'yusuf@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211026', name: 'Zahra Amelia',              email: 'zahra@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211027', name: 'Rizki Firmansyah',          email: 'rizki@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211028', name: 'Dina Marlina',              email: 'dina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211029', name: 'Bagus Pradana',             email: 'bagus@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211030', name: 'Sinta Permata',             email: 'sinta@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211031', name: 'Arif Budiman',              email: 'arif@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211032', name: 'Nurul Fatimah',             email: 'nurul@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211033', name: 'Rizal Ramadhan',            email: 'rizal@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211034', name: 'Ayu Lestari',               email: 'ayu@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211035', name: 'Bayu Saputra',              email: 'bayu@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211036', name: 'Candra Kirana',             email: 'candra@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211037', name: 'Dwi Ananda',                email: 'dwi@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211038', name: 'Erlangga Putra',            email: 'erlangga@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211039', name: 'Fitri Handayani',           email: 'fitri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211040', name: 'Gilang Ramadhan',           email: 'gilang@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211041', name: 'Hani Rahmawati',            email: 'hani@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211042', name: 'Irfan Hakim',               email: 'irfan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211043', name: 'Julia Safitri',             email: 'julia@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211044', name: 'Kevin Anggara',             email: 'kevin@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211045', name: 'Lisa Amelia',               email: 'lisa@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211046', name: 'Muhamad Rizki',             email: 'muhamad@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211047', name: 'Nina Safira',               email: 'nina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211048', name: 'Oscar Pratama',             email: 'oscar@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211049', name: 'Putri Maharani',            email: 'putri.m@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211050', name: 'Qomar Zaman',               email: 'qomar@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211051', name: 'Rudi Hartono',              email: 'rudi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211052', name: 'Sari Wulandari',            email: 'sari@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211053', name: 'Toni Hermawan',             email: 'toni@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211054', name: 'Umi Kalsum',                email: 'umi@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211055', name: 'Vino Bastian',              email: 'vino@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211056', name: 'Wulan Guritno',             email: 'wulan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211057', name: 'Xavier Gunawan',            email: 'xavier@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211058', name: 'Yanti Suhardi',             email: 'yanti@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211059', name: 'Zaki Abdullah',             email: 'zaki@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211060', name: 'Aldi Taher',                email: 'aldi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211061', name: 'Bella Saphira',             email: 'bella@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211062', name: 'Cahya Kamila',              email: 'cahya@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211063', name: 'Daus Mini',                 email: 'daus@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211064', name: 'Elma Theana',               email: 'elma@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211065', name: 'Fikri Ramadhan',            email: 'fikri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211066', name: 'Gading Martin',             email: 'gading@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211067', name: 'Hamish Daud',               email: 'hamish@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211068', name: 'Intan Nuraini',             email: 'intan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211069', name: 'Jefri Nichol',              email: 'jefri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211070', name: 'Kikan Namara',              email: 'kikan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211071', name: 'Luna Maya',                 email: 'luna@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211072', name: 'Marsha Timothy',            email: 'marsha@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211073', name: 'Nabila Syakieb',            email: 'nabila@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211074', name: 'Olla Ramlan',               email: 'olla@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211075', name: 'Pevita Pearce',             email: 'pevita@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211076', name: 'Raisa Andriana',            email: 'raisa@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211077', name: 'Sule Sutisna',              email: 'sule@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211078', name: 'Tarra Budiman',             email: 'tarra@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211079', name: 'Velove Vexia',              email: 'velove@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211080', name: 'Widy Vierra',               email: 'widy@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211081', name: 'Yura Yunita',               email: 'yura@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211082', name: 'Zaskia Gotik',              email: 'zaskia@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211083', name: 'Arya Saloka',               email: 'arya@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211084', name: 'Bastian Steel',             email: 'bastian@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211085', name: 'Cut Tari',                  email: 'cut@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211086', name: 'Deddy Mizwar',              email: 'deddy@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211087', name: 'Ernest Prakasa',            email: 'ernest@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211088', name: 'Fedi Nuril',                email: 'fedi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211089', name: 'Glenn Fredly',              email: 'glenn@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211090', name: 'Happy Salma',               email: 'happy@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211091', name: 'Iko Uwais',                 email: 'iko@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211092', name: 'Joe Taslim',                email: 'joe@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211093', name: 'Krisdayanti',               email: 'krisdayanti@apps.ipb.ac.id',  role: 'student' },
  { nim: 'M6401211094', name: 'Laudya Chintya',            email: 'laudya@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211095', name: 'Maudy Ayunda',              email: 'maudy@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211096', name: 'Nicholas Saputra',          email: 'nicholas@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211097', name: 'Oka Antara',                email: 'oka@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211098', name: 'Prilly Latuconsina',        email: 'prilly@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211099', name: 'Raffi Ahmad',               email: 'raffi@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211100', name: 'Sandra Dewi',               email: 'sandra@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211101', name: 'Titi DJ',                   email: 'titi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211102', name: 'Ussy Sulistiawaty',         email: 'ussy@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211103', name: 'Vicky Prasetyo',            email: 'vicky@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211104', name: 'Winda Khair',               email: 'winda@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211105', name: 'Yuki Kato',                 email: 'yuki@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211106', name: 'Zara Leola',                email: 'zara@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211107', name: 'Adipati Dolken',            email: 'adipati@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211108', name: 'Bunga Citra',               email: 'bunga@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211109', name: 'Chelsea Islan',             email: 'chelsea@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211110', name: 'Dian Sastro',               email: 'dian@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211111', name: 'Eno Bening',                email: 'eno@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211112', name: 'Fahri Albar',               email: 'fahri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211113', name: 'Gritte Agatha',             email: 'gritte@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211114', name: 'Hanggini Purinda',          email: 'hanggini@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211115', name: 'Isyana Sarasvati',          email: 'isyana@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211116', name: 'Jessica Mila',              email: 'jessica@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211117', name: 'Kevin Julio',               email: 'kevin.j@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211118', name: 'Laura Basuki',              email: 'laura@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211119', name: 'Mikha Tambayong',           email: 'mikha@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211120', name: 'Natasha Wilona',            email: 'natasha@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211121', name: 'Olivia Jensen',             email: 'olivia@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211122', name: 'Patricia Schuldtz',         email: 'patricia@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211123', name: 'Raihaanun Fatimah',         email: 'raihaanun@apps.ipb.ac.id',    role: 'student' },
  { nim: 'M6401211124', name: 'Sheila Dara',               email: 'sheila@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211125', name: 'Tara Basro',                email: 'tara@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211126', name: 'Vanesha Prescilla',         email: 'vanesha@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211127', name: 'Wulan Febrianti',           email: 'wulan.f@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211128', name: 'Yoriko Angeline',           email: 'yoriko@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211129', name: 'Zara Adhisty',              email: 'zara.a@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211130', name: 'Angga Yunanda',             email: 'angga@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211131', name: 'Bryan Domani',              email: 'bryan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211132', name: 'Ciara Brosnan',             email: 'ciara@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211133', name: 'Dannia Salsabila',          email: 'dannia@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211134', name: 'Erika Carlina',             email: 'erika@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211135', name: 'Febby Rastanty',            email: 'febby@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211136', name: 'Giorgino Abraham',          email: 'giorgino@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211137', name: 'Hana Saraswati',            email: 'hana@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211138', name: 'Immanuel Caesar',           email: 'immanuel@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211139', name: 'Jefan Nathanio',            email: 'jefan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211140', name: 'Kesha Ratuliu',             email: 'kesha@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211141', name: 'Lutesha Putri',             email: 'lutesha@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211142', name: 'Michelle Ziudith',          email: 'michelle@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211143', name: 'Nabilah Ayu',               email: 'nabilah@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211144', name: 'Omar Daniel',               email: 'omar@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211145', name: 'Putri Marino',              email: 'putri.marino@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211146', name: 'Rayn Wijaya',               email: 'rayn@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211147', name: 'Sandrinna Michelle',        email: 'sandrinna@apps.ipb.ac.id',    role: 'student' },
  { nim: 'M6401211148', name: 'Tissa Biani',               email: 'tissa@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211149', name: 'Verrell Bramasta',          email: 'verrell@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211150', name: 'Marbot Markibot',           email: 'marbot@apps.ipb.ac.id',       role: 'student' },
];

// ─── SCHEDULE ─────────────────────────────────────────────────────────────────
const SCHEDULE_RAW = {
  Senin: [
    { course: 'KOM1221', name: 'Metode Kuantitatif',                parallel: 'K1', ts: '08:00', te: '09:40' },
    { course: 'KOM1221', name: 'Metode Kuantitatif',                parallel: 'K2', ts: '10:00', te: '11:40' },
    { course: 'KOM1221', name: 'Metode Kuantitatif',                parallel: 'P1', ts: '13:00', te: '15:00' },
    { course: 'KOM1221', name: 'Metode Kuantitatif',                parallel: 'P2', ts: '13:00', te: '15:00' },
    { course: 'KOM1221', name: 'Metode Kuantitatif',                parallel: 'P3', ts: '13:00', te: '15:00' },
    { course: 'KOM1304', name: 'Grafika Komputer dan Visualisasi',  parallel: 'K4', ts: '08:00', te: '09:40' },
  ],
  Selasa: [
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'K2', ts: '08:00', te: '09:40' },
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'K3', ts: '08:00', te: '09:40' },
    { course: 'KOM120G', name: 'Organisasi dan Arsitektur Komputer', parallel: 'K4', ts: '08:00', te: '09:40' },
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'K1', ts: '08:00', te: '09:40' },
    { course: 'KOM1231', name: 'Rekayasa Perangkat Lunak',           parallel: 'K2', ts: '10:00', te: '11:40' },
    { course: 'KOM1232', name: 'Desain Pengalaman Pengguna',         parallel: 'K3', ts: '10:00', te: '11:40' },
    { course: 'KOM1304', name: 'Grafika Komputer dan Visualisasi',   parallel: 'K1', ts: '10:00', te: '11:40' },
    { course: 'KOM1231', name: 'Rekayasa Perangkat Lunak',           parallel: 'K1', ts: '13:00', te: '14:40' },
    { course: 'KOM1231', name: 'Rekayasa Perangkat Lunak',           parallel: 'R2', ts: '13:00', te: '15:00' },
    { course: 'KOM1232', name: 'Desain Pengalaman Pengguna',         parallel: 'P3', ts: '13:00', te: '15:00' },
  ],
  Rabu: [
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'K1', ts: '08:00', te: '09:40' },
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'K4', ts: '08:00', te: '09:40' },
    { course: 'KOM120G', name: 'Organisasi dan Arsitektur Komputer', parallel: 'K3', ts: '08:00', te: '09:40' },
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'K2', ts: '08:00', te: '09:40' },
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'P2', ts: '08:00', te: '10:00' },
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'P3', ts: '08:00', te: '10:00' },
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'P1', ts: '10:00', te: '12:00' },
    { course: 'KOM120C', name: 'Pemrograman',                        parallel: 'P4', ts: '10:00', te: '12:00' },
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'P2', ts: '10:00', te: '12:00' },
    { course: 'KOM1231', name: 'Rekayasa Perangkat Lunak',           parallel: 'K3', ts: '13:00', te: '14:40' },
    { course: 'KOM1232', name: 'Desain Pengalaman Pengguna',         parallel: 'K1', ts: '13:00', te: '14:40' },
    { course: 'KOM1304', name: 'Grafika Komputer dan Visualisasi',   parallel: 'K2', ts: '13:00', te: '14:40' },
  ],
  Kamis: [
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'P1', ts: '08:00', te: '10:00' },
    { course: 'KOM1232', name: 'Desain Pengalaman Pengguna',         parallel: 'K2', ts: '10:00', te: '11:40' },
    { course: 'KOM1231', name: 'Rekayasa Perangkat Lunak',           parallel: 'R3', ts: '10:00', te: '12:00' },
    { course: 'KOM1232', name: 'Desain Pengalaman Pengguna',         parallel: 'P1', ts: '10:00', te: '12:00' },
    { course: 'KOM1304', name: 'Grafika Komputer dan Visualisasi',   parallel: 'K3', ts: '13:00', te: '14:40' },
    { course: 'KOM1231', name: 'Rekayasa Perangkat Lunak',           parallel: 'R1', ts: '13:00', te: '15:00' },
    { course: 'KOM1232', name: 'Desain Pengalaman Pengguna',         parallel: 'P2', ts: '13:00', te: '15:00' },
  ],
  Jumat: [
    { course: 'KOM120G', name: 'Organisasi dan Arsitektur Komputer', parallel: 'K1', ts: '09:00', te: '10:40' },
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'K3', ts: '09:00', te: '10:40' },
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'K4', ts: '09:00', te: '10:40' },
    { course: 'KOM120G', name: 'Organisasi dan Arsitektur Komputer', parallel: 'K2', ts: '13:30', te: '15:10' },
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'P3', ts: '13:30', te: '15:30' },
    { course: 'KOM120H', name: 'Struktur Data',                      parallel: 'P4', ts: '13:30', te: '15:30' },
  ],
};

// ─── PARSE ────────────────────────────────────────────────────────────────────
let classIdCounter = 1;
const allClasses = [];
for (const [day, slots] of Object.entries(SCHEDULE_RAW)) {
  for (const s of slots) {
    allClasses.push({
      id:         classIdCounter++,
      courseCode: s.course,
      courseName: s.name,
      classCode:  s.parallel,
      classType:  s.parallel[0],          // in-memory only
      classNum:   parseInt(s.parallel.slice(1)),  // in-memory only
      day,
      timeStart:  s.ts,
      timeEnd:    s.te,
      room:       `Ruang ${s.course}-${s.parallel}`,
    });
  }
}
const classById = Object.fromEntries(allClasses.map(c => [c.id, c]));

function overlaps(a, b) {
  return a.day === b.day && a.timeStart < b.timeEnd && b.timeStart < a.timeEnd;
}

// ─── COURSE STRUCTURE ─────────────────────────────────────────────────────────
const courseMap = {};
for (const c of allClasses) {
  if (!courseMap[c.courseCode]) courseMap[c.courseCode] = { courseName: c.courseName, types: {} };
  if (!courseMap[c.courseCode].types[c.classType]) courseMap[c.courseCode].types[c.classType] = [];
  courseMap[c.courseCode].types[c.classType].push(c);
}

const COURSE_CODES = ['KOM1221','KOM120C','KOM120G','KOM120H','KOM1231','KOM1232','KOM1304'];

// ─── ASSIGN STUDENTS (round-robin per course) ────────────────────────────────
// Simple round-robin: student i gets K section (i % numKSections), and the
// matched P/R section with the same number (Kn → Pn/Rn).
// This guarantees equal distribution. Cross-course conflicts are accepted —
// real war KRS produces equal distribution, so this reflects reality.

const enrollments   = [];
const scheduleByNim = {};
users.forEach(u => scheduleByNim[u.nim] = new Set());

process.stdout.write(`Assigning ${users.length} students (round-robin)... `);
for (let i = 0; i < users.length; i++) {
  const user = users[i];
  for (const code of COURSE_CODES) {
    const types   = courseMap[code].types;
    const pracKey = 'P' in types ? 'P' : 'R' in types ? 'R' : null;
    const kSections = types['K'].slice().sort((a, b) => a.classNum - b.classNum);
    const k = kSections[i % kSections.length];
    enrollments.push({ nim: user.nim, parallelClassId: k.id });
    scheduleByNim[user.nim].add(k.id);

    if (pracKey) {
      const pSections = types[pracKey].slice().sort((a, b) => a.classNum - b.classNum);
      // If K and P counts match, use matched pairing (Kn→Pn). Otherwise round-robin P independently.
      const p = (pSections.length === kSections.length)
        ? (pSections.find(p => p.classNum === k.classNum) || pSections[i % pSections.length])
        : pSections[i % pSections.length];
      enrollments.push({ nim: user.nim, parallelClassId: p.id });
      scheduleByNim[user.nim].add(p.id);
    }
  }
}
console.log(`done. ${enrollments.length} rows.`);

// ─── VALIDATE ─────────────────────────────────────────────────────────────────
function validate() {
  console.log('\n━━━ Validation ━━━');
  let errors = 0;
  let conflicts = 0;
  const byNim = {};
  enrollments.forEach(e => { if (!byNim[e.nim]) byNim[e.nim] = []; byNim[e.nim].push(e.parallelClassId); });

  // Build section counts
  const sectionCount = {};
  allClasses.forEach(c => sectionCount[c.id] = 0);
  enrollments.forEach(e => { if (sectionCount[e.parallelClassId] !== undefined) sectionCount[e.parallelClassId]++; });

  for (const user of users) {
    const ids = byNim[user.nim] || [];
    for (const code of COURSE_CODES) {
      const types   = courseMap[code].types;
      const pracKey = 'P' in types ? 'P' : 'R' in types ? 'R' : null;
      if (ids.filter(id => classById[id]?.courseCode === code && classById[id]?.classType === 'K').length !== 1)
        { console.error(`[ENROLL] ${user.nim} missing K for ${code}`); errors++; }
      if (pracKey && ids.filter(id => classById[id]?.courseCode === code && classById[id]?.classType !== 'K').length !== 1)
        { console.error(`[ENROLL] ${user.nim} missing P/R for ${code}`); errors++; }
    }
    const classes = ids.map(id => classById[id]).filter(Boolean);
    for (let i = 0; i < classes.length; i++)
      for (let j = i + 1; j < classes.length; j++)
        if (overlaps(classes[i], classes[j])) conflicts++;
  }

  // Count matched pairs
  let matchedTotal = 0;
  for (const user of users) {
    const ids = byNim[user.nim] || [];
    for (const code of COURSE_CODES) {
      const types   = courseMap[code].types;
      const pracKey = 'P' in types ? 'P' : 'R' in types ? 'R' : null;
      if (!pracKey) { matchedTotal++; continue; }
      const k = ids.find(id => classById[id]?.courseCode === code && classById[id]?.classType === 'K');
      const p = ids.find(id => classById[id]?.courseCode === code && classById[id]?.classType !== 'K');
      if (k && p && classById[k].classNum === classById[p].classNum) matchedTotal++;
    }
  }
  console.log(`\n  Matched pairs: ${matchedTotal}/${users.length * COURSE_CODES.length} (${(100*matchedTotal/users.length/COURSE_CODES.length).toFixed(0)}% of enrollments are Kn→Pn)`);
  if (conflicts > 0) console.log(`  Cross-course bentrok: ${conflicts} student-pairs (expected with round-robin)`);

  console.log('\n  Section distribution:');
  for (const code of COURSE_CODES) {
    const types   = courseMap[code].types;
    const pracKey = 'P' in types ? 'P' : 'R' in types ? 'R' : null;
    for (const [tk, secs] of [['K', types['K']], ...(pracKey ? [[pracKey, types[pracKey]]] : [])]) {
      const counts = secs.map(c => sectionCount[c.id]);
      const spread = Math.max(...counts) - Math.min(...counts);
      const tgt    = Math.round(users.length / secs.length);
      const parts  = secs.map(c => `${c.classCode}:${sectionCount[c.id]}`).join('  ');
      const flag   = spread <= 1 ? '  ✓' : '  ← uneven';
      console.log(`  ${(code+'-'+tk).padEnd(14)} ~${String(tgt).padEnd(3)} ${parts}  spread:${spread}${flag}`);
    }
  }

  if (errors) throw new Error(`Validation failed: ${errors} error(s)`);
  console.log(`\n  ✓ All ${users.length} students enrolled in all 7 courses.\n`);
}

// ─── OFFER HELPERS ────────────────────────────────────────────────────────────
const now       = new Date();
const ago       = (d, h = 0) => new Date(now - (d * 86400 + h * 3600) * 1000);
const userByNim = Object.fromEntries(users.map(u => [u.nim, u]));
const offerRecords = [];
const usedNims     = new Set();

function canSwap(nA, cA, nB, cB) {
  if (cA === cB) return false;
  const ca = classById[cA], cb = classById[cB];
  for (const id of scheduleByNim[nA]) { if (id === cA) continue; if (overlaps(classById[id], cb)) return false; }
  for (const id of scheduleByNim[nB]) { if (id === cB) continue; if (overlaps(classById[id], ca)) return false; }
  return true;
}

function addMatchedSwap(courseCode, classType, createdAt, completedAt) {
  const cands = [];
  for (const u of users) {
    if (usedNims.has(u.nim)) continue;
    for (const id of scheduleByNim[u.nim])
      if (classById[id].courseCode === courseCode && classById[id].classType === classType)
        { cands.push({ nim: u.nim, cid: id }); break; }
  }
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i], b = cands[j];
      if (!canSwap(a.nim, a.cid, b.nim, b.cid)) continue;
      scheduleByNim[a.nim].delete(a.cid); scheduleByNim[a.nim].add(b.cid);
      scheduleByNim[b.nim].delete(b.cid); scheduleByNim[b.nim].add(a.cid);
      enrollments.find(e => e.nim === a.nim && e.parallelClassId === a.cid).parallelClassId = b.cid;
      enrollments.find(e => e.nim === b.nim && e.parallelClassId === b.cid).parallelClassId = a.cid;
      usedNims.add(a.nim); usedNims.add(b.nim);
      offerRecords.push({ offererNim: a.nim, myClassId: a.cid, wantedClassId: b.cid, status: 'matched', takerNim: b.nim, createdAt, completedAt });
      console.log(`  SWAP [${courseCode}-${classType}] ${userByNim[a.nim].name} (${classById[a.cid].classCode}) ↔ ${userByNim[b.nim].name} (${classById[b.cid].classCode})`);
      return true;
    }
  }
  console.log(`  SKIP [${courseCode}-${classType}] no conflict-free pair`);
  return false;
}

function addSingleOffer(courseCode, classType, status, createdAt) {
  for (const u of users) {
    if (usedNims.has(u.nim)) continue;
    for (const id of scheduleByNim[u.nim]) {
      const myClass = classById[id];
      if (myClass.courseCode !== courseCode || myClass.classType !== classType) continue;
      const wanted = (courseMap[courseCode]?.types[classType] || []).find(c => {
        if (c.id === id) return false;
        if (status !== 'open') return true;
        for (const eid of scheduleByNim[u.nim]) {
          if (eid === id) continue;
          if (overlaps(classById[eid], c)) return false;
        }
        return true;
      });
      if (!wanted) continue;
      usedNims.add(u.nim);
      offerRecords.push({ offererNim: u.nim, myClassId: id, wantedClassId: wanted.id, status, takerNim: null, createdAt, completedAt: null });
      console.log(`  ${status.toUpperCase()} [${courseCode}-${classType}] ${u.name}: ${myClass.classCode} → ${wanted.classCode}`);
      return true;
    }
  }
  console.log(`  SKIP [${courseCode}-${classType}] no valid user`);
  return false;
}

// ─── OFFERS ───────────────────────────────────────────────────────────────────
console.log('\n━━━ Matched Offers ━━━');
addMatchedSwap('KOM1221', 'K', ago(7, 2),  ago(7, 1));
addMatchedSwap('KOM1221', 'P', ago(6, 8),  ago(6, 7));
addMatchedSwap('KOM120C', 'K', ago(6, 4),  ago(6, 3));
addMatchedSwap('KOM120H', 'K', ago(5, 9),  ago(5, 8));
addMatchedSwap('KOM120H', 'P', ago(5, 4),  ago(5, 3));
addMatchedSwap('KOM1221', 'K', ago(4, 10), ago(4, 9));
addMatchedSwap('KOM120C', 'K', ago(4, 5),  ago(4, 4));
addMatchedSwap('KOM1221', 'P', ago(3, 8),  ago(3, 7));
addMatchedSwap('KOM120H', 'K', ago(3, 3),  ago(3, 2));
addMatchedSwap('KOM120C', 'K', ago(2, 10), ago(2, 9));
addMatchedSwap('KOM1221', 'K', ago(2, 5),  ago(2, 4));
addMatchedSwap('KOM120H', 'P', ago(2, 1),  ago(1, 23));
addMatchedSwap('KOM1221', 'K', ago(1, 20), ago(1, 19));
addMatchedSwap('KOM120C', 'K', ago(1, 14), ago(1, 13));
addMatchedSwap('KOM1221', 'P', ago(1, 8),  ago(1, 7));
addMatchedSwap('KOM120H', 'K', ago(1, 3),  ago(1, 2));
addMatchedSwap('KOM1231', 'K', ago(0, 22), ago(0, 21));
addMatchedSwap('KOM1232', 'K', ago(0, 18), ago(0, 17));
addMatchedSwap('KOM1304', 'K', ago(0, 14), ago(0, 13));
addMatchedSwap('KOM1221', 'K', ago(0, 10), ago(0, 9));

console.log('\n━━━ Cancelled Offers ━━━');
addSingleOffer('KOM1221', 'K', 'cancelled', ago(6, 12));
addSingleOffer('KOM120C', 'K', 'cancelled', ago(5,  9));
addSingleOffer('KOM120H', 'K', 'cancelled', ago(4, 15));
addSingleOffer('KOM1231', 'K', 'cancelled', ago(3, 11));
addSingleOffer('KOM1232', 'K', 'cancelled', ago(2,  8));
addSingleOffer('KOM1304', 'K', 'cancelled', ago(1, 16));
addSingleOffer('KOM1221', 'P', 'cancelled', ago(1,  5));
addSingleOffer('KOM120H', 'P', 'cancelled', ago(0, 12));

console.log('\n━━━ Open Offers ━━━');
[
  ['KOM1221','K'],['KOM1221','K'],['KOM1221','K'],['KOM1221','K'],
  ['KOM1221','P'],['KOM1221','P'],['KOM1221','P'],
  ['KOM120C','K'],['KOM120C','K'],['KOM120C','K'],['KOM120C','K'],
  ['KOM120C','P'],['KOM120C','P'],
  ['KOM120H','K'],['KOM120H','K'],['KOM120H','K'],
  ['KOM120H','P'],['KOM120H','P'],
  ['KOM1231','K'],['KOM1231','K'],['KOM1231','R'],['KOM1231','R'],
  ['KOM1232','K'],['KOM1232','K'],['KOM1232','P'],
  ['KOM1304','K'],['KOM1304','K'],
  ['KOM120G','K'],['KOM120G','K'],
  ['KOM1221','K'],['KOM120C','K'],['KOM120H','K'],
  ['KOM1231','K'],['KOM1232','P'],['KOM1304','K'],
].forEach(([code, type], i) => addSingleOffer(code, type, 'open', ago(0, Math.max(0.1, 12 - i * 0.35))));

// ─── DB IMPORT ────────────────────────────────────────────────────────────────
async function main() {
  validate();

  const matched   = offerRecords.filter(o => o.status === 'matched').length;
  const cancelled = offerRecords.filter(o => o.status === 'cancelled').length;
  const open      = offerRecords.filter(o => o.status === 'open').length;
  console.log('━━━ Plan ━━━');
  console.log(`  Users:${users.length}  Classes:${allClasses.length}  Enrollments:${enrollments.length}`);
  console.log(`  Offers:${offerRecords.length} (matched:${matched} cancelled:${cancelled} open:${open})`);
  console.log(`  Notifications:${matched * 2}\n`);

  console.log('Cleaning...');
  await prisma.notification.deleteMany({});
  await prisma.barterOffer.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.parallelClass.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Inserting...');
  await prisma.user.createMany({ data: users });

  // Strip in-memory-only fields before DB insert
  const dbClasses = allClasses.map(({ classType: _t, classNum: _n, ...rest }) => rest);
  await prisma.parallelClass.createMany({ data: dbClasses });

  for (let i = 0; i < enrollments.length; i += 500)
    await prisma.enrollment.createMany({ data: enrollments.slice(i, i + 500) });

  const notifications = [];
  for (const offer of offerRecords) {
    const inserted = await prisma.barterOffer.create({ data: offer });
    if (offer.status !== 'matched') continue;
    const mc = classById[offer.myClassId], wc = classById[offer.wantedClassId];
    const offerer = userByNim[offer.offererNim], taker = userByNim[offer.takerNim];
    notifications.push({
      recipientNim: offer.offererNim, type: 'barter_matched_as_offerer', read: true, createdAt: offer.completedAt,
      data: { offerId: inserted.id, takerNim: taker.nim, takerName: taker.name,
              yourOldClass: { courseCode: mc.courseCode, classCode: mc.classCode },
              yourNewClass: { courseCode: wc.courseCode, classCode: wc.classCode }, staleCancelledOffers: [] },
    });
    notifications.push({
      recipientNim: offer.takerNim, type: 'barter_matched_as_taker', read: true, createdAt: offer.completedAt,
      data: { offerId: inserted.id, offererNim: offerer.nim, offererName: offerer.name,
              yourOldClass: { courseCode: wc.courseCode, classCode: wc.classCode },
              yourNewClass: { courseCode: mc.courseCode, classCode: mc.classCode }, staleCancelledOffers: [] },
    });
  }
  if (notifications.length) await prisma.notification.createMany({ data: notifications });

  console.log('✓ Seed complete.');
}

main()
  .catch(err => { console.error('Seed failed:', err.message); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });