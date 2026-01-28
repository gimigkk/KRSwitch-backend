/*
  Warnings:

  - You are about to drop the column `classSectionId` on the `enrollments` table. All the data in the column will be lost.
  - You are about to drop the `class_sections` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[nim,parallelClassId]` on the table `enrollments` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `parallelClassId` to the `enrollments` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "barter_offers" DROP CONSTRAINT "barter_offers_myClassId_fkey";

-- DropForeignKey
ALTER TABLE "barter_offers" DROP CONSTRAINT "barter_offers_wantedClassId_fkey";

-- DropForeignKey
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_classSectionId_fkey";

-- DropIndex
DROP INDEX "enrollments_nim_classSectionId_key";

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "classSectionId",
ADD COLUMN     "parallelClassId" INTEGER NOT NULL;

-- DropTable
DROP TABLE "class_sections";

-- CreateTable
CREATE TABLE "parallel_classes" (
    "id" SERIAL NOT NULL,
    "courseCode" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "classCode" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "timeStart" TEXT NOT NULL,
    "timeEnd" TEXT NOT NULL,
    "room" TEXT NOT NULL,

    CONSTRAINT "parallel_classes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_nim_parallelClassId_key" ON "enrollments"("nim", "parallelClassId");

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_parallelClassId_fkey" FOREIGN KEY ("parallelClassId") REFERENCES "parallel_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_myClassId_fkey" FOREIGN KEY ("myClassId") REFERENCES "parallel_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_wantedClassId_fkey" FOREIGN KEY ("wantedClassId") REFERENCES "parallel_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
