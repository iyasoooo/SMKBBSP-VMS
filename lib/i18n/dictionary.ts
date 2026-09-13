import type { Locale } from '@/lib/constants';

/**
 * Guard workflow dictionary.
 *
 * Bahasa Melayu and English strings are authored by hand and shipped in the
 * bundle. Nothing is machine-translated at runtime: a gate screen that
 * mistranslates "blocked" or "check out" under pressure is a safety problem,
 * and the spec forbids it.
 *
 * Scope is deliberately the guard workflow plus shared status vocabulary.
 * Administrator analytics and report tooling remain English-only, which is
 * what the specification asks for.
 */

export interface GuardDictionary {
  // Navigation and shell
  appName: string;
  today: string;
  scan: string;
  walkIn: string;
  onSite: string;
  emergency: string;
  history: string;
  schoolMap: string;
  signOut: string;
  language: string;
  theme: string;

  // Visitor history screen
  historyHeading: string;
  historySubtitle: string;
  historyEmpty: string;

  // Today screen
  todayHeading: string;
  todaySubtitle: string;
  expected: string;
  checkedIn: string;
  overdue: string;
  recentlyCompleted: string;
  noExpected: string;
  noOnSite: string;
  noRecent: string;
  search: string;
  searchPlaceholder: string;

  // Scanning
  scanHeading: string;
  scanInstruction: string;
  startCamera: string;
  stopCamera: string;
  cameraDenied: string;
  cameraUnavailable: string;
  useManualCode: string;
  manualCodeLabel: string;
  manualCodeHint: string;
  lookUp: string;
  searching: string;

  // Pass result states
  passValid: string;
  passTooEarly: string;
  passExpired: string;
  passRevoked: string;
  passNotApproved: string;
  passNotFound: string;
  passAlreadyIn: string;
  passAlreadyOut: string;
  passCancelled: string;

  // Visitor detail
  visitor: string;
  host: string;
  destination: string;
  destinationSearch: string;
  purpose: string;
  partySize: string;
  identity: string;
  vehicle: string;
  appointmentWindow: string;
  badgeNumber: string;
  reference: string;

  // Blacklist states
  statusClear: string;
  statusReview: string;
  statusBlocked: string;
  blockedInstruction: string;
  reviewInstruction: string;

  // Actions
  confirmIdSighted: string;
  idSightedHelp: string;
  idNotRequired: string;
  checkIn: string;
  checkOut: string;
  deny: string;
  printBadge: string;
  reprintBadge: string;
  cancel: string;
  back: string;
  confirm: string;

  // Outcomes
  checkedInSuccess: string;
  checkedOutSuccess: string;
  deniedSuccess: string;
  alreadyProcessed: string;
  actionFailed: string;
  mustConfirmId: string;

  // Walk-in
  walkInHeading: string;
  walkInSubtitle: string;
  visitorName: string;
  phone: string;
  email: string;
  emailOptional: string;
  identityType: string;
  identityNumber: string;
  visitType: string;
  expectedDuration: string;
  minutes: string;
  registerAndCheckIn: string;
  walkInBlocked: string;

  // Emergency
  emergencyHeading: string;
  emergencySubtitle: string;
  generatedAt: string;
  totalPeople: string;
  totalVisitors: string;
  print: string;
  noOneOnSite: string;
  checkInTime: string;
  expectedEnd: string;

  // Arrival confirmations
  checkpoint: string;
  checkpointHeading: string;
  checkpointInstruction: string;
  lastSeen: string;
  lastSeenNever: string;
  awaitingArrival: string;
  awaitingArrivalHelp: string;
  needsAttention: string;
  confirmArrival: string;
  confirmDeparture: string;
  arrivalConfirmed: string;
  departureConfirmed: string;
  alreadyConfirmed: string;
  confirmedBy: string;
  notYourVisitor: string;
  notOnSite: string;
  confirmationsOff: string;
  atDestination: string;
  checkpointWhat: string;
  checkpointType: string;
  checkpointNoDestination: string;
  recordPresence: string;
  recordSightingHelp: string;
  sightingNote: string;
  sightingRecorded: string;
  timelineArrived: string;
  timelineSeen: string;
  timelineDeparted: string;

  // Generic
  loading: string;
  errorGeneric: string;
  required: string;
}

