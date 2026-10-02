# Example data

SQL files here (`0001_example_requests.sql`, `0002_…`) are applied by
`npm run db:migrate`, after the migrations, once per database: in Preview when
it runs there, and in Live when the app is published (`scripts/seeds.mjs`).
Applied files are recorded by name in `_extend_seeds`, so add a new file rather
than editing one that has run.

Only add example data when the admin asks for it. Mark its rows
`is_example = true`, use relative dates (`current_date + 14`), and never point
them at real contacts. Schema changes belong in migrations, not here.
