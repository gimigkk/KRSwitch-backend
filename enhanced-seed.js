require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ==================== USERS DATA ====================

const users = [
  { nim: 'M6401211001', name: 'Ahmad Fauzi', email: 'ahmad@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211002', name: 'Budi Santoso', email: 'budi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211003', name: 'Citra Dewi', email: 'citra@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211004', name: 'Dedi Hermawan', email: 'dedi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211005', name: 'Eka Putri', email: 'eka@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211006', name: 'Fajar Rahman', email: 'fajar@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211007', name: 'Gita Sari', email: 'gita@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211008', name: 'Hendra Wijaya', email: 'hendra@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211009', name: 'Indah Lestari', email: 'indah@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211010', name: 'Joko Susilo', email: 'joko@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211011', name: 'Kartika Sari', email: 'kartika@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211012', name: 'Lutfi Hakim', email: 'lutfi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211013', name: 'Maya Anggraini', email: 'maya@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211014', name: 'Nanda Pratama', email: 'nanda@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211015', name: 'Oki Setiawan', email: 'oki@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211016', name: 'Putri Ayu', email: 'putri@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211017', name: 'Qori Hidayat', email: 'qori@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211018', name: 'Rina Melati', email: 'rina@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211019', name: 'Siti Nurhaliza', email: 'siti@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211020', name: 'Taufik Rahman', email: 'taufik@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211021', name: 'Usman Hakim', email: 'usman@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211022', name: 'Vina Amalia', email: 'vina@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211023', name: 'Wahyu Pratama', email: 'wahyu@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211024', name: 'Xena Putri', email: 'xena@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211025', name: 'Yusuf Ibrahim', email: 'yusuf@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211026', name: 'Zahra Amelia', email: 'zahra@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211027', name: 'Rizki Firmansyah', email: 'rizki@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211028', name: 'Dina Marlina', email: 'dina@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211029', name: 'Bagus Pradana', email: 'bagus@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211030', name: 'Sinta Permata', email: 'sinta@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211031', name: 'Arif Budiman', email: 'arif@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211032', name: 'Nurul Fatimah', email: 'nurul@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211033', name: 'Rizal Ramadhan', email: 'rizal@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211034', name: 'Ayu Lestari', email: 'ayu@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211035', name: 'Bayu Saputra', email: 'bayu@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211036', name: 'Candra Kirana', email: 'candra@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211037', name: 'Dwi Ananda', email: 'dwi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211038', name: 'Erlangga Putra', email: 'erlangga@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211039', name: 'Fitri Handayani', email: 'fitri@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211040', name: 'Gilang Ramadhan', email: 'gilang@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211041', name: 'Hani Rahmawati', email: 'hani@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211042', name: 'Irfan Hakim', email: 'irfan@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211043', name: 'Julia Safitri', email: 'julia@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211044', name: 'Kevin Anggara', email: 'kevin@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211045', name: 'Lisa Amelia', email: 'lisa@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211046', name: 'Muhamad Rizki', email: 'muhamad@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211047', name: 'Nina Safira', email: 'nina@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211048', name: 'Oscar Pratama', email: 'oscar@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211049', name: 'Putri Maharani', email: 'putri.m@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211050', name: 'Qomar Zaman', email: 'qomar@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211051', name: 'Rudi Hartono', email: 'rudi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211052', name: 'Sari Wulandari', email: 'sari@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211053', name: 'Toni Hermawan', email: 'toni@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211054', name: 'Umi Kalsum', email: 'umi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211055', name: 'Vino Bastian', email: 'vino@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211056', name: 'Wulan Guritno', email: 'wulan@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211057', name: 'Xavier Gunawan', email: 'xavier@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211058', name: 'Yanti Suhardi', email: 'yanti@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211059', name: 'Zaki Abdullah', email: 'zaki@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211060', name: 'Aldi Taher', email: 'aldi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211061', name: 'Bella Saphira', email: 'bella@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211062', name: 'Cahya Kamila', email: 'cahya@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211063', name: 'Daus Mini', email: 'daus@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211064', name: 'Elma Theana', email: 'elma@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211065', name: 'Fikri Ramadhan', email: 'fikri@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211066', name: 'Gading Martin', email: 'gading@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211067', name: 'Hamish Daud', email: 'hamish@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211068', name: 'Intan Nuraini', email: 'intan@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211069', name: 'Jefri Nichol', email: 'jefri@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211070', name: 'Kikan Namara', email: 'kikan@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211071', name: 'Luna Maya', email: 'luna@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211072', name: 'Marsha Timothy', email: 'marsha@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211073', name: 'Nabila Syakieb', email: 'nabila@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211074', name: 'Olla Ramlan', email: 'olla@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211075', name: 'Pevita Pearce', email: 'pevita@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211076', name: 'Raisa Andriana', email: 'raisa@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211077', name: 'Sule Sutisna', email: 'sule@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211078', name: 'Tarra Budiman', email: 'tarra@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211079', name: 'Velove Vexia', email: 'velove@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211080', name: 'Widy Vierra', email: 'widy@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211081', name: 'Yura Yunita', email: 'yura@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211082', name: 'Zaskia Gotik', email: 'zaskia@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211083', name: 'Arya Saloka', email: 'arya@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211084', name: 'Bastian Steel', email: 'bastian@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211085', name: 'Cut Tari', email: 'cut@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211086', name: 'Deddy Mizwar', email: 'deddy@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211087', name: 'Ernest Prakasa', email: 'ernest@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211088', name: 'Fedi Nuril', email: 'fedi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211089', name: 'Glenn Fredly', email: 'glenn@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211090', name: 'Happy Salma', email: 'happy@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211091', name: 'Iko Uwais', email: 'iko@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211092', name: 'Joe Taslim', email: 'joe@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211093', name: 'Krisdayanti', email: 'krisdayanti@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211094', name: 'Laudya Chintya', email: 'laudya@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211095', name: 'Maudy Ayunda', email: 'maudy@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211096', name: 'Nicholas Saputra', email: 'nicholas@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211097', name: 'Oka Antara', email: 'oka@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211098', name: 'Prilly Latuconsina', email: 'prilly@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211099', name: 'Raffi Ahmad', email: 'raffi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211100', name: 'Sandra Dewi', email: 'sandra@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211101', name: 'Titi DJ', email: 'titi@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211102', name: 'Ussy Sulistiawaty', email: 'ussy@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211103', name: 'Vicky Prasetyo', email: 'vicky@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211104', name: 'Winda Khair', email: 'winda@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211105', name: 'Yuki Kato', email: 'yuki@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211106', name: 'Zara Leola', email: 'zara@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211107', name: 'Adipati Dolken', email: 'adipati@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211108', name: 'Bunga Citra', email: 'bunga@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211109', name: 'Chelsea Islan', email: 'chelsea@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211110', name: 'Dian Sastro', email: 'dian@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211111', name: 'Eno Bening', email: 'eno@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211112', name: 'Fahri Albar', email: 'fahri@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211113', name: 'Gritte Agatha', email: 'gritte@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211114', name: 'Hanggini Purinda', email: 'hanggini@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211115', name: 'Isyana Sarasvati', email: 'isyana@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211116', name: 'Jessica Mila', email: 'jessica@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211117', name: 'Kevin Julio', email: 'kevin.j@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211118', name: 'Laura Basuki', email: 'laura@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211119', name: 'Mikha Tambayong', email: 'mikha@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211120', name: 'Natasha Wilona', email: 'natasha@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211121', name: 'Olivia Jensen', email: 'olivia@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211122', name: 'Patricia Schuldtz', email: 'patricia@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211123', name: 'Raihaanun Fatimah', email: 'raihaanun@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211124', name: 'Sheila Dara', email: 'sheila@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211125', name: 'Tara Basro', email: 'tara@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211126', name: 'Vanesha Prescilla', email: 'vanesha@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211127', name: 'Wulan Febrianti', email: 'wulan.f@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211128', name: 'Yoriko Angeline', email: 'yoriko@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211129', name: 'Zara Adhisty', email: 'zara.a@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211130', name: 'Angga Yunanda', email: 'angga@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211131', name: 'Bryan Domani', email: 'bryan@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211132', name: 'Ciara Brosnan', email: 'ciara@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211133', name: 'Dannia Salsabila', email: 'dannia@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211134', name: 'Erika Carlina', email: 'erika@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211135', name: 'Febby Rastanty', email: 'febby@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211136', name: 'Giorgino Abraham', email: 'giorgino@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211137', name: 'Hana Saraswati', email: 'hana@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211138', name: 'Immanuel Caesar', email: 'immanuel@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211139', name: 'Jefan Nathanio', email: 'jefan@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211140', name: 'Kesha Ratuliu', email: 'kesha@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211141', name: 'Lutesha Putri', email: 'lutesha@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211142', name: 'Michelle Ziudith', email: 'michelle@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211143', name: 'Nabilah Ayu', email: 'nabilah@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211144', name: 'Omar Daniel', email: 'omar@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211145', name: 'Putri Marino', email: 'putri.marino@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211146', name: 'Rayn Wijaya', email: 'rayn@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211147', name: 'Sandrinna Michelle', email: 'sandrinna@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211148', name: 'Tissa Biani', email: 'tissa@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211149', name: 'Verrell Bramasta', email: 'verrell@apps.ipb.ac.id', role: 'student' },
  { nim: 'M6401211150', name: 'Marbot Markibot', email: 'marbot@apps.ipb.ac.id', role: 'student' },
];

