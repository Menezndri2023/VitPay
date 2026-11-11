import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { decryptBytes, encryptBytes, sha256Hex } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { toCamel } from './organizations.service';

export const KYB_KINDS = ['rc_extract', 'ice_certificate', 'id_document', 'statutes', 'bank_details', 'other'] as const;
export type KybKind = (typeof KYB_KINDS)[number];
export const MAX_KYB_BYTES = 5 * 1024 * 1024;

/** Type réel déterminé par les octets de tête (le type MIME déclaré par le client est ignoré). */
export function sniffMime(buf: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document';
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'document';
}

const META = 'id, org_id, kind, filename, mime_type, size_bytes, sha256, status, review_note, reviewed_at, created_at';

@Injectable()
export class KybDocumentsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async upload(orgId: string, actor: AuditActor & { userId: string }, input: { kind: string; filename: string; content: Buffer }) {
    if (!(KYB_KINDS as readonly string[]).includes(input.kind)) throw Errors.validation({ kind: `One of ${KYB_KINDS.join(', ')}` });
    if (!input.content.length) throw Errors.validation({ file: 'Empty file' });
    if (input.content.length > MAX_KYB_BYTES) throw Errors.validation({ file: 'File exceeds 5 MB' });
    const mime = sniffMime(input.content);
    if (!mime) throw Errors.validation({ file: 'Only PDF, PNG or JPEG documents are accepted' });
    return this.db.forOrg(orgId, async (tx) => {
      const r = await tx.one<Record<string, unknown>>(
        `INSERT INTO kyb_documents (org_id, kind, filename, mime_type, size_bytes, sha256, content_enc, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${META}`,
        [orgId, input.kind, safeFilename(input.filename), mime, input.content.length, sha256Hex(input.content), encryptBytes(input.content, this.config.encryptionKey), actor.userId],
      );
      await this.audit.record(tx, { actor, orgId, action: 'kyb.document_uploaded', targetType: 'kyb_document', targetId: String(r.id), metadata: { kind: input.kind, mime, size: input.content.length } });
      return toCamel(r);
    });
  }

  async listForOrg(orgId: string) {
    return (await this.db.forOrg(orgId, (tx) => tx.query<Record<string, unknown>>(`SELECT ${META} FROM kyb_documents ORDER BY created_at DESC`))).map(toCamel);
  }

  async listForAdmin(orgId: string) {
    return (await this.db.system((tx) => tx.query<Record<string, unknown>>(`SELECT ${META} FROM kyb_documents WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]))).map(toCamel);
  }

  private decode(row: { content_enc: Buffer; sha256: string; filename: string; mime_type: string }) {
    const content = decryptBytes(row.content_enc, this.config.encryptionKey);
    if (sha256Hex(content) !== row.sha256) throw new Error('KYB document integrity check failed');
    return { content, filename: row.filename, mime: row.mime_type };
  }

  async downloadForOrg(orgId: string, id: string) {
    const row = await this.db.forOrg(orgId, (tx) =>
      tx.maybeOne<{ content_enc: Buffer; sha256: string; filename: string; mime_type: string }>('SELECT content_enc, sha256, filename, mime_type FROM kyb_documents WHERE id = $1', [id]),
    );
    if (!row) throw Errors.notFound('Document');
    return this.decode(row);
  }

  /** Consultation par la conformité : TOUJOURS journalisée. */
  async downloadForAdmin(actor: AuditActor, id: string) {
    return this.db.system(async (tx) => {
      const row = await tx.maybeOne<{ org_id: string; content_enc: Buffer; sha256: string; filename: string; mime_type: string }>(
        'SELECT org_id, content_enc, sha256, filename, mime_type FROM kyb_documents WHERE id = $1',
        [id],
      );
      if (!row) throw Errors.notFound('Document');
      await this.audit.record(tx, { actor, orgId: row.org_id, action: 'admin.kyb.document_viewed', targetType: 'kyb_document', targetId: id });
      return this.decode(row);
    });
  }

  async review(actor: AuditActor & { userId: string }, id: string, decision: 'accepted' | 'rejected', note: string) {
    await this.db.system(async (tx) => {
      const r = await tx.maybeOne<{ org_id: string; status: string }>('SELECT org_id, status FROM kyb_documents WHERE id = $1 FOR UPDATE', [id]);
      if (!r) throw Errors.notFound('Document');
      await tx.query('UPDATE kyb_documents SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1', [id, decision, note, actor.userId]);
      await this.audit.record(tx, { actor, orgId: r.org_id, action: `admin.kyb.document_${decision}`, targetType: 'kyb_document', targetId: id, reason: note });
    });
  }
}
