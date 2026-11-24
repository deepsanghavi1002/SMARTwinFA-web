// Writes the pilot Rishabh invoice (sample INV9649) to public/pilot/rishabh-invoice.html: node scripts/pilot-rishabh-invoice.mts
import { writeFileSync } from "node:fs";
import { PRINT_FORMATS } from "../lib/entry/printFormats.ts";
import { renderTemplate } from "../lib/print/template.ts";


const rishabh = PRINT_FORMATS[0];
writeFileSync("public/pilot/rishabh-invoice.html", renderTemplate(rishabh.defaultTemplate(), rishabh.sample, "Rishabh sample"));
console.log("written public/pilot/rishabh-invoice.html");
