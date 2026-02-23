require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ==================== USERS (150 students) ====================

const users = [
  { nim: 'M6401211001', name: 'Ahmad Fauzi',        email: 'ahmad@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211002', name: 'Budi Santoso',        email: 'budi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211003', name: 'Citra Dewi',          email: 'citra@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211004', name: 'Dedi Hermawan',       email: 'dedi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211005', name: 'Eka Putri',           email: 'eka@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211006', name: 'Fajar Rahman',        email: 'fajar@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211007', name: 'Gita Sari',           email: 'gita@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211008', name: 'Hendra Wijaya',       email: 'hendra@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211009', name: 'Indah Lestari',       email: 'indah@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211010', name: 'Joko Susilo',         email: 'joko@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211011', name: 'Kartika Sari',        email: 'kartika@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211012', name: 'Lutfi Hakim',         email: 'lutfi@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211013', name: 'Maya Anggraini',      email: 'maya@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211014', name: 'Nanda Pratama',       email: 'nanda@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211015', name: 'Oki Setiawan',        email: 'oki@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211016', name: 'Putri Ayu',           email: 'putri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211017', name: 'Qori Hidayat',        email: 'qori@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211018', name: 'Rina Melati',         email: 'rina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211019', name: 'Siti Nurhaliza',      email: 'siti@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211020', name: 'Taufik Rahman',       email: 'taufik@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211021', name: 'Usman Hakim',         email: 'usman@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211022', name: 'Vina Amalia',         email: 'vina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211023', name: 'Wahyu Pratama',       email: 'wahyu@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211024', name: 'Xena Putri',          email: 'xena@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211025', name: 'Yusuf Ibrahim',       email: 'yusuf@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211026', name: 'Zahra Amelia',        email: 'zahra@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211027', name: 'Rizki Firmansyah',    email: 'rizki@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211028', name: 'Dina Marlina',        email: 'dina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211029', name: 'Bagus Pradana',       email: 'bagus@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211030', name: 'Sinta Permata',       email: 'sinta@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211031', name: 'Arif Budiman',        email: 'arif@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211032', name: 'Nurul Fatimah',       email: 'nurul@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211033', name: 'Rizal Ramadhan',      email: 'rizal@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211034', name: 'Ayu Lestari',         email: 'ayu@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211035', name: 'Bayu Saputra',        email: 'bayu@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211036', name: 'Candra Kirana',       email: 'candra@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211037', name: 'Dwi Ananda',          email: 'dwi@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211038', name: 'Erlangga Putra',      email: 'erlangga@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211039', name: 'Fitri Handayani',     email: 'fitri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211040', name: 'Gilang Ramadhan',     email: 'gilang@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211041', name: 'Hani Rahmawati',      email: 'hani@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211042', name: 'Irfan Hakim',         email: 'irfan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211043', name: 'Julia Safitri',       email: 'julia@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211044', name: 'Kevin Anggara',       email: 'kevin@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211045', name: 'Lisa Amelia',         email: 'lisa@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211046', name: 'Muhamad Rizki',       email: 'muhamad@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211047', name: 'Nina Safira',         email: 'nina@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211048', name: 'Oscar Pratama',       email: 'oscar@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211049', name: 'Putri Maharani',      email: 'putri.m@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211050', name: 'Qomar Zaman',         email: 'qomar@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211051', name: 'Rudi Hartono',        email: 'rudi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211052', name: 'Sari Wulandari',      email: 'sari@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211053', name: 'Toni Hermawan',       email: 'toni@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211054', name: 'Umi Kalsum',          email: 'umi@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211055', name: 'Vino Bastian',        email: 'vino@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211056', name: 'Wulan Guritno',       email: 'wulan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211057', name: 'Xavier Gunawan',      email: 'xavier@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211058', name: 'Yanti Suhardi',       email: 'yanti@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211059', name: 'Zaki Abdullah',       email: 'zaki@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211060', name: 'Aldi Taher',          email: 'aldi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211061', name: 'Bella Saphira',       email: 'bella@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211062', name: 'Cahya Kamila',        email: 'cahya@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211063', name: 'Daus Mini',           email: 'daus@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211064', name: 'Elma Theana',         email: 'elma@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211065', name: 'Fikri Ramadhan',      email: 'fikri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211066', name: 'Gading Martin',       email: 'gading@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211067', name: 'Hamish Daud',         email: 'hamish@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211068', name: 'Intan Nuraini',       email: 'intan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211069', name: 'Jefri Nichol',        email: 'jefri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211070', name: 'Kikan Namara',        email: 'kikan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211071', name: 'Luna Maya',           email: 'luna@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211072', name: 'Marsha Timothy',      email: 'marsha@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211073', name: 'Nabila Syakieb',      email: 'nabila@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211074', name: 'Olla Ramlan',         email: 'olla@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211075', name: 'Pevita Pearce',       email: 'pevita@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211076', name: 'Raisa Andriana',      email: 'raisa@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211077', name: 'Sule Sutisna',        email: 'sule@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211078', name: 'Tarra Budiman',       email: 'tarra@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211079', name: 'Velove Vexia',        email: 'velove@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211080', name: 'Widy Vierra',         email: 'widy@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211081', name: 'Yura Yunita',         email: 'yura@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211082', name: 'Zaskia Gotik',        email: 'zaskia@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211083', name: 'Arya Saloka',         email: 'arya@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211084', name: 'Bastian Steel',       email: 'bastian@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211085', name: 'Cut Tari',            email: 'cut@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211086', name: 'Deddy Mizwar',        email: 'deddy@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211087', name: 'Ernest Prakasa',      email: 'ernest@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211088', name: 'Fedi Nuril',          email: 'fedi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211089', name: 'Glenn Fredly',        email: 'glenn@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211090', name: 'Happy Salma',         email: 'happy@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211091', name: 'Iko Uwais',           email: 'iko@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211092', name: 'Joe Taslim',          email: 'joe@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211093', name: 'Krisdayanti',         email: 'krisdayanti@apps.ipb.ac.id',  role: 'student' },
  { nim: 'M6401211094', name: 'Laudya Chintya',      email: 'laudya@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211095', name: 'Maudy Ayunda',        email: 'maudy@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211096', name: 'Nicholas Saputra',    email: 'nicholas@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211097', name: 'Oka Antara',          email: 'oka@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211098', name: 'Prilly Latuconsina',  email: 'prilly@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211099', name: 'Raffi Ahmad',         email: 'raffi@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211100', name: 'Sandra Dewi',         email: 'sandra@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211101', name: 'Titi DJ',             email: 'titi@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211102', name: 'Ussy Sulistiawaty',   email: 'ussy@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211103', name: 'Vicky Prasetyo',      email: 'vicky@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211104', name: 'Winda Khair',         email: 'winda@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211105', name: 'Yuki Kato',           email: 'yuki@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211106', name: 'Zara Leola',          email: 'zara@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211107', name: 'Adipati Dolken',      email: 'adipati@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211108', name: 'Bunga Citra',         email: 'bunga@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211109', name: 'Chelsea Islan',       email: 'chelsea@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211110', name: 'Dian Sastro',         email: 'dian@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211111', name: 'Eno Bening',          email: 'eno@apps.ipb.ac.id',          role: 'student' },
  { nim: 'M6401211112', name: 'Fahri Albar',         email: 'fahri@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211113', name: 'Gritte Agatha',       email: 'gritte@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211114', name: 'Hanggini Purinda',    email: 'hanggini@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211115', name: 'Isyana Sarasvati',    email: 'isyana@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211116', name: 'Jessica Mila',        email: 'jessica@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211117', name: 'Kevin Julio',         email: 'kevin.j@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211118', name: 'Laura Basuki',        email: 'laura@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211119', name: 'Mikha Tambayong',     email: 'mikha@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211120', name: 'Natasha Wilona',      email: 'natasha@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211121', name: 'Olivia Jensen',       email: 'olivia@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211122', name: 'Patricia Schuldtz',   email: 'patricia@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211123', name: 'Raihaanun Fatimah',   email: 'raihaanun@apps.ipb.ac.id',    role: 'student' },
  { nim: 'M6401211124', name: 'Sheila Dara',         email: 'sheila@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211125', name: 'Tara Basro',          email: 'tara@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211126', name: 'Vanesha Prescilla',   email: 'vanesha@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211127', name: 'Wulan Febrianti',     email: 'wulan.f@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211128', name: 'Yoriko Angeline',     email: 'yoriko@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211129', name: 'Zara Adhisty',        email: 'zara.a@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211130', name: 'Angga Yunanda',       email: 'angga@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211131', name: 'Bryan Domani',        email: 'bryan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211132', name: 'Ciara Brosnan',       email: 'ciara@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211133', name: 'Dannia Salsabila',    email: 'dannia@apps.ipb.ac.id',       role: 'student' },
  { nim: 'M6401211134', name: 'Erika Carlina',       email: 'erika@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211135', name: 'Febby Rastanty',      email: 'febby@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211136', name: 'Giorgino Abraham',    email: 'giorgino@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211137', name: 'Hana Saraswati',      email: 'hana@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211138', name: 'Immanuel Caesar',     email: 'immanuel@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211139', name: 'Jefan Nathanio',      email: 'jefan@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211140', name: 'Kesha Ratuliu',       email: 'kesha@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211141', name: 'Lutesha Putri',       email: 'lutesha@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211142', name: 'Michelle Ziudith',    email: 'michelle@apps.ipb.ac.id',     role: 'student' },
  { nim: 'M6401211143', name: 'Nabilah Ayu',         email: 'nabilah@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211144', name: 'Omar Daniel',         email: 'omar@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211145', name: 'Putri Marino',        email: 'putri.marino@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211146', name: 'Rayn Wijaya',         email: 'rayn@apps.ipb.ac.id',         role: 'student' },
  { nim: 'M6401211147', name: 'Sandrinna Michelle',  email: 'sandrinna@apps.ipb.ac.id',    role: 'student' },
  { nim: 'M6401211148', name: 'Tissa Biani',         email: 'tissa@apps.ipb.ac.id',        role: 'student' },
  { nim: 'M6401211149', name: 'Verrell Bramasta',    email: 'verrell@apps.ipb.ac.id',      role: 'student' },
  { nim: 'M6401211150', name: 'Marbot Markibot',     email: 'marbot@apps.ipb.ac.id',       role: 'student' },
];

