-- CreateTable
CREATE TABLE "companions" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "relation" TEXT NOT NULL,
    "identityType" "IdentityType" NOT NULL DEFAULT 'NRIC',
    "identityCiphertext" TEXT NOT NULL,
    "identityIv" TEXT NOT NULL,
    "identityTag" TEXT NOT NULL,
    "identityKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "identityHmac" TEXT NOT NULL,
    "identityLast4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companions_appointmentId_idx" ON "companions"("appointmentId");

-- CreateIndex
CREATE INDEX "companions_identityHmac_idx" ON "companions"("identityHmac");

-- AddForeignKey
ALTER TABLE "companions" ADD CONSTRAINT "companions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
