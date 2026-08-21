export type IntakeArchive = Readonly<{ id: string; sha256: string; format: "postgres-custom"; restricted: true; status: "received" | "restored" }>;
export type RestorePlan = Readonly<{ archiveId: string; verifyChecksum: true; noOwner: true; noPrivileges: true; singleTransaction: true; executable: false }>;
export class ArchiveRegistryError extends Error { constructor(message: string) { super(message); this.name = "ArchiveRegistryError"; } }

function identifier(value: string) {
  if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(value)) throw new ArchiveRegistryError("archive id is invalid");
  return value;
}

/** Registers provenance only; no archive path, contents, credential, or row data can enter this contract. */
export function registerArchive(input: IntakeArchive): IntakeArchive {
  identifier(input.id);
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new ArchiveRegistryError("archive checksum is invalid");
  if (input.format !== "postgres-custom" || input.restricted !== true) throw new ArchiveRegistryError("archive format and restriction are required");
  return Object.freeze({ ...input });
}

/** Produces a non-executable safe restore intent for an isolated intake environment. */
export function createRestorePlan(archive: IntakeArchive): RestorePlan {
  registerArchive(archive);
  if (archive.status !== "received") throw new ArchiveRegistryError("only received archives can be planned for restore");
  return Object.freeze({ archiveId: archive.id, verifyChecksum: true, noOwner: true, noPrivileges: true, singleTransaction: true, executable: false });
}