const en: GuardDictionary = {
  appName: 'Visitor Management System',
  today: 'Today at the gate',
  scan: 'Scan pass',
  walkIn: 'Walk-in',
  onSite: 'On site',
  emergency: 'Emergency list',
  history: 'Visitor history',
  schoolMap: 'School map',
  signOut: 'Sign out',
  language: 'Language',
  theme: 'Theme',

  historyHeading: 'Visitor history',
  historySubtitle:
    'Every recorded visit, with identity numbers masked. Search here to check whether a visitor has been to the school before.',
  historyEmpty: 'Try widening the date range or clearing a filter.',

  todayHeading: 'Today at the gate',
  todaySubtitle: 'Expected arrivals, visitors on site, and recent activity.',
  expected: 'Expected',
  checkedIn: 'On site',
  overdue: 'Overdue',
  recentlyCompleted: 'Recently completed',
  noExpected: 'No approved visitors are expected for the rest of today.',
  noOnSite: 'No visitors are on site right now.',
  noRecent: 'No visits have been completed today yet.',
  search: 'Search',
  searchPlaceholder: 'Name, badge or reference',

  scanHeading: 'Scan a visitor pass',
  scanInstruction: 'Point the camera at the QR code on the visitor’s phone or printout.',
  startCamera: 'Start camera',
  stopCamera: 'Stop camera',
  cameraDenied: 'Camera access was denied. Use the code below instead.',
  cameraUnavailable: 'No camera is available on this device. Use the code below instead.',
  useManualCode: 'Enter code manually',
  manualCodeLabel: 'Pass code',
  manualCodeHint: 'The 8-character code printed on the visitor’s pass.',
  lookUp: 'Look up',
  searching: 'Checking...',

  passValid: 'Valid pass',
  passTooEarly: 'Too early',
  passExpired: 'Pass expired',
  passRevoked: 'Pass withdrawn',
  passNotApproved: 'Not approved',
  passNotFound: 'Pass not recognised',
  passAlreadyIn: 'Already checked in',
  passAlreadyOut: 'Visit already completed',
  passCancelled: 'Visit cancelled',

  visitor: 'Visitor',
  host: 'Host teacher',
  destination: 'Destination',
  destinationSearch: 'Search for a room or block',
  purpose: 'Purpose',
  partySize: 'People',
  identity: 'Identification',
  vehicle: 'Vehicle',
  appointmentWindow: 'Appointment',
  badgeNumber: 'Badge',
  reference: 'Reference',

  statusClear: 'Clear',
  statusReview: 'Check with office',
  statusBlocked: 'Do not admit',
  blockedInstruction:
    'Do not check this visitor in. Ask them to wait and contact an administrator now.',
  reviewInstruction: 'Contact the school office before admitting this visitor.',

  confirmIdSighted: 'I have seen the visitor’s physical identification',
  idSightedHelp:
    'You are recording that you looked at the document. The system does not verify that it is genuine.',
  idNotRequired: 'Physical identification is not required for this visit type.',
  checkIn: 'Check in',
  checkOut: 'Check out',
  deny: 'Deny entry',
  printBadge: 'Print badge',
  reprintBadge: 'Reprint badge',
  cancel: 'Cancel',
  back: 'Back',
  confirm: 'Confirm',

  checkedInSuccess: 'Visitor checked in.',
  checkedOutSuccess: 'Visitor checked out.',
  deniedSuccess: 'Entry denied and recorded.',
  alreadyProcessed: 'This visit has already been processed.',
  actionFailed: 'That did not work. Please try again.',
  mustConfirmId: 'Confirm that you have seen the visitor’s identification first.',

  walkInHeading: 'Register a walk-in visitor',
  walkInSubtitle: 'For visitors who arrive without an approved appointment.',
  visitorName: 'Full name',
  phone: 'Phone number',
  email: 'Email address',
  emailOptional: 'Optional',
  identityType: 'Identification type',
  identityNumber: 'Identification number',
  visitType: 'Type of visit',
  expectedDuration: 'Expected duration',
  minutes: 'minutes',
  registerAndCheckIn: 'Register and check in',
  walkInBlocked: 'This visitor cannot be checked in. Please contact an administrator now.',

  emergencyHeading: 'Emergency visitor list',
  emergencySubtitle: 'Everyone currently checked in and not yet checked out.',
  generatedAt: 'Generated at',
  totalPeople: 'Total people',
  totalVisitors: 'Visitor records',
  print: 'Print',
  noOneOnSite: 'No visitors are on site.',
  checkInTime: 'Checked in',
  expectedEnd: 'Expected to leave',

  checkpoint: 'Confirm a visitor',
  checkpointHeading: 'Confirm a visitor is with you',
  checkpointInstruction:
    'Scan the QR on the visitor’s pass, or enter the code printed on it. This records that you have seen them.',
  lastSeen: 'Last seen',
  lastSeenNever: 'Not confirmed since the gate',
  awaitingArrival: 'Has not reached host',
  awaitingArrivalHelp:
    'Checked in at the gate but nobody has confirmed seeing them since. Contact the host teacher.',
  needsAttention: 'Needs attention',
  confirmArrival: 'Visitor has arrived',
  confirmDeparture: 'Visitor has left me',
  arrivalConfirmed: 'Arrival recorded. Thank you.',
  departureConfirmed: 'Departure recorded. Thank you.',
  alreadyConfirmed: 'That was already recorded.',
  confirmedBy: 'Confirmed by',
  notYourVisitor: 'That visitor is not booked to see you.',
  notOnSite: 'This visitor is not currently checked in at the gate.',
  confirmationsOff: 'Arrival confirmations are turned off for this school.',
  atDestination: 'at',
  checkpointWhat: 'What are you recording?',
  checkpointType: 'Confirmation type',
  checkpointNoDestination: 'Not recorded',
  recordPresence: 'I have seen this visitor',
  recordSightingHelp:
    'Record that you have seen this visitor on your rounds. Say where, if it is not their booked destination.',
  sightingNote: 'Where did you see them?',
  sightingRecorded: 'Sighting recorded. Thank you.',
  timelineArrived: 'Arrived at host',
  timelineSeen: 'Seen on rounds',
  timelineDeparted: 'Left host',

  loading: 'Loading...',
  errorGeneric: 'Something went wrong. Please try again.',
  required: 'Required',
};

