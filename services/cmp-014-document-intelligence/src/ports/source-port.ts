export interface SourceDocument {
  documentId: string;
  tenantId: string;
  checksumSha256: string;
  contentType: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
}

/** CMP-013 document metadata view. No cross-component SQL. */
export interface SourceDocumentPort {
  resolve(input: {
    tenantId: string;
    documentId: string;
    checksumSha256: string;
  }): Promise<SourceDocument | null>;
}

export interface SourceAclPort {
  canRead(input: { tenantId: string; actorId: string; sourceId: string }): Promise<boolean>;
}
