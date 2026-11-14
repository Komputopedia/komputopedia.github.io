// Interface text. v1 ships Indonesian; add `en` and `nl` objects with the same keys later.
const id = {
  app: "Asha Quest",
  loading: "Memuat…",
  loadFail: "Data belum bisa dimuat. Periksa internet, lalu coba lagi.",
  retry: "Coba lagi",
  // login
  parentTab: "Ayah / Bunda", childTab: "Anak",
  email: "Email", password: "Kata sandi", familyCode: "Kode keluarga", username: "Nama pengguna", pin: "PIN (6 angka)",
  signIn: "Masuk", signOut: "Keluar", signInFail: "Tidak bisa masuk. Periksa data yang diisi.",
  noFamily: "Akun ini belum terhubung ke keluarga mana pun. Hubungi admin Kids Quest.",
  // child
  hello: "Halo, {name}!", savings: "Tabunganku", debt: "Utangku", points: "Poin periode ini",
  reported: "dilaporkan", approved: "disetujui", waiting: "menunggu", waitingApproval: "belum disetujui", allApproved: "semua sudah dicek", payday: "Gajian {date}",
  prayersToday: "Sholat hari ini", prayersYesterday: "Sholat kemarin", today: "Hari ini", yesterday: "Kemarin",
  notYet: "belum", missed: "terlewat", howPray: "Sholat {name}", praySave: "Simpan",
  weekly: "Wajib minggu ini", weeklyLeft: "kurang {n} {unit}", weeklyDone: "wajib sudah", weeklyBonus: "bonus +{p} poin",
  logIt: "Catat", activities: "Kegiatan", howMany: "Berapa {unit}?", note: "Catatan (boleh kosong)", send: "Kirim",
  sentWait: "Terkirim! Tunggu dicek Ayah/Bunda ya.", sentHonest: "Terima kasih sudah jujur 💙",
  propose: "Usul kegiatan baru", proposeHint: "Ada kebaikan yang belum ada di daftar? Tulis dan minta poinnya.",
  whatDid: "Kegiatan apa?", askPoints: "Minta berapa poin?", category: "Kategori",
  spend: "Mau beli atau sedekah?", spendWhat: "Untuk apa?", price: "Harga (€)", askSpend: "Minta izin",
  notEnough: "Tabunganmu belum cukup. Kurang {amt}.", charityNote: "Sedekah mengembalikan {p} poin untukmu.",
  history: "Riwayat", noHistory: "Belum ada catatan.", cancel: "Batal", remove: "Hapus",
  screen: "Screentime", leftToday: "sisa hari ini", usedToday: "terpakai {m} menit dari {l}",
  start: "Mulai", stop: "Selesai", whatPlay: "Mau main apa?", running: "Sedang {what}",
  warn5: "Sisa {m} menit lagi!", overNow: "Sudah lewat {m} menit dari jatah hari ini.",
  // statuses
  st_pending: "menunggu", st_approved: "disetujui", st_rejected: "ditolak", st_waived: "dibatalkan", st_auto: "otomatis",
  // parent
  tabCheck: "Perlu dicek", tabMoney: "Gajian & uang", tabRules: "Aturan", tabScreen: "Screentime", tabFamily: "Keluarga", tabAdmin: "Admin",
  approveAll: "Setujui semua", approveDay: "Setujui semua {date}", approve: "Setujui", reject: "Tolak",
  proposal: "Usulan", asPermanent: "Jadikan kegiatan tetap", pointsGiven: "Poin",
  spendReq: "Minta izin belanja", nothingToCheck: "Semua sudah dicek.", sessionsReview: "Timer yang perlu dicek",
  paydayMode: "Cara gajian", mode_auto: "Otomatis", mode_approval: "Perlu persetujuan", mode_manual: "Manual",
  modeHelp_auto: "Dibayar otomatis pada hari dan jam gajian.", modeHelp_approval: "Pada hari gajian dibuatkan draf, lalu Ayah/Bunda menekan Bayar.", modeHelp_manual: "Hanya dibayar lewat tombol.",
  payNow: "Bayar gajian sampai {date}", payPreview: "{p} poin = {amt}", paid: "Gajian dibayar", draft: "Draf gajian",
  moneyIn: "Uang masuk", moneyOut: "Uang keluar", amount: "Nominal (€)", date: "Tanggal", save: "Simpan", saved: "Tersimpan.",
  ledger: "Buku tabungan", logFor: "Catat untuk {name}",
  errLimitDay: "Kegiatan ini sudah dicatat hari ini.", errLimitWeek: "Jatah usulan minggu ini sudah habis.", errProposalsOff: "Usulan kegiatan sedang ditutup.",
  doneToday: "sudah ✓ hari ini", proposalsLeft: "sisa {n} minggu ini",
  kindJar: "Toples kebaikan", giveStar: "Bintang kebaikan", starHint: "Untuk kebaikan kecil, misalnya mengembalikan sepatu. Bintang tidak bernilai uang.", starWhat: "Kebaikan apa?", give: "Beri bintang",
  gallery: "Galeri", addPhotoTitle: "Tambah foto", managePhotos: "Lihat & atur {n} foto", addPhoto: "+ Foto", uploading: "Mengunggah…", photoCaption: "Keterangan foto (boleh kosong)", noPhotos: "Belum ada foto.",
  paydaySettings: "Pengaturan gajian", paydayEvery: "Gajian setiap", paydayDay: "Hari gajian", paydayHour: "Jam gajian",
  cycleExplain: "Periode {from}–{to}. Gajian tiap {day} pukul {hour}:00, untuk catatan sampai hari sebelumnya. Kuota mingguan ikut siklus ini.",
  screenAdjust: "Jatah khusus", screenAdjustHint: "Tambah atau kurangi jatah screentime untuk hari ini atau besok saja.",
  errBadQty: "Jumlah tidak valid. Setengah hanya boleh untuk kegiatan yang mengizinkannya.",
  errRemoveSelf: "Anda tidak bisa menghapus akun sendiri.", errLastParent: "Harus ada minimal satu orang tua.", errIsAdmin: "Akun admin Kids Quest tidak bisa dihapus dari sini.",
  errEmailTaken: "Email ini sudah dipakai akun lain.", errUsernameTaken: "Nama pengguna ini sudah dipakai di keluarga ini.",
  // misc
  errPaid: "Tanggal itu sudah masuk gajian. Pakai koreksi uang.", errGeneric: "Gagal menyimpan: {m}",
};
let dict = id;
export function t(key, vars) {
  let s = dict[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll("{" + k + "}", vars[k]);
  return s;
}
export const locale = "id-ID";