const ms: GuardDictionary = {
  appName: 'Sistem Pengurusan Pelawat',
  today: 'Hari ini di pintu pagar',
  scan: 'Imbas pas',
  walkIn: 'Pelawat tanpa temu janji',
  onSite: 'Berada di sekolah',
  emergency: 'Senarai kecemasan',
  history: 'Sejarah pelawat',
  schoolMap: 'Peta sekolah',
  signOut: 'Log keluar',
  language: 'Bahasa',
  theme: 'Tema',

  historyHeading: 'Sejarah pelawat',
  historySubtitle:
    'Setiap lawatan yang direkodkan, dengan nombor pengenalan dilindungi. Cari di sini untuk menyemak sama ada pelawat pernah datang ke sekolah.',
  historyEmpty: 'Cuba luaskan julat tarikh atau kosongkan penapis.',

  todayHeading: 'Hari ini di pintu pagar',
  todaySubtitle: 'Ketibaan dijangka, pelawat di sekolah, dan aktiviti terkini.',
  expected: 'Dijangka',
  checkedIn: 'Di sekolah',
  overdue: 'Lewat',
  recentlyCompleted: 'Baru selesai',
  noExpected: 'Tiada pelawat diluluskan dijangka untuk baki hari ini.',
  noOnSite: 'Tiada pelawat berada di sekolah sekarang.',
  noRecent: 'Belum ada lawatan selesai hari ini.',
  search: 'Cari',
  searchPlaceholder: 'Nama, nombor pas atau rujukan',

  scanHeading: 'Imbas pas pelawat',
  scanInstruction: 'Halakan kamera ke kod QR pada telefon atau cetakan pelawat.',
  startCamera: 'Mulakan kamera',
  stopCamera: 'Hentikan kamera',
  cameraDenied: 'Akses kamera ditolak. Sila gunakan kod di bawah.',
  cameraUnavailable: 'Tiada kamera pada peranti ini. Sila gunakan kod di bawah.',
  useManualCode: 'Masukkan kod secara manual',
  manualCodeLabel: 'Kod pas',
  manualCodeHint: 'Kod 8 aksara yang tercetak pada pas pelawat.',
  lookUp: 'Semak',
  searching: 'Menyemak...',

  passValid: 'Pas sah',
  passTooEarly: 'Terlalu awal',
  passExpired: 'Pas tamat tempoh',
  passRevoked: 'Pas ditarik balik',
  passNotApproved: 'Tidak diluluskan',
  passNotFound: 'Pas tidak dikenali',
  passAlreadyIn: 'Sudah didaftar masuk',
  passAlreadyOut: 'Lawatan telah selesai',
  passCancelled: 'Lawatan dibatalkan',

  visitor: 'Pelawat',
  host: 'Guru yang ditemui',
  destination: 'Destinasi',
  destinationSearch: 'Cari bilik atau blok',
  purpose: 'Tujuan',
  partySize: 'Bilangan orang',
  identity: 'Pengenalan diri',
  vehicle: 'Kenderaan',
  appointmentWindow: 'Temu janji',
  badgeNumber: 'Nombor pas',
  reference: 'Rujukan',

  statusClear: 'Bersih',
  statusReview: 'Rujuk pejabat',
  statusBlocked: 'Jangan benarkan masuk',
  blockedInstruction:
    'Jangan daftar masuk pelawat ini. Minta pelawat menunggu dan hubungi pentadbir sekarang.',
  reviewInstruction: 'Hubungi pejabat sekolah sebelum membenarkan pelawat ini masuk.',

  confirmIdSighted: 'Saya telah melihat dokumen pengenalan diri pelawat',
  idSightedHelp:
    'Anda merekodkan bahawa anda telah melihat dokumen tersebut. Sistem tidak mengesahkan ketulenannya.',
  idNotRequired: 'Pengenalan diri fizikal tidak diperlukan untuk jenis lawatan ini.',
  checkIn: 'Daftar masuk',
  checkOut: 'Daftar keluar',
  deny: 'Tolak masuk',
  printBadge: 'Cetak pas',
  reprintBadge: 'Cetak semula pas',
  cancel: 'Batal',
  back: 'Kembali',
  confirm: 'Sahkan',

  checkedInSuccess: 'Pelawat telah didaftar masuk.',
  checkedOutSuccess: 'Pelawat telah didaftar keluar.',
  deniedSuccess: 'Kemasukan ditolak dan direkodkan.',
  alreadyProcessed: 'Lawatan ini telah pun diproses.',
  actionFailed: 'Tindakan itu gagal. Sila cuba lagi.',
  mustConfirmId: 'Sahkan bahawa anda telah melihat pengenalan diri pelawat terlebih dahulu.',

  walkInHeading: 'Daftar pelawat tanpa temu janji',
  walkInSubtitle: 'Untuk pelawat yang tiba tanpa temu janji yang diluluskan.',
  visitorName: 'Nama penuh',
  phone: 'Nombor telefon',
  email: 'Alamat e-mel',
  emailOptional: 'Pilihan',
  identityType: 'Jenis pengenalan diri',
  identityNumber: 'Nombor pengenalan diri',
  visitType: 'Jenis lawatan',
  expectedDuration: 'Jangkaan tempoh',
  minutes: 'minit',
  registerAndCheckIn: 'Daftar dan daftar masuk',
  walkInBlocked: 'Pelawat ini tidak boleh didaftar masuk. Sila hubungi pentadbir sekarang.',

  emergencyHeading: 'Senarai pelawat kecemasan',
  emergencySubtitle: 'Semua pelawat yang telah daftar masuk dan belum daftar keluar.',
  generatedAt: 'Dijana pada',
  totalPeople: 'Jumlah orang',
  totalVisitors: 'Rekod pelawat',
  print: 'Cetak',
  noOneOnSite: 'Tiada pelawat di sekolah.',
  checkInTime: 'Daftar masuk',
  expectedEnd: 'Jangka keluar',

  checkpoint: 'Sahkan pelawat',
  checkpointHeading: 'Sahkan pelawat berada bersama anda',
  checkpointInstruction:
    'Imbas kod QR pada pas pelawat, atau masukkan kod yang tercetak padanya. Ini merekodkan bahawa anda telah berjumpa dengannya.',
  lastSeen: 'Kali terakhir dilihat',
  lastSeenNever: 'Belum disahkan sejak pintu pagar',
  awaitingArrival: 'Belum sampai kepada guru',
  awaitingArrivalHelp:
    'Telah daftar masuk di pintu pagar tetapi belum ada sesiapa mengesahkan pertemuan. Hubungi guru yang ditemui.',
  needsAttention: 'Perlu perhatian',
  confirmArrival: 'Pelawat telah sampai',
  confirmDeparture: 'Pelawat telah beredar',
  arrivalConfirmed: 'Ketibaan direkodkan. Terima kasih.',
  departureConfirmed: 'Pemergian direkodkan. Terima kasih.',
  alreadyConfirmed: 'Perkara itu telah pun direkodkan.',
  confirmedBy: 'Disahkan oleh',
  notYourVisitor: 'Pelawat itu tidak ditempah untuk berjumpa anda.',
  notOnSite: 'Pelawat ini tidak berdaftar masuk di pintu pagar sekarang.',
  confirmationsOff: 'Pengesahan ketibaan dimatikan untuk sekolah ini.',
  atDestination: 'di',
  checkpointWhat: 'Apakah yang anda rekodkan?',
  checkpointType: 'Jenis pengesahan',
  checkpointNoDestination: 'Tidak direkodkan',
  recordPresence: 'Saya telah melihat pelawat ini',
  recordSightingHelp:
    'Rekodkan bahawa anda telah melihat pelawat ini semasa rondaan. Nyatakan lokasinya jika bukan destinasi yang ditempah.',
  sightingNote: 'Di mana anda melihat mereka?',
  sightingRecorded: 'Penglihatan direkodkan. Terima kasih.',
  timelineArrived: 'Tiba berjumpa guru',
  timelineSeen: 'Dilihat semasa rondaan',
  timelineDeparted: 'Beredar dari guru',

  loading: 'Memuatkan...',
  errorGeneric: 'Berlaku masalah. Sila cuba lagi.',
  required: 'Wajib',
};

const DICTIONARIES: Record<Locale, GuardDictionary> = { en, ms };

export function getDictionary(locale: Locale): GuardDictionary {
  return DICTIONARIES[locale] ?? en;
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ms: 'Bahasa Melayu',
};
