-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DNI', 'CE', 'PAS', 'OTHER');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('M', 'F', 'OTHER');

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "sex" "Sex" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_document_type_document_number_key" ON "patients"("document_type", "document_number");