// ==================== PARALLEL CLASSES ====================

const parallelClasses = [
  // KOM201 - Basis Data (4 kuliah)
  { id: 1, courseCode: 'KOM201', courseName: 'Basis Data', classCode: 'K1', day: 'Senin', timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 1.1' },
  { id: 2, courseCode: 'KOM201', courseName: 'Basis Data', classCode: 'K2', day: 'Selasa', timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 1.2' },
  { id: 3, courseCode: 'KOM201', courseName: 'Basis Data', classCode: 'K3', day: 'Rabu', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 2.1' },
  { id: 4, courseCode: 'KOM201', courseName: 'Basis Data', classCode: 'K4', day: 'Kamis', timeStart: '15:00', timeEnd: '17:00', room: 'FMIPA 2.2' },
  
  // KOM202 - Algoritma dan Pemrograman (3 kuliah + 3 praktikum)
  { id: 5, courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'K1', day: 'Senin', timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 3.1' },
  { id: 6, courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'K2', day: 'Selasa', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 3.2' },
  { id: 7, courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'K3', day: 'Rabu', timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 3.3' },
  { id: 8, courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'P1', day: 'Senin', timeStart: '13:00', timeEnd: '15:00', room: 'LAB 1' },
  { id: 9, courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'P2', day: 'Rabu', timeStart: '08:00', timeEnd: '10:00', room: 'LAB 2' },
  { id: 10, courseCode: 'KOM202', courseName: 'Algoritma dan Pemrograman', classCode: 'P3', day: 'Jumat', timeStart: '10:00', timeEnd: '12:00', room: 'LAB 3' },
  
  // MAT203 - Aljabar Linear (3 kuliah + 3 responsi)
  { id: 11, courseCode: 'MAT203', courseName: 'Aljabar Linear', classCode: 'K1', day: 'Selasa', timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 4.1' },
  { id: 12, courseCode: 'MAT203', courseName: 'Aljabar Linear', classCode: 'K2', day: 'Kamis', timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 4.2' },
  { id: 13, courseCode: 'MAT203', courseName: 'Aljabar Linear', classCode: 'K3', day: 'Jumat', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 4.3' },
  { id: 14, courseCode: 'MAT203', courseName: 'Aljabar Linear', classCode: 'R1', day: 'Rabu', timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 4.4' },
  { id: 15, courseCode: 'MAT203', courseName: 'Aljabar Linear', classCode: 'R2', day: 'Kamis', timeStart: '16:00', timeEnd: '17:00', room: 'FMIPA 4.5' },
  { id: 16, courseCode: 'MAT203', courseName: 'Aljabar Linear', classCode: 'R3', day: 'Jumat', timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 4.6' },
  
  // FIS204 - Fisika Komputasi (3 kuliah)
  { id: 17, courseCode: 'FIS204', courseName: 'Fisika Komputasi', classCode: 'K1', day: 'Senin', timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 5.1' },
  { id: 18, courseCode: 'FIS204', courseName: 'Fisika Komputasi', classCode: 'K2', day: 'Rabu', timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 5.2' },
  { id: 19, courseCode: 'FIS204', courseName: 'Fisika Komputasi', classCode: 'K3', day: 'Kamis', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 5.3' },
  
  // STA205 - Statistika (3 kuliah + 2 praktikum)
  { id: 20, courseCode: 'STA205', courseName: 'Statistika', classCode: 'K1', day: 'Selasa', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 6.1' },
  { id: 21, courseCode: 'STA205', courseName: 'Statistika', classCode: 'K2', day: 'Rabu', timeStart: '15:00', timeEnd: '17:00', room: 'FMIPA 6.2' },
  { id: 22, courseCode: 'STA205', courseName: 'Statistika', classCode: 'K3', day: 'Jumat', timeStart: '08:00', timeEnd: '10:00', room: 'FMIPA 6.3' },
  { id: 23, courseCode: 'STA205', courseName: 'Statistika', classCode: 'P1', day: 'Senin', timeStart: '15:00', timeEnd: '17:00', room: 'LAB 4' },
  { id: 24, courseCode: 'STA205', courseName: 'Statistika', classCode: 'P2', day: 'Kamis', timeStart: '08:00', timeEnd: '10:00', room: 'LAB 5' },
  
  // KOM301 - Struktur Data (2 kuliah + 3 responsi)
  { id: 25, courseCode: 'KOM301', courseName: 'Struktur Data', classCode: 'K1', day: 'Senin', timeStart: '13:00', timeEnd: '15:00', room: 'FMIPA 7.1' },
  { id: 26, courseCode: 'KOM301', courseName: 'Struktur Data', classCode: 'K2', day: 'Rabu', timeStart: '10:00', timeEnd: '12:00', room: 'FMIPA 7.2' },
  { id: 27, courseCode: 'KOM301', courseName: 'Struktur Data', classCode: 'R1', day: 'Selasa', timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 7.3' },
  { id: 28, courseCode: 'KOM301', courseName: 'Struktur Data', classCode: 'R2', day: 'Kamis', timeStart: '15:00', timeEnd: '16:00', room: 'FMIPA 7.4' },
  { id: 29, courseCode: 'KOM301', courseName: 'Struktur Data', classCode: 'R3', day: 'Jumat', timeStart: '16:00', timeEnd: '17:00', room: 'FMIPA 7.5' },
];

// ==================== FUNCTIONS ====================

function generateEnrollments() {
  const enrollments = [];
  
  const courseStructure = {
    'KOM201': { kuliah: [1, 2, 3, 4], praktikum: [], responsi: [] },
    'KOM202': { kuliah: [5, 6, 7], praktikum: [8, 9, 10], responsi: [] },
    'MAT203': { kuliah: [11, 12, 13], praktikum: [], responsi: [14, 15, 16] },
    'FIS204': { kuliah: [17, 18, 19], praktikum: [], responsi: [] },
    'STA205': { kuliah: [20, 21, 22], praktikum: [23, 24], responsi: [] },
    'KOM301': { kuliah: [25, 26], praktikum: [], responsi: [27, 28, 29] },
  };
  
  users.forEach((user, userIndex) => {
    Object.entries(courseStructure).forEach(([courseCode, structure]) => {
      if (structure.kuliah.length > 0) {
        const kuliahClassId = structure.kuliah[userIndex % structure.kuliah.length];
        enrollments.push({ nim: user.nim, parallelClassId: kuliahClassId });
      }
      
      if (structure.praktikum.length > 0) {
        const praktikumClassId = structure.praktikum[userIndex % structure.praktikum.length];
        enrollments.push({ nim: user.nim, parallelClassId: praktikumClassId });
      }
      
      if (structure.responsi.length > 0) {
        const responsiClassId = structure.responsi[userIndex % structure.responsi.length];
        enrollments.push({ nim: user.nim, parallelClassId: responsiClassId });
      }
    });
  });
  
  return enrollments;
}

function generateRealisticOffers() {
  const now = new Date();
  const offers = [];
  
  const daysAgo = (days, hoursOffset = 0) => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    date.setHours(date.getHours() - hoursOffset);
    return date;
  };

  // Completed offers (20)
  offers.push(
    { offererNim: 'M6401211001', myClassId: 1, wantedClassId: 2, status: 'matched', createdAt: daysAgo(7, 2), takerNim: 'M6401211026', completedAt: daysAgo(7, 1) },
    { offererNim: 'M6401211044', myClassId: 2, wantedClassId: 4, status: 'matched', createdAt: daysAgo(7, 5), takerNim: 'M6401211069', completedAt: daysAgo(7, 4) },
    { offererNim: 'M6401211080', myClassId: 3, wantedClassId: 1, status: 'matched', createdAt: daysAgo(6, 8), takerNim: 'M6401211051', completedAt: daysAgo(6, 7) },
    { offererNim: 'M6401211003', myClassId: 9, wantedClassId: 10, status: 'matched', createdAt: daysAgo(5, 3), takerNim: 'M6401211028', completedAt: daysAgo(5, 1) },
    { offererNim: 'M6401211150', myClassId: 10, wantedClassId: 8, status: 'matched', createdAt: daysAgo(5, 6), takerNim: 'M6401211075', completedAt: daysAgo(5, 5) },
    { offererNim: 'M6401211015', myClassId: 8, wantedClassId: 9, status: 'matched', createdAt: daysAgo(4, 10), takerNim: 'M6401211040', completedAt: daysAgo(4, 9) },
    { offererNim: 'M6401211089', myClassId: 9, wantedClassId: 8, status: 'matched', createdAt: daysAgo(4, 4), takerNim: 'M6401211122', completedAt: daysAgo(4, 3) },
    { offererNim: 'M6401211005', myClassId: 16, wantedClassId: 14, status: 'matched', createdAt: daysAgo(3, 7), takerNim: 'M6401211030', completedAt: daysAgo(3, 6) },
    { offererNim: 'M6401211055', myClassId: 14, wantedClassId: 15, status: 'matched', createdAt: daysAgo(3, 2), takerNim: 'M6401211082', completedAt: daysAgo(3, 1) },
    { offererNim: 'M6401211107', myClassId: 15, wantedClassId: 16, status: 'matched', createdAt: daysAgo(2, 11), takerNim: 'M6401211133', completedAt: daysAgo(2, 10) },
    { offererNim: 'M6401211100', myClassId: 20, wantedClassId: 21, status: 'matched', createdAt: daysAgo(2, 5), takerNim: 'M6401211025', completedAt: daysAgo(2, 4) },
    { offererNim: 'M6401211125', myClassId: 21, wantedClassId: 22, status: 'matched', createdAt: daysAgo(2, 1), takerNim: 'M6401211050', completedAt: daysAgo(2, 0.5) },
    { offererNim: 'M6401211022', myClassId: 23, wantedClassId: 24, status: 'matched', createdAt: daysAgo(1, 18), takerNim: 'M6401211047', completedAt: daysAgo(1, 17) },
    { offererNim: 'M6401211138', myClassId: 24, wantedClassId: 23, status: 'matched', createdAt: daysAgo(1, 14), takerNim: 'M6401211063', completedAt: daysAgo(1, 13) },
    { offererNim: 'M6401211110', myClassId: 25, wantedClassId: 26, status: 'matched', createdAt: daysAgo(1, 8), takerNim: 'M6401211135', completedAt: daysAgo(1, 7) },
    { offererNim: 'M6401211011', myClassId: 27, wantedClassId: 28, status: 'matched', createdAt: daysAgo(1, 3), takerNim: 'M6401211036', completedAt: daysAgo(1, 2) },
    { offererNim: 'M6401211086', myClassId: 28, wantedClassId: 29, status: 'matched', createdAt: daysAgo(0, 22), takerNim: 'M6401211111', completedAt: daysAgo(0, 21) },
    { offererNim: 'M6401211143', myClassId: 29, wantedClassId: 27, status: 'matched', createdAt: daysAgo(0, 18), takerNim: 'M6401211068', completedAt: daysAgo(0, 17) },
    { offererNim: 'M6401211018', myClassId: 3, wantedClassId: 4, status: 'matched', createdAt: daysAgo(0, 14), takerNim: 'M6401211093', completedAt: daysAgo(0, 13) },
    { offererNim: 'M6401211127', myClassId: 19, wantedClassId: 17, status: 'matched', createdAt: daysAgo(0, 10), takerNim: 'M6401211052', completedAt: daysAgo(0, 9) }
  );

  // Cancelled offers (8)
  offers.push(
    { offererNim: 'M6401211007', myClassId: 1, wantedClassId: 3, status: 'cancelled', createdAt: daysAgo(6, 12), takerNim: null, completedAt: null },
    { offererNim: 'M6401211062', myClassId: 11, wantedClassId: 13, status: 'cancelled', createdAt: daysAgo(5, 9), takerNim: null, completedAt: null },
    { offererNim: 'M6401211098', myClassId: 17, wantedClassId: 19, status: 'cancelled', createdAt: daysAgo(4, 15), takerNim: null, completedAt: null },
    { offererNim: 'M6401211119', myClassId: 20, wantedClassId: 22, status: 'cancelled', createdAt: daysAgo(3, 11), takerNim: null, completedAt: null },
    { offererNim: 'M6401211034', myClassId: 8, wantedClassId: 10, status: 'cancelled', createdAt: daysAgo(2, 8), takerNim: null, completedAt: null },
    { offererNim: 'M6401211145', myClassId: 25, wantedClassId: 26, status: 'cancelled', createdAt: daysAgo(1, 16), takerNim: null, completedAt: null },
    { offererNim: 'M6401211071', myClassId: 14, wantedClassId: 16, status: 'cancelled', createdAt: daysAgo(1, 5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211096', myClassId: 2, wantedClassId: 4, status: 'cancelled', createdAt: daysAgo(0, 12), takerNim: null, completedAt: null }
  );

  // Open offers (35)
  offers.push(
    { offererNim: 'M6401211002', myClassId: 1, wantedClassId: 3, status: 'open', createdAt: daysAgo(0, 8), takerNim: null, completedAt: null },
    { offererNim: 'M6401211027', myClassId: 1, wantedClassId: 2, status: 'open', createdAt: daysAgo(0, 7), takerNim: null, completedAt: null },
    { offererNim: 'M6401211052', myClassId: 2, wantedClassId: 4, status: 'open', createdAt: daysAgo(0, 6), takerNim: null, completedAt: null },
    { offererNim: 'M6401211077', myClassId: 3, wantedClassId: 2, status: 'open', createdAt: daysAgo(0, 5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211102', myClassId: 4, wantedClassId: 1, status: 'open', createdAt: daysAgo(0, 4), takerNim: null, completedAt: null },
    { offererNim: 'M6401211127', myClassId: 4, wantedClassId: 3, status: 'open', createdAt: daysAgo(0, 3), takerNim: null, completedAt: null },
    { offererNim: 'M6401211008', myClassId: 8, wantedClassId: 9, status: 'open', createdAt: daysAgo(0, 7.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211033', myClassId: 9, wantedClassId: 10, status: 'open', createdAt: daysAgo(0, 6.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211058', myClassId: 10, wantedClassId: 8, status: 'open', createdAt: daysAgo(0, 5.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211083', myClassId: 8, wantedClassId: 10, status: 'open', createdAt: daysAgo(0, 4.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211108', myClassId: 9, wantedClassId: 8, status: 'open', createdAt: daysAgo(0, 3.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211013', myClassId: 14, wantedClassId: 15, status: 'open', createdAt: daysAgo(0, 7), takerNim: null, completedAt: null },
    { offererNim: 'M6401211038', myClassId: 15, wantedClassId: 16, status: 'open', createdAt: daysAgo(0, 6), takerNim: null, completedAt: null },
    { offererNim: 'M6401211063', myClassId: 16, wantedClassId: 14, status: 'open', createdAt: daysAgo(0, 5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211088', myClassId: 14, wantedClassId: 16, status: 'open', createdAt: daysAgo(0, 4), takerNim: null, completedAt: null },
    { offererNim: 'M6401211113', myClassId: 15, wantedClassId: 14, status: 'open', createdAt: daysAgo(0, 3), takerNim: null, completedAt: null },
    { offererNim: 'M6401211019', myClassId: 17, wantedClassId: 18, status: 'open', createdAt: daysAgo(0, 6.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211044', myClassId: 18, wantedClassId: 19, status: 'open', createdAt: daysAgo(0, 5.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211069', myClassId: 19, wantedClassId: 17, status: 'open', createdAt: daysAgo(0, 4.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211094', myClassId: 17, wantedClassId: 19, status: 'open', createdAt: daysAgo(0, 3.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211024', myClassId: 20, wantedClassId: 21, status: 'open', createdAt: daysAgo(0, 6), takerNim: null, completedAt: null },
    { offererNim: 'M6401211049', myClassId: 21, wantedClassId: 22, status: 'open', createdAt: daysAgo(0, 5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211074', myClassId: 22, wantedClassId: 20, status: 'open', createdAt: daysAgo(0, 4), takerNim: null, completedAt: null },
    { offererNim: 'M6401211099', myClassId: 23, wantedClassId: 24, status: 'open', createdAt: daysAgo(0, 3), takerNim: null, completedAt: null },
    { offererNim: 'M6401211124', myClassId: 24, wantedClassId: 23, status: 'open', createdAt: daysAgo(0, 2), takerNim: null, completedAt: null },
    { offererNim: 'M6401211029', myClassId: 25, wantedClassId: 26, status: 'open', createdAt: daysAgo(0, 5.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211054', myClassId: 26, wantedClassId: 25, status: 'open', createdAt: daysAgo(0, 4.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211079', myClassId: 27, wantedClassId: 28, status: 'open', createdAt: daysAgo(0, 3.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211104', myClassId: 28, wantedClassId: 29, status: 'open', createdAt: daysAgo(0, 2.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211129', myClassId: 29, wantedClassId: 27, status: 'open', createdAt: daysAgo(0, 1.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211010', myClassId: 2, wantedClassId: 1, status: 'open', createdAt: daysAgo(0, 2), takerNim: null, completedAt: null },
    { offererNim: 'M6401211035', myClassId: 11, wantedClassId: 12, status: 'open', createdAt: daysAgo(0, 1.8), takerNim: null, completedAt: null },
    { offererNim: 'M6401211060', myClassId: 12, wantedClassId: 13, status: 'open', createdAt: daysAgo(0, 1.5), takerNim: null, completedAt: null },
    { offererNim: 'M6401211085', myClassId: 13, wantedClassId: 11, status: 'open', createdAt: daysAgo(0, 1.2), takerNim: null, completedAt: null },
    { offererNim: 'M6401211115', myClassId: 18, wantedClassId: 17, status: 'open', createdAt: daysAgo(0, 1), takerNim: null, completedAt: null }
  );

  return offers;
}

// ==================== MAIN FUNCTION ====================

async function importData() {
  console.log('🧹 Cleaning existing data...');
  
  await prisma.barterOffer.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.parallelClass.deleteMany({});
  await prisma.user.deleteMany({});
  
  console.log('✨ Importing fresh data...\n');
  
  console.log(`📝 Importing ${users.length} users...`);
  await prisma.user.createMany({ data: users });
  
  console.log(`🏫 Importing ${parallelClasses.length} parallel classes...`);
  await prisma.parallelClass.createMany({ data: parallelClasses });
  
  console.log(`📚 Generating enrollments...`);
  const enrollments = generateEnrollments();
  console.log(`📋 Importing ${enrollments.length} enrollments...`);
  
  for (const enrollment of enrollments) {
    await prisma.enrollment.create({ data: enrollment });
  }
  
  console.log(`🔄 Generating realistic barter offers...`);
  const offers = generateRealisticOffers();
  
  const offerStats = {
    matched: offers.filter(o => o.status === 'matched').length,
    cancelled: offers.filter(o => o.status === 'cancelled').length,
    open: offers.filter(o => o.status === 'open').length
  };
  
  console.log(`💼 Importing ${offers.length} offers (${offerStats.matched} matched, ${offerStats.cancelled} cancelled, ${offerStats.open} open)...`);
  
  for (const offer of offers) {
    await prisma.barterOffer.create({ data: offer });
  }
  
  console.log('\n✅ Data import complete!');
  console.log('\n📊 Summary:');
  console.log(`   Users: ${users.length}`);
  console.log(`   Classes: ${parallelClasses.length}`);
  console.log(`   Enrollments: ${enrollments.length}`);
  console.log(`   Total Offers: ${offers.length}`);
  console.log(`     - Matched: ${offerStats.matched}`);
  console.log(`     - Cancelled: ${offerStats.cancelled}`);
  console.log(`     - Open: ${offerStats.open}`);
  
  await prisma.$disconnect();
  await pool.end();
}

importData()
  .catch((error) => {
    console.error('❌ Import failed:', error);
    process.exit(1);
  });