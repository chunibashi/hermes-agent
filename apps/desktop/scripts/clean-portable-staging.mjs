// Clean up the intermediate win-unpacked staging directory after a portable build.
// The portable exe is self-contained and does not need this directory at runtime.
import { rmSync, existsSync } from 'fs'

const staging = 'release-portable/win-unpacked'

if (existsSync(staging)) {
  try {
    rmSync(staging, { recursive: true, force: true })
    console.log(`[clean-portable] removed staging directory: ${staging}`)
  } catch (e) {
    // EBUSY is expected when production Hermes is running — the exe is still valid.
    console.warn(`[clean-portable] could not remove ${staging}: ${e.message}`)
    console.warn('[clean-portable] portable exe is unaffected. Remove manually after quitting Hermes.')
  }
} else {
  console.log(`[clean-portable] nothing to clean — ${staging} does not exist`)
}