// ==================== PARALLEL CLASSES ====================

const parallelClasses = [
  // KOM201 - Basis Data (4 lecture)
  { id: 1,  courseCode: 'KOM201', courseName: 'Basis Data',                classCode: 'K1', day: 'Senin',  timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 1.1' },
  { id: 2,  courseCode: 'KOM201', courseName: 'Basis Data',                classCode: 'K2', day: 'Selasa', timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 1.2' },
  { id: 3,  courseCode: 'KOM201', courseName: 'Basis Data',                classCode: 'K3', day: 'Rabu',   timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 2.1' },
  { id: 4,  courseCode: 'KOM201', courseName: 'Basis Data',                classCode: 'K4', day: 'Kamis',  timeStart: '15:00', timeEnd: '17:00', room: 'FMIPA 2.2' },
  // KOM202 - Algoritma dan Pemrograman (3 lecture + 3 lab)
  { id: 5,  courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'K1', day: 'Senin',  timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 3.1' },
  { id: 6,  courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'K2', day: 'Selasa', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 3.2' },
  { id: 7,  courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'K3', day: 'Rabu',   timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 3.3' },
  { id: 8,  courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'P1', day: 'Senin',  timeStart: '13:00', timeEnd: '15:00', room: 'LAB 1'     },
  { id: 9,  courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'P2', day: 'Rabu',   timeStart: '08:00', timeEnd: '10:00', room: 'LAB 2'     },
  { id: 10, courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'P3', day: 'Jumat',  timeStart: '10:00', timeEnd: '12:00', room: 'LAB 3'     },
  // MAT203 - Aljabar Linear (3 lecture + 3 responsi)
  { id: 11, courseCode: 'MAT203', courseName: 'Aljabar Linear',            classCode: 'K1', day: 'Selasa', timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 4.1' },
  { id: 12, courseCode: 'MAT203', courseName: 'Aljabar Linear',            classCode: 'K2', day: 'Kamis',  timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 4.2' },
  { id: 13, courseCode: 'MAT203', courseName: 'Aljabar Linear',            classCode: 'K3', day: 'Jumat',  timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 4.3' },
  { id: 14, courseCode: 'MAT203', courseName: 'Aljabar Linear',            classCode: 'R1', day: 'Rabu',   timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 4.4' },
  { id: 15, courseCode: 'MAT203', courseName: 'Aljabar Linear',            classCode: 'R2', day: 'Kamis',  timeStart: '16:00', timeEnd: '17:00', room: 'FMIPA 4.5' },
  { id: 16, courseCode: 'MAT203', courseName: 'Aljabar Linear',            classCode: 'R3', day: 'Jumat',  timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 4.6' },
  // FIS204 - Fisika Komputasi (3 lecture)
  { id: 17, courseCode: 'FIS204', courseName: 'Fisika Komputasi',          classCode: 'K1', day: 'Senin',  timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 5.1' },
  { id: 18, courseCode: 'FIS204', courseName: 'Fisika Komputasi',          classCode: 'K2', day: 'Rabu',   timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 5.2' },
  { id: 19, courseCode: 'FIS204', courseName: 'Fisika Komputasi',          classCode: 'K3', day: 'Kamis',  timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 5.3' },
  // STA205 - Statistika (3 lecture + 2 lab)
  { id: 20, courseCode: 'STA205', courseName: 'Statistika',                classCode: 'K1', day: 'Selasa', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 6.1' },
  { id: 21, courseCode: 'STA205', courseName: 'Statistika',                classCode: 'K2', day: 'Rabu',   timeStart: '15:00', timeEnd: '17:00', room: 'FMIPA 6.2' },
  { id: 22, courseCode: 'STA205', courseName: 'Statistika',                classCode: 'K3', day: 'Jumat',  timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 6.3' },
  { id: 23, courseCode: 'STA205', courseName: 'Statistika',                classCode: 'P1', day: 'Senin',  timeStart: '15:00', timeEnd: '17:00', room: 'LAB 4'     },
  { id: 24, courseCode: 'STA205', courseName: 'Statistika',                classCode: 'P2', day: 'Kamis',  timeStart: '08:00', timeEnd: '10:00', room: 'LAB 5'     },
  // KOM301 - Struktur Data (2 lecture + 3 responsi)
  { id: 25, courseCode: 'KOM301', courseName: 'Struktur Data',             classCode: 'K1', day: 'Senin',  timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 7.1' },
  { id: 26, courseCode: 'KOM301', courseName: 'Struktur Data',             classCode: 'K2', day: 'Rabu',   timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 7.2' },
  { id: 27, courseCode: 'KOM301', courseName: 'Struktur Data',             classCode: 'R1', day: 'Selasa', timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 7.3' },
  { id: 28, courseCode: 'KOM301', courseName: 'Struktur Data',             classCode: 'R2', day: 'Kamis',  timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 7.4' },
  { id: 29, courseCode: 'KOM301', courseName: 'Struktur Data',             classCode: 'R3', day: 'Jumat',  timeStart: '16:00', timeEnd: '17:00', room: 'FMIPA 7.5' },
];

// ==================== SIMULATION ENGINE ====================

/**
 * Course structure: courseCode -> sessionType -> ordered classId arrays.
 * The ORDER of classId arrays is critical: enrollment is assigned by
 * classIds[userIndex % classIds.length].
 */
const COURSE_STRUCTURE = {
  KOM201: { K: [1, 2, 3, 4] },
  KOM202: { K: [5, 6, 7], P: [8, 9, 10] },
  MAT203: { K: [11, 12, 13], R: [14, 15, 16] },
  FIS204: { K: [17, 18, 19] },
  STA205: { K: [20, 21, 22], P: [23, 24] },
  KOM301: { K: [25, 26], R: [27, 28, 29] },
};

// Fast lookup: classId -> class object
const PC = Object.fromEntries(parallelClasses.map(c => [c.id, c]));

// Fast lookup: nim -> user object
const USER_MAP = Object.fromEntries(users.map(u => [u.nim, u]));

/**
 * MUTABLE ENROLLMENT STATE: nim -> Set<classId>
 * Single source of truth. Initialised from deterministic modulo assignment,
 * evolved by matched swaps, then written to the enrollments table.
 */
const state = {};
users.forEach((u, idx) => {
  state[u.nim] = new Set();
  for (const types of Object.values(COURSE_STRUCTURE)) {
    for (const classIds of Object.values(types)) {
      state[u.nim].add(classIds[idx % classIds.length]);
    }
  }
});

/**
 * Returns conflict info if adding classId to nim's schedule (excluding excludeId)
 * would overlap any existing enrollment. Returns null if no conflict.
 * Overlap: A.start < B.end && B.start < A.end (half-open intervals).
 * String comparison is safe — times are always zero-padded "HH:MM".
 */
function hasConflict(nim, classId, excludeId = null) {
  const pc = PC[classId];
  for (const id of state[nim]) {
    if (id === excludeId || id === classId) continue;
    const other = PC[id];
    if (other.day === pc.day && other.timeStart < pc.timeEnd && pc.timeStart < other.timeEnd) {
      return { conflictId: id, conflictClass: other };
    }
  }
  return null;
}

const now = new Date();

// Returns a Date object `days` days and `hours` hours before now
const ago = (days, hours = 0) =>
  new Date(now.getTime() - (days * 86400 + hours * 3600) * 1000);

// All barter offer records, built by simulation functions below
const offerRecords = [];

// NIMs that have already participated in any offer
const usedNims = new Set();

// ==================== CORE SIMULATION FUNCTIONS ====================

/**
 * Finds and executes a matched swap between classAId and classBId.
 * Scans users for a valid offerer (enrolled in A, can receive B) and
 * a valid taker (enrolled in B, can receive A). Mutates state on success.
 * Returns [offererNim, takerNim] or null if no valid pair found.
 *
 * allowReuse: if true, lets already-used NIMs participate (for high-volume).
 */
function findAndExecuteSwap(classAId, classBId, createdAt, completedAt, allowReuse = false) {
  for (const offerer of users) {
    if (!allowReuse && usedNims.has(offerer.nim)) continue;
    if (!state[offerer.nim].has(classAId)) continue;
    if (hasConflict(offerer.nim, classBId, classAId)) continue;

    for (const taker of users) {
      if (!allowReuse && usedNims.has(taker.nim)) continue;
      if (taker.nim === offerer.nim) continue;
      if (!state[taker.nim].has(classBId)) continue;
      if (hasConflict(taker.nim, classAId, classBId)) continue;

      state[offerer.nim].delete(classAId);
      state[offerer.nim].add(classBId);
      state[taker.nim].delete(classBId);
      state[taker.nim].add(classAId);

      usedNims.add(offerer.nim);
      usedNims.add(taker.nim);

      offerRecords.push({
        offererNim: offerer.nim,
        myClassId: classAId,
        wantedClassId: classBId,
        status: 'matched',
        takerNim: taker.nim,
        createdAt,
        completedAt,
      });

      console.log(`MATCHED: ${offerer.name} (class ${classAId}) <-> ${taker.name} (class ${classBId})`);
      return [offerer.nim, taker.nim];
    }
  }
  return null;
}

/**
 * Finds a user enrolled in one of possibleMyClassIds and creates a cancelled
 * offer for them wanting wantedClassId. Does not mutate state.
 * Returns offererNim or null.
 */
function findAndAddCancelledOffer(possibleMyClassIds, wantedClassId, createdAt) {
  for (const user of users) {
    if (usedNims.has(user.nim)) continue;
    for (const myClassId of possibleMyClassIds) {
      if (!state[user.nim].has(myClassId)) continue;

      usedNims.add(user.nim);
      offerRecords.push({
        offererNim: user.nim,
        myClassId,
        wantedClassId,
        status: 'cancelled',
        takerNim: null,
        createdAt,
        completedAt: null,
      });

      const pc  = PC[myClassId];
      const wpc = PC[wantedClassId];
      console.log(`CANCELLED: ${user.name} offered ${pc.courseCode}-${pc.classCode} -> wanted ${wpc.courseCode}-${wpc.classCode}`);
      return user.nim;
    }
  }
  return null;
}

/**
 * Finds a user enrolled in one of possibleMyClassIds who can validly want
 * wantedClassId (no schedule conflict after hypothetically receiving it),
 * and creates an open offer. Does not mutate state.
 * Returns offererNim or null.
 */
function findAndAddOpenOffer(possibleMyClassIds, wantedClassId, createdAt) {
  for (const user of users) {
    if (usedNims.has(user.nim)) continue;
    for (const myClassId of possibleMyClassIds) {
      if (!state[user.nim].has(myClassId)) continue;
      if (hasConflict(user.nim, wantedClassId, myClassId)) continue;

      usedNims.add(user.nim);
      offerRecords.push({
        offererNim: user.nim,
        myClassId,
        wantedClassId,
        status: 'open',
        takerNim: null,
        createdAt,
        completedAt: null,
      });

      const pc  = PC[myClassId];
      const wpc = PC[wantedClassId];
      console.log(`OPEN: ${user.name} offering ${pc.courseCode}-${pc.classCode} -> wants ${wpc.courseCode}-${wpc.classCode}`);
      return user.nim;
    }
  }
  return null;
}

// ==================== GENERATE MATCHED SWAPS (20) ====================

console.log('\n--- Generating matched swaps ---');

// KOM201 - Basis Data
findAndExecuteSwap(1, 2, ago(7, 2),  ago(7, 1));
findAndExecuteSwap(3, 4, ago(7, 5),  ago(7, 4));
findAndExecuteSwap(2, 3, ago(6, 8),  ago(6, 7));
findAndExecuteSwap(4, 1, ago(6, 3),  ago(6, 2));
findAndExecuteSwap(1, 3, ago(5, 6),  ago(5, 5));

// KOM202 - Lecture
// NOTE: (5,6) impossible — K1 holders also hold STA205 K1 (Tue 13-15) which conflicts with K2
findAndExecuteSwap(5, 7, ago(5, 3),  ago(5, 2));
findAndExecuteSwap(7, 5, ago(4, 10), ago(4, 9));

// KOM202 - Praktikum
findAndExecuteSwap(8, 9,  ago(4, 4),  ago(4, 3));
findAndExecuteSwap(10, 8, ago(3, 7),  ago(3, 6));

// MAT203 - Lecture
findAndExecuteSwap(11, 12, ago(3, 2), ago(3, 1));
findAndExecuteSwap(13, 11, ago(2, 9), ago(2, 8));

// MAT203 - Responsi
// NOTE: class 14 (Wed 15-16) cannot be received by R2/R3 holders — STA205 K2 (Wed 15-17) overlaps
findAndExecuteSwap(15, 16, ago(2, 5), ago(2, 4));
findAndExecuteSwap(16, 15, ago(2, 1), ago(1, 23));

// FIS204
findAndExecuteSwap(17, 18, ago(1, 20), ago(1, 19));
findAndExecuteSwap(19, 17, ago(1, 15), ago(1, 14));
findAndExecuteSwap(18, 19, ago(1, 10), ago(1, 9));

// STA205
// NOTE: (20,21) impossible — K1 holders have MAT203 R1 (Wed 15-16) which conflicts with K2 (Wed 15-17)
findAndExecuteSwap(20, 22, ago(1, 6),  ago(1, 5));
findAndExecuteSwap(23, 24, ago(0, 20), ago(0, 19));

// KOM301
findAndExecuteSwap(25, 26, ago(0, 14), ago(0, 13));
findAndExecuteSwap(27, 28, ago(0, 8),  ago(0, 7));

// ==================== GENERATE CANCELLED OFFERS (8) ====================

console.log('\n--- Generating cancelled offers ---');

findAndAddCancelledOffer([1, 2],   3,  ago(6, 12));
findAndAddCancelledOffer([11, 12], 13, ago(5, 9));
findAndAddCancelledOffer([17, 18], 19, ago(4, 15));
findAndAddCancelledOffer([20, 21], 22, ago(3, 11));
findAndAddCancelledOffer([8, 9],   10, ago(2, 8));
findAndAddCancelledOffer([25],     26, ago(1, 16));
findAndAddCancelledOffer([14, 15], 16, ago(1, 5));
findAndAddCancelledOffer([2, 3],   4,  ago(0, 12));

// ==================== GENERATE OPEN OFFERS (35) ====================

console.log('\n--- Generating open offers ---');

// KOM201
findAndAddOpenOffer([1], 2, ago(0, 8.0));
findAndAddOpenOffer([1], 3, ago(0, 7.5));
findAndAddOpenOffer([2], 4, ago(0, 7.0));
findAndAddOpenOffer([3], 2, ago(0, 6.5));
findAndAddOpenOffer([4], 1, ago(0, 6.0));
findAndAddOpenOffer([4], 3, ago(0, 5.5));

// KOM202 - Lecture
// NOTE: [5]->6 impossible (same conflict as matched swap above)
findAndAddOpenOffer([5], 7, ago(0, 7.5));
findAndAddOpenOffer([6], 7, ago(0, 7.0));
findAndAddOpenOffer([7], 5, ago(0, 6.5));
findAndAddOpenOffer([7], 6, ago(0, 6.0));

// KOM202 - Praktikum
findAndAddOpenOffer([8],  9,  ago(0, 7.5));
findAndAddOpenOffer([9],  10, ago(0, 7.0));
findAndAddOpenOffer([10], 8,  ago(0, 6.0));
findAndAddOpenOffer([8],  10, ago(0, 5.5));

// MAT203 - Lecture
findAndAddOpenOffer([11], 12, ago(0, 7.0));
findAndAddOpenOffer([12], 13, ago(0, 6.0));
findAndAddOpenOffer([13], 11, ago(0, 5.0));

// MAT203 - Responsi
// NOTE: [16]->14 impossible — R3 holders have STA205 K2 (Wed 15-17) which conflicts with class 14 (Wed 15-16)
findAndAddOpenOffer([14], 15, ago(0, 7.0));
findAndAddOpenOffer([15], 16, ago(0, 6.0));
findAndAddOpenOffer([16], 15, ago(0, 5.0));
findAndAddOpenOffer([14], 16, ago(0, 4.0));

// FIS204
findAndAddOpenOffer([17], 18, ago(0, 6.5));
findAndAddOpenOffer([18], 19, ago(0, 5.5));
findAndAddOpenOffer([19], 17, ago(0, 4.5));
findAndAddOpenOffer([17], 19, ago(0, 3.5));

// STA205 - Lecture
// NOTE: [20]->21 impossible — K1 holders have MAT203 R1 (Wed 15-16) conflicts with K2 (Wed 15-17)
findAndAddOpenOffer([20], 22, ago(0, 6.0));
findAndAddOpenOffer([21], 22, ago(0, 5.0));
findAndAddOpenOffer([22], 20, ago(0, 4.0));

// STA205 - Praktikum
findAndAddOpenOffer([23], 24, ago(0, 3.0));
findAndAddOpenOffer([24], 23, ago(0, 2.0));

// KOM301 - Lecture
findAndAddOpenOffer([25], 26, ago(0, 5.5));
findAndAddOpenOffer([26], 25, ago(0, 4.5));

// KOM301 - Responsi
findAndAddOpenOffer([27], 28, ago(0, 3.5));
findAndAddOpenOffer([28], 29, ago(0, 2.5));
findAndAddOpenOffer([29], 27, ago(0, 1.5));

// ==================== DERIVE FINAL ENROLLMENTS FROM STATE ====================

/**
 * The state map is the canonical source of truth after all matched swaps.
 * Reading it directly gives the correct final enrollment for every student.
 */
function buildEnrollments() {
  const enrollments = [];
  for (const user of users) {
    for (const classId of state[user.nim]) {
      enrollments.push({ nim: user.nim, parallelClassId: classId });
    }
  }
  return enrollments;
}

// ==================== VALIDATION ====================

function validate() {
  console.log('\n--- Validating seed data ---');
  let errors = 0;

  for (const offer of offerRecords) {
    if (offer.status === 'matched') {
      if (!state[offer.offererNim].has(offer.wantedClassId)) {
        console.error(`VALIDATE ERROR: ${offer.offererNim} missing wantedClass ${offer.wantedClassId} after matched swap`);
        errors++;
      }
      if (!state[offer.takerNim].has(offer.myClassId)) {
        console.error(`VALIDATE ERROR: ${offer.takerNim} missing myClass ${offer.myClassId} after matched swap`);
        errors++;
      }
    }

    if (offer.status === 'cancelled' || offer.status === 'open') {
      if (!state[offer.offererNim].has(offer.myClassId)) {
        console.error(`VALIDATE ERROR: ${offer.offererNim} should still have myClass ${offer.myClassId} (${offer.status} offer)`);
        errors++;
      }
    }

    if (offer.status === 'open') {
      const conflict = hasConflict(offer.offererNim, offer.wantedClassId, offer.myClassId);
      if (conflict) {
        console.error(`VALIDATE ERROR: ${offer.offererNim} open offer wants class ${offer.wantedClassId} but conflicts with class ${conflict.conflictId}`);
        errors++;
      }
    }
  }

  if (errors > 0) {
    throw new Error(`Seed validation failed with ${errors} error(s). Fix before importing.`);
  }

  console.log('Validation passed.');
}

// ==================== BUILD NOTIFICATIONS ====================

/**
 * Generates inbox notifications for all matched offers.
 * Inserts offers one-by-one (not createMany) to get real DB-generated IDs,
 * then builds notifications referencing those IDs.
 * All seeded notifications are read: true — they are historical data.
 * staleCancelledOffers is empty for seed data — not simulated.
 */
async function insertOffersAndBuildNotifications() {
  const notificationRecords = [];

  for (const offer of offerRecords) {
    const inserted = await prisma.barterOffer.create({ data: offer });

    if (offer.status !== 'matched') continue;

    const myClass     = PC[offer.myClassId];
    const wantedClass = PC[offer.wantedClassId];
    const offerer     = USER_MAP[offer.offererNim];
    const taker       = USER_MAP[offer.takerNim];

    notificationRecords.push({
      recipientNim: offer.offererNim,
      type: 'barter_matched_as_offerer',
      read: true,
      createdAt: offer.completedAt,
      data: {
        offerId: inserted.id,
        takerNim: taker.nim,
        takerName: taker.name,
        yourOldClass: { courseCode: myClass.courseCode,     classCode: myClass.classCode     },
        yourNewClass: { courseCode: wantedClass.courseCode, classCode: wantedClass.classCode },
        staleCancelledOffers: [],
      },
    });

    notificationRecords.push({
      recipientNim: offer.takerNim,
      type: 'barter_matched_as_taker',
      read: true,
      createdAt: offer.completedAt,
      data: {
        offerId: inserted.id,
        offererNim: offerer.nim,
        offererName: offerer.name,
        yourOldClass: { courseCode: wantedClass.courseCode, classCode: wantedClass.classCode },
        yourNewClass: { courseCode: myClass.courseCode,     classCode: myClass.classCode     },
        staleCancelledOffers: [],
      },
    });
  }

  return notificationRecords;
}

// ==================== MAIN IMPORT ====================

async function importData() {
  validate();

  const enrollments    = buildEnrollments();
  const matchedCount   = offerRecords.filter(o => o.status === 'matched').length;
  const cancelledCount = offerRecords.filter(o => o.status === 'cancelled').length;
  const openCount      = offerRecords.filter(o => o.status === 'open').length;

  console.log('\n--- Seed plan ---');
  console.log(`Users        : ${users.length}`);
  console.log(`Classes      : ${parallelClasses.length}`);
  console.log(`Enrollments  : ${enrollments.length}`);
  console.log(`Offers       : ${offerRecords.length} (matched: ${matchedCount}, cancelled: ${cancelledCount}, open: ${openCount})`);
  console.log(`Notifications: ${matchedCount * 2} (2 per matched offer)`);

  console.log('\n--- Cleaning existing data ---');
  // Delete in dependency order — child tables first
  await prisma.notification.deleteMany({});
  await prisma.barterOffer.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.parallelClass.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('\n--- Importing data ---');

  await prisma.user.createMany({ data: users });
  console.log(`users: ${users.length}`);

  await prisma.parallelClass.createMany({ data: parallelClasses });
  console.log(`parallel_classes: ${parallelClasses.length}`);

  // Batch enrollments to avoid overwhelming the connection pool
  const CHUNK = 200;
  for (let i = 0; i < enrollments.length; i += CHUNK) {
    await prisma.enrollment.createMany({ data: enrollments.slice(i, i + CHUNK) });
  }
  console.log(`enrollments: ${enrollments.length}`);

  // Insert offers one-by-one to get real IDs for notification references
  const notificationRecords = await insertOffersAndBuildNotifications();
  console.log(`barter_offers: ${offerRecords.length}`);

  await prisma.notification.createMany({ data: notificationRecords });
  console.log(`notifications: ${notificationRecords.length}`);

  console.log('\n--- Import complete ---');

  await prisma.$disconnect();
  await pool.end();
}

importData().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});