/**
 * Fictional demonstration data.
 *
 * Every name, address fragment, phone number and identity number here is
 * invented. Email addresses use the reserved `.test` TLD (RFC 2606), which can
 * never resolve on the public internet, so a seeded database cannot email a
 * real person. No real SMKBBSP staff member, student or parent appears.
 *
 * NRIC values are structurally valid (12 digits) but use the reserved-looking
 * `99` state code and are not issued to anyone.
 */

export interface SeedTeacher {
  name: string;
  email: string;
  staffCode: string;
  department: string;
  phone: string;
  isAcceptingVisits: boolean;
}

export const SEED_TEACHERS: SeedTeacher[] = [
  {
    name: 'Puan Aminah binti Zulkifli',
    email: 'teacher@smkbbsp.test',
    staffCode: 'GKM-1001',
    department: 'Bahasa Melayu',
    phone: '+60312345001',
    isAcceptingVisits: true,
  },
  {
    name: 'Encik Rajesh a/l Manickam',
    email: 'rajesh.manickam@smkbbsp.test',
    staffCode: 'GKM-1002',
    department: 'Matematik',
    phone: '+60312345002',
    isAcceptingVisits: true,
  },
  {
    name: 'Cikgu Lim Wei Ling',
    email: 'lim.weiling@smkbbsp.test',
    staffCode: 'GKM-1003',
    department: 'Sains',
    phone: '+60312345003',
    isAcceptingVisits: true,
  },
  {
    name: 'Encik Faizal bin Othman',
    email: 'faizal.othman@smkbbsp.test',
    staffCode: 'GKM-1004',
    department: 'Sejarah',
    phone: '+60312345004',
    isAcceptingVisits: true,
  },
  {
    name: 'Puan Siti Noraini binti Hassan',
    email: 'siti.noraini@smkbbsp.test',
    staffCode: 'GKM-1005',
    department: 'Bimbingan dan Kaunseling',
    phone: '+60312345005',
    isAcceptingVisits: true,
  },
  {
    name: 'Encik Tan Chee Keong',
    email: 'tan.cheekeong@smkbbsp.test',
    staffCode: 'GKM-1006',
    department: 'Pendidikan Jasmani',
    phone: '+60312345006',
    // On long leave: proves the public form hides teachers who are unavailable.
    isAcceptingVisits: false,
  },
];

export interface SeedDestination {
  code: string;
  nameEn: string;
  nameMs: string;
  instructionsEn: string;
  instructionsMs: string;
  isActive: boolean;
}

export const SEED_DESTINATIONS: SeedDestination[] = [
  {
    code: 'OFFICE',
    nameEn: 'General Office',
    nameMs: 'Pejabat Am',
    instructionsEn: 'Ground floor of Block A, immediately right of the main entrance.',
    instructionsMs: 'Aras bawah Blok A, sebelah kanan pintu masuk utama.',
    isActive: true,
  },
  {
    code: 'COUNSEL',
    nameEn: 'Counselling Room',
    nameMs: 'Bilik Kaunseling',
    instructionsEn: 'Block B, first floor. Please wait in the seating area outside.',
    instructionsMs: 'Blok B, tingkat satu. Sila tunggu di ruang menunggu di luar.',
    isActive: true,
  },
  {
    code: 'STAFFRM',
    nameEn: 'Teachers Staff Room',
    nameMs: 'Bilik Guru',
    instructionsEn: 'Block A, first floor. Report to the duty teacher at the door.',
    instructionsMs: 'Blok A, tingkat satu. Lapor diri kepada guru bertugas di pintu.',
    isActive: true,
  },
  {
    code: 'HALL',
    nameEn: 'School Hall',
    nameMs: 'Dewan Sekolah',
    instructionsEn: 'Behind Block C. Use the side gate on event days.',
    instructionsMs: 'Di belakang Blok C. Gunakan pintu sisi pada hari majlis.',
    isActive: true,
  },
  {
    code: 'LIBRARY',
    nameEn: 'Library / Resource Centre',
    nameMs: 'Pusat Sumber',
    instructionsEn: 'Block C, ground floor. Bags must be left on the outside rack.',
    instructionsMs: 'Blok C, aras bawah. Beg perlu diletakkan di rak luar.',
    isActive: true,
  },
  {
    code: 'LABSCI',
    nameEn: 'Science Laboratory',
    nameMs: 'Makmal Sains',
    instructionsEn: 'Block D. Contractors must sign the laboratory safety register.',
    instructionsMs: 'Blok D. Kontraktor perlu menandatangani daftar keselamatan makmal.',
    isActive: true,
  },
  {
    code: 'CANTEEN',
    nameEn: 'Canteen',
    nameMs: 'Kantin',
    instructionsEn: 'Between Block B and Block C.',
    instructionsMs: 'Antara Blok B dan Blok C.',
    isActive: false,
  },
];

export interface SeedVisitType {
  code: string;
  nameEn: string;
  nameMs: string;
  requiresIdSighted: boolean;
  defaultDurationMinutes: number;
  isActive: boolean;
}

