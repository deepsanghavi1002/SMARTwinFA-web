# Menu and action metadata profile — discovery baseline

This profile records aggregate `MenuMaster` structure only. It intentionally
excludes menu labels, action codes, program names, visibility/hidden marker
values, user rights, and client data.

Run it locally against the isolated intake database:

```text
node scripts/profile-menu-metadata.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The checked profile hash is
`98bb80bddb55f4709f08c9170875189af9c865de9e5d4dbf5cc76416a6dc4eae`.

| Aggregate fact | Count |
|---|---:|
| Menu records | 592 |
| Root records | 13 |
| Action-code records | 530 |
| Program-link records | 529 |
| Shortcut records | 1 |
| Visibility-marker records | 390 |
| Hidden-marker records | 581 |
| Special records | 405 |
| Display records | 2 |
| Duplicate logical menu-ID groups | 0 |
| Orphan parent references | 1 |

The one orphan hierarchy reference requires repair or a documented legacy
exception. More importantly, `menuvisible` and `menuhide` contain opaque
legacy marker lists; they are not a permission system and cannot be copied into
the web UI. `smart_system` plus a running legacy behavior capture are still
required to build role, company/year, and action authorization evidence.
