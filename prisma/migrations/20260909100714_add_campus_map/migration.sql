-- CreateEnum
CREATE TYPE "MapNodeKind" AS ENUM ('ROOM', 'JUNCTION', 'STAIR', 'GATE');

-- CreateEnum
CREATE TYPE "MapNodeCategory" AS ENUM ('CLASSROOM', 'SPECIAL_ROOM', 'ADMIN', 'STAIR_BLOCK', 'SERVICE', 'CIRCULATION', 'OPEN_AREA', 'LANDSCAPE');

-- CreateEnum
CREATE TYPE "MapEdgeKind" AS ENUM ('WALK', 'STAIR');

-- AlterTable
ALTER TABLE "destinations" ADD COLUMN     "mapNodeId" TEXT;

-- CreateTable
CREATE TABLE "map_levels" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameMs" TEXT NOT NULL,

    CONSTRAINT "map_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_nodes" (
    "id" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "MapNodeKind" NOT NULL,
    "category" "MapNodeCategory" NOT NULL DEFAULT 'CIRCULATION',
    "nameEn" TEXT,
    "nameMs" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "block" TEXT,

    CONSTRAINT "map_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_edges" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" "MapEdgeKind" NOT NULL DEFAULT 'WALK',
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "map_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_levels_code_key" ON "map_levels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "map_levels_ordinal_key" ON "map_levels"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "map_nodes_code_key" ON "map_nodes"("code");

-- CreateIndex
CREATE INDEX "map_nodes_levelId_idx" ON "map_nodes"("levelId");

-- CreateIndex
CREATE INDEX "map_nodes_kind_idx" ON "map_nodes"("kind");

-- CreateIndex
CREATE INDEX "map_edges_fromId_idx" ON "map_edges"("fromId");

-- CreateIndex
CREATE INDEX "map_edges_toId_idx" ON "map_edges"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "map_edges_fromId_toId_key" ON "map_edges"("fromId", "toId");

-- CreateIndex
CREATE INDEX "destinations_mapNodeId_idx" ON "destinations"("mapNodeId");

-- AddForeignKey
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_mapNodeId_fkey" FOREIGN KEY ("mapNodeId") REFERENCES "map_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "map_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "map_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_toId_fkey" FOREIGN KEY ("toId") REFERENCES "map_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
