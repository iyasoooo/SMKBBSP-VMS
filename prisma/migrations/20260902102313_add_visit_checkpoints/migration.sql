-- CreateEnum
CREATE TYPE "CheckpointKind" AS ENUM ('ARRIVAL', 'PRESENCE', 'DEPARTURE');

-- CreateEnum
CREATE TYPE "CheckpointMethod" AS ENUM ('HOST_CONFIRM', 'SCAN', 'GUARD_SIGHTING');

-- CreateEnum
CREATE TYPE "DestinationZone" AS ENUM ('HOST_ONLY', 'COMMON');

-- AlterEnum
ALTER TYPE "VisitEventType" ADD VALUE 'CHECKPOINT_RECORDED';

-- AlterTable
ALTER TABLE "destinations" ADD COLUMN     "zone" "DestinationZone" NOT NULL DEFAULT 'HOST_ONLY';

-- CreateTable
CREATE TABLE "visit_checkpoints" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "destinationId" TEXT,
    "scannedById" TEXT NOT NULL,
    "kind" "CheckpointKind" NOT NULL DEFAULT 'ARRIVAL',
    "method" "CheckpointMethod" NOT NULL DEFAULT 'HOST_CONFIRM',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_checkpoints_visitId_createdAt_idx" ON "visit_checkpoints"("visitId", "createdAt");

-- CreateIndex
CREATE INDEX "visit_checkpoints_createdAt_idx" ON "visit_checkpoints"("createdAt");

-- AddForeignKey
ALTER TABLE "visit_checkpoints" ADD CONSTRAINT "visit_checkpoints_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_checkpoints" ADD CONSTRAINT "visit_checkpoints_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_checkpoints" ADD CONSTRAINT "visit_checkpoints_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
