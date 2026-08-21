# Routine And SQL Intake

The authoritative application SQL is distributed through `Data Access Layer/`,
`Data Logic Layer/`, `@Library/`, `SMARTwinFA/Prj_Forms/`, and
`SMARTwinFA/Prj_Reports/Report_Combine.cs`. Preserve the original files and
lineage. Stored-procedure bodies are database-resident and were not present.

Active or evidenced procedure contracts include `SP_ENTRY_READ_FIRSTCOMBO`,
`SP_ENTRY_SAVE`, `SP_GETUSER`, `SP_IMPORT_DATA`, `SP_REPOST_DATA`,
`SP_REPORT_FORMATING`, `SP_REPORT_FORMATING_NEW`, `SP_STD_REPORT`,
`SP_DROP_TABLES`, `SP_FILL_CONTROL`, `SP_GET_HELP`, `SP_TRANSFER_DATA`,
`SP_VERSION_CHANGES`, and `SP_YEAR_OPEN`. Additional routine names may be
data-driven through setup metadata and must be extracted from the source
databases.

`routine-inventory.csv` records the known contracts without guessing parameters,
tables, or side effects that only a database definition can establish.
