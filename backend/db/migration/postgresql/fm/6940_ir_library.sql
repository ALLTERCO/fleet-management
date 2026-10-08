--------------UP
-- Org-level IR code library. One row = one IR code (a remote button) an
-- operator can push to any IR-capable controller in the fleet. `payload`
-- stores the code faithfully as captured/imported; the device-push shape
-- is not pinned by firmware docs yet, so nothing is normalized away.

CREATE TABLE IF NOT EXISTS fm.ir_library (
    id                BIGSERIAL PRIMARY KEY,
    organization_id   VARCHAR(120) NOT NULL,
    name              VARCHAR(128) NOT NULL,
    brand             VARCHAR(120) NULL,
    device_type       VARCHAR(64) NULL,
    protocol          VARCHAR(64) NULL,
    payload           JSONB NOT NULL,
    source            VARCHAR(16) NOT NULL,
    source_detail     VARCHAR(250) NULL,
    created_by        VARCHAR(200) NULL,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT ir_library_source_chk CHECK (source IN (
        'learned', 'import_irdb', 'import_flipper', 'manual'
    ))
);

CREATE INDEX IF NOT EXISTS ir_library_org_idx
    ON fm.ir_library (organization_id);
CREATE INDEX IF NOT EXISTS ir_library_org_brand_idx
    ON fm.ir_library (organization_id, brand);

COMMENT ON TABLE fm.ir_library IS
    'Org-scoped IR code library: learn once, deploy fleet-wide.';
COMMENT ON COLUMN fm.ir_library.payload IS
    'Faithful code payload (IRDB row, Flipper signal, or device-read code); push conversion is hardware-pending.';
COMMENT ON COLUMN fm.ir_library.source_detail IS
    'Provenance detail: import filename or the shellyID the code was learned from.';
--------------DOWN
DROP TABLE IF EXISTS fm.ir_library;
