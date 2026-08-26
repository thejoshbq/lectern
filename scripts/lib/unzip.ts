import { inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP reader for the BSB release archives.
 *
 * The archives contain 66 deflated JSON files and nothing exotic — no
 * encryption, no ZIP64, no data descriptors — so a full ZIP implementation
 * would be more surface area than the job needs. Anything outside that
 * envelope throws rather than being silently mishandled, because a corpus
 * that is quietly wrong is the worst failure mode this project has.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // The EOCD record sits at the end, after a comment of up to 65535 bytes.
  const min = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("Not a ZIP archive: no end-of-central-directory record");
}

export function unzip(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf);

  const entryCount = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);

  if (centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported");
  }

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new Error(`Corrupt central directory at entry ${i}`);
    }

    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    cursor += 46 + nameLength + extraLength + commentLength;

    // Directory entries carry no payload.
    if (name.endsWith("/")) continue;

    if (flags & 0x1) throw new Error(`Encrypted ZIP entry: ${name}`);

    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`Corrupt local header for ${name}`);
    }

    // Name and extra lengths in the local header can differ from the central
    // directory's, so re-read them here to locate the payload.
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === METHOD_STORE) {
      data = Buffer.from(raw);
    } else if (method === METHOD_DEFLATE) {
      data = inflateRawSync(raw);
    } else {
      throw new Error(`Unsupported compression method ${method} for ${name}`);
    }

    if (data.length !== uncompressedSize) {
      throw new Error(
        `Size mismatch for ${name}: expected ${uncompressedSize}, got ${data.length}`,
      );
    }

    entries.push({ name, data });
  }

  return entries;
}