export const SEED_VISIT_TYPES: SeedVisitType[] = [
  {
    code: 'PARENT',
    nameEn: 'Parent meeting',
    nameMs: 'Pertemuan ibu bapa',
    requiresIdSighted: true,
    defaultDurationMinutes: 30,
    isActive: true,
  },
  {
    code: 'OFFICIAL',
    nameEn: 'Official visit',
    nameMs: 'Lawatan rasmi',
    requiresIdSighted: true,
    defaultDurationMinutes: 90,
    isActive: true,
  },
  {
    code: 'CONTRACT',
    nameEn: 'Contractor / maintenance',
    nameMs: 'Kontraktor / penyelenggaraan',
    requiresIdSighted: true,
    defaultDurationMinutes: 120,
    isActive: true,
  },
  {
    code: 'DELIVERY',
    nameEn: 'Delivery',
    nameMs: 'Penghantaran',
    requiresIdSighted: false,
    defaultDurationMinutes: 20,
    isActive: true,
  },
  {
    code: 'EVENT',
    nameEn: 'School event guest',
    nameMs: 'Tetamu majlis sekolah',
    requiresIdSighted: false,
    defaultDurationMinutes: 180,
    isActive: true,
  },
];

export interface SeedVisitorSpec {
  fullName: string;
  email: string | null;
  phone: string;
  nric: string;
  category:
    | 'PARENT'
    | 'GUARDIAN'
    | 'CONTRACTOR'
    | 'OFFICIAL'
    | 'VENDOR'
    | 'ALUMNI'
    | 'OTHER';
}

export const SEED_VISITORS: SeedVisitorSpec[] = [
  { fullName: 'Nurul Huda binti Ismail', email: 'nurul.huda@contoh.test', phone: '+60121110001', nric: '859912145501', category: 'PARENT' },
  { fullName: 'Kamarul Ariffin bin Jaafar', email: 'kamarul.ariffin@contoh.test', phone: '+60121110002', nric: '829912085502', category: 'PARENT' },
  { fullName: 'Devi a/p Subramaniam', email: 'devi.subra@contoh.test', phone: '+60121110003', nric: '889912105503', category: 'GUARDIAN' },
  { fullName: 'Wong Mei Fong', email: 'wong.meifong@contoh.test', phone: '+60121110004', nric: '879912225504', category: 'PARENT' },
  { fullName: 'Abdul Rahman bin Yusof', email: 'abdul.rahman@contoh.test', phone: '+60121110005', nric: '769912015505', category: 'CONTRACTOR' },
  { fullName: 'Sharifah Aisyah binti Syed Omar', email: 'sharifah.aisyah@contoh.test', phone: '+60121110006', nric: '909912305506', category: 'OFFICIAL' },
  { fullName: 'Ganesan a/l Perumal', email: 'ganesan.perumal@contoh.test', phone: '+60121110007', nric: '839912175507', category: 'VENDOR' },
  { fullName: 'Chong Wai Keat', email: 'chong.waikeat@contoh.test', phone: '+60121110008', nric: '929912055508', category: 'ALUMNI' },
  { fullName: 'Zainab binti Mohd Salleh', email: 'zainab.salleh@contoh.test', phone: '+60121110009', nric: '819912285509', category: 'PARENT' },
  { fullName: 'Hafiz bin Roslan', email: 'hafiz.roslan@contoh.test', phone: '+60121110010', nric: '949912125510', category: 'GUARDIAN' },
  { fullName: 'Priya a/p Rajendran', email: 'priya.rajendran@contoh.test', phone: '+60121110011', nric: '869912195511', category: 'PARENT' },
  { fullName: 'Lee Chun Hoe', email: 'lee.chunhoe@contoh.test', phone: '+60121110012', nric: '789912035512', category: 'VENDOR' },
  { fullName: 'Rosnah binti Abu Bakar', email: 'rosnah.abubakar@contoh.test', phone: '+60121110013', nric: '809912265513', category: 'PARENT' },
  { fullName: 'Mohd Syafiq bin Kamaruddin', email: null, phone: '+60121110014', nric: '959912075514', category: 'CONTRACTOR' },
  { fullName: 'Tan Poh Lin', email: 'tan.pohlin@contoh.test', phone: '+60121110015', nric: '849912215515', category: 'PARENT' },
];

export const SEED_PURPOSES: string[] = [
  'Discuss my child’s mid-term results',
  'Collect report card and school leaving letter',
  'Meeting regarding attendance record',
  'Parent-teacher discussion on subject selection',
  'Deliver stationery order for the general office',
  'Quarterly air-conditioning maintenance',
  'Site inspection for hall repainting works',
  'District education office courtesy visit',
  'Discuss counselling support for my child',
  'Return borrowed sports equipment',
  'Photography for the school yearbook',
  'Collect examination slip',
];

/**
 * The blacklisted person. Kept entirely separate from SEED_VISITORS so a
 * demonstration of the block path cannot accidentally taint a normal visitor
 * record. The reason text is deliberately bland - it is restricted data, and
 * the demo should not model a real allegation about anyone.
 */
export const SEED_BLACKLIST_SUBJECT = {
  fullName: 'Rizal bin Sulaiman',
  email: 'rizal.sulaiman@contoh.test',
  phone: '+60121119999',
  nric: '779912319001',
  reason:
    'Demonstration entry for the FYP dataset. Recorded as a hard block so the blocked walk-in and blocked submission paths can be shown end to end.',
};

/** A second entry that only triggers review, not a hard block. */
export const SEED_BLACKLIST_REVIEW_SUBJECT = {
  fullName: 'Suria binti Hamzah',
  email: 'suria.hamzah@contoh.test',
  phone: '+60121119998',
  reason:
    'Demonstration entry matched on contact details only. Review policy so an administrator must resolve the request manually.',
};

export const SEED_VEHICLES = [
  'WXY 1234',
  'BMC 5678',
  'VGH 9012',
  'PPT 3456',
  null,
  null,
  'JLK 7788',
  null,
];
