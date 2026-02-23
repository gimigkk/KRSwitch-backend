-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "recipientNim" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientNim_read_idx" ON "notifications"("recipientNim", "read");

-- CreateIndex
CREATE INDEX "notifications_recipientNim_createdAt_idx" ON "notifications"("recipientNim", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientNim_fkey" FOREIGN KEY ("recipientNim") REFERENCES "users"("nim") ON DELETE CASCADE ON UPDATE CASCADE;
