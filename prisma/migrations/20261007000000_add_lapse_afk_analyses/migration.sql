-- CreateTable
CREATE TABLE "LapseAfkAnalysis" (
    "timelapseId" TEXT NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "videoDuration" DOUBLE PRECISION NOT NULL,
    "recordingDuration" DOUBLE PRECISION NOT NULL,
    "intervals" JSONB NOT NULL,
    "totalAfkSeconds" DOUBLE PRECISION NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LapseAfkAnalysis_pkey" PRIMARY KEY ("timelapseId")
);
