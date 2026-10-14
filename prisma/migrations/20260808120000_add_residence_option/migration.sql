-- CreateTable
CREATE TABLE "ResidenceOption" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ResidenceOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResidenceOption_value_key" ON "ResidenceOption"("value");

-- Seed the residence list: the seven emirates plus Al Ain.
INSERT INTO "ResidenceOption" ("value", "sortOrder") VALUES
    ('ABU DHABI', 0),
    ('DUBAI', 1),
    ('SHARJAH', 2),
    ('AJMAN', 3),
    ('UMM AL QUWAIN', 4),
    ('RAS AL KHAIMAH', 5),
    ('FUJAIRAH', 6),
    ('AL AIN', 7)
ON CONFLICT ("value") DO NOTHING;
