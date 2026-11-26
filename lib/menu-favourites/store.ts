/**
 * Menu favourites in their own schema (web_menu); the legacy tables are not changed. Kept per web user and per company, by the company's
 * name and group: those stay the same from year to year, its key does not. Every function runs on the caller's client, in its transaction.
 */
import type { Client } from "pg";
import { MAX_FAVOURITES } from "./items.ts";

export const FAVOURITE_DDL: readonly string[] = [
  "CREATE SCHEMA IF NOT EXISTS web_menu",
  `CREATE TABLE IF NOT EXISTS web_menu.favourite (
     owner_user_id bigint NOT NULL,
     company_name text NOT NULL,
     company_group text NOT NULL,
     item_key text NOT NULL,
     position integer NOT NULL,
     added_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (owner_user_id, company_name, company_group, item_key)
   )`,
];

export async function ensureFavourites(client: Client): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa.web_menu.schema'))");
  for (const statement of FAVOURITE_DDL) await client.query(statement);
}

export type FavouriteOwner = Readonly<{ userId: number; companyName: string; companyGroup: string }>;

const who = (owner: FavouriteOwner) => [owner.userId, owner.companyName.trim().toUpperCase(), owner.companyGroup.trim().toUpperCase()];
const MINE = "owner_user_id = $1 AND company_name = $2 AND company_group = $3";

export async function listFavourites(client: Client, owner: FavouriteOwner): Promise<string[]> {
  return (await client.query(`SELECT item_key FROM web_menu.favourite WHERE ${MINE} ORDER BY position, added_at, item_key`, who(owner))).rows.map((row) => String(row.item_key));
}

/** One change at a time for one user and company, so two quick clicks cannot take the same place or pass the limit. */
async function lockOwner(client: Client, owner: FavouriteOwner): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`web_menu.${who(owner).join("|")}`]);
}

/** Adds at the end; adding one already there changes nothing. False when the list is full. */
export async function addFavourite(client: Client, owner: FavouriteOwner, key: string): Promise<boolean> {
  await lockOwner(client, owner);
  const keys = await listFavourites(client, owner);
  if (keys.includes(key)) return true;
  if (keys.length >= MAX_FAVOURITES) return false;
  await client.query(`INSERT INTO web_menu.favourite (owner_user_id, company_name, company_group, item_key, position) SELECT $1, $2, $3, $4, COALESCE(max(position), 0) + 1 FROM web_menu.favourite WHERE ${MINE}`, [...who(owner), key]);
  return true;
}

export async function removeFavourite(client: Client, owner: FavouriteOwner, key: string): Promise<void> {
  await lockOwner(client, owner);
  await client.query(`DELETE FROM web_menu.favourite WHERE ${MINE} AND item_key = $4`, [...who(owner), key]);
}

/** Moving up or down: the two favourites change places (the screen names its neighbour, as it leaves out rows this menu does not have). */
export async function swapFavourites(client: Client, owner: FavouriteOwner, key: string, other: string): Promise<void> {
  await lockOwner(client, owner);
  const keys = await listFavourites(client, owner);
  const a = keys.indexOf(key);
  const b = keys.indexOf(other);
  if (a < 0 || b < 0 || a === b) return;
  [keys[a], keys[b]] = [keys[b], keys[a]];
  await client.query(`UPDATE web_menu.favourite f SET position = o.position FROM unnest($4::text[]) WITH ORDINALITY AS o(item_key, position) WHERE ${MINE} AND f.item_key = o.item_key`, [...who(owner), keys]);
}
