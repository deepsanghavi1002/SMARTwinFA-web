# Local pgAdmin access to the Rishabh clone

The full restored sample-data clone is available locally for inspection in
pgAdmin. It is a PostgreSQL 18 server on this Mac and is not exposed to the
network.

Create a pgAdmin server registration with:

| Setting | Value |
|---|---|
| Host name/address | `127.0.0.1` |
| Port | `5432` |
| Maintenance database | `smartwin_data_intake` |
| Username | `smartwinfa_viewer` |
| Password | Leave empty |

The viewer account is restricted to local connections and has `SELECT` access
only. It cannot alter or delete the restored data.

Open the following schema to inspect the full source snapshot used by the web
prototype:

`rishabh_plastic27_source_20260824`

Useful tables include `account`, `address`, `ac_balance`, `product_master`,
`prod_balance`, `pricelist`, `process`, `ledger`, `prod_ledger`, `book`, and
`book_setup`. The `smart_setup` and `smart_system` schemas contain the restored
desktop metadata/control-plane reference data.

The database dumps and customer data remain outside Git by design; only the
repeatable clone script and safe migration code are version-controlled.
