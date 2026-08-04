-- Managed files: admin-uploaded assets stored in Postgres (owned data, not a Graph cache)
CREATE TABLE "ManagedFile" (
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagedFile_pkey" PRIMARY KEY ("key")
);
