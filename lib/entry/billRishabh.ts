/**
 * The Rishabh Plast "TAX INVOICE" (the client's Crystal Report, sample INV9649). The bill's data is the document the server makes the way SP_BILL_PRINT does
 * (lib/entry/billDocument.ts); the page is a template (lib/print/rishabhTemplate.ts) drawn by the template engine (lib/print/template.ts), which a company can redesign
 * in the Print Format Designer.
 */

import type { BillDocument } from "./billDocument";
import { renderTemplate } from "../print/template";
import type { Template } from "../print/template";
import { defaultRishabhTemplate, docFromRishabhDocument } from "../print/rishabhTemplate";

/** The Rishabh invoice of a saved entry's bill document (one HTML document), on the company's own template or the default one. */
export const rishabhDocumentHtml = (document: BillDocument, template?: Template | null): string =>
  renderTemplate(template ?? defaultRishabhTemplate(), docFromRishabhDocument(document), document.top.INVOICE_FULLDOCNO ?? "");
