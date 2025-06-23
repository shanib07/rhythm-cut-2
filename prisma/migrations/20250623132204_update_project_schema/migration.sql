-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "inputVideos" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "beatMarkers" SET DEFAULT ARRAY[]::DOUBLE PRECISION[];

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");
