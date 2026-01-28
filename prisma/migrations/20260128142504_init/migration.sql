-- CreateTable
CREATE TABLE "User" (
    "nim" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("nim")
);

-- CreateTable
CREATE TABLE "Matakuliah" (
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "sks" INTEGER NOT NULL,
    "hari" TEXT NOT NULL,
    "jamMulai" TEXT NOT NULL,
    "jamSelesai" TEXT NOT NULL,
    "ruangan" TEXT NOT NULL,

    CONSTRAINT "Matakuliah_pkey" PRIMARY KEY ("kode")
);

-- CreateTable
CREATE TABLE "UserKRS" (
    "id" SERIAL NOT NULL,
    "nim" TEXT NOT NULL,
    "kodeMK" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserKRS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarterOffer" (
    "id" SERIAL NOT NULL,
    "nimOfferer" TEXT NOT NULL,
    "offeringMK" TEXT NOT NULL,
    "wantedMK" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarterOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarterTransaction" (
    "id" SERIAL NOT NULL,
    "offerId" INTEGER NOT NULL,
    "nimA" TEXT NOT NULL,
    "nimB" TEXT NOT NULL,
    "mkA" TEXT NOT NULL,
    "mkB" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarterTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserKRS_nim_kodeMK_key" ON "UserKRS"("nim", "kodeMK");

-- AddForeignKey
ALTER TABLE "UserKRS" ADD CONSTRAINT "UserKRS_nim_fkey" FOREIGN KEY ("nim") REFERENCES "User"("nim") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserKRS" ADD CONSTRAINT "UserKRS_kodeMK_fkey" FOREIGN KEY ("kodeMK") REFERENCES "Matakuliah"("kode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarterOffer" ADD CONSTRAINT "BarterOffer_nimOfferer_fkey" FOREIGN KEY ("nimOfferer") REFERENCES "User"("nim") ON DELETE RESTRICT ON UPDATE CASCADE;
