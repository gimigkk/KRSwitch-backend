-- CreateTable
CREATE TABLE "users" (
    "nim" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',

    CONSTRAINT "users_pkey" PRIMARY KEY ("nim")
);

-- CreateTable
CREATE TABLE "class_sections" (
    "id" SERIAL NOT NULL,
    "courseCode" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "classCode" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "timeStart" TEXT NOT NULL,
    "timeEnd" TEXT NOT NULL,
    "room" TEXT NOT NULL,

    CONSTRAINT "class_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" SERIAL NOT NULL,
    "nim" TEXT NOT NULL,
    "classSectionId" INTEGER NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barter_offers" (
    "id" SERIAL NOT NULL,
    "offererNim" TEXT NOT NULL,
    "myClassId" INTEGER NOT NULL,
    "wantedClassId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takerNim" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "barter_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_nim_classSectionId_key" ON "enrollments"("nim", "classSectionId");

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_nim_fkey" FOREIGN KEY ("nim") REFERENCES "users"("nim") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "class_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_offererNim_fkey" FOREIGN KEY ("offererNim") REFERENCES "users"("nim") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_myClassId_fkey" FOREIGN KEY ("myClassId") REFERENCES "class_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_wantedClassId_fkey" FOREIGN KEY ("wantedClassId") REFERENCES "class_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_takerNim_fkey" FOREIGN KEY ("takerNim") REFERENCES "users"("nim") ON DELETE SET NULL ON UPDATE CASCADE;
