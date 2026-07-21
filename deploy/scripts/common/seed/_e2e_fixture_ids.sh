#!/usr/bin/env bash
# Single source of the e2e extraction-host fixture identity. Sourced by BOTH the
# producer (deploy/scripts/common/seed/_e2e_extraction_host.sh, which writes the
# device) and the consumer (scripts/ci/browser-docker-job.sh, which runs the
# browser tests), so overriding any of these in the environment changes the
# fixture everywhere at once. The extraction test reads FM_E2E_EXTRACTION_SOURCE_KEY
# to know which group to extract; the seed SQL builds exactly that group.
export FM_E2E_EXTRACTION_HOST_EXTERNAL_ID="${FM_E2E_EXTRACTION_HOST_EXTERNAL_ID:-e2e-extract-host}"
export FM_E2E_EXTRACTION_HOST_NAME="${FM_E2E_EXTRACTION_HOST_NAME:-E2E Extractable Host}"
export FM_E2E_EXTRACTION_SOURCE_KEY="${FM_E2E_EXTRACTION_SOURCE_KEY:-group:220}"